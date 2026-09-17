import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/fatture-in-cloud", () => ({ ficFetch: vi.fn(), listUserCompanies: vi.fn() }));

import { ficFetch, listUserCompanies } from "@/lib/fatture-in-cloud";
import { canWriteExpenses, createReviewedExpense, findExistingExpense, readExpenseTicket, signExpenseTicket, type ExpenseTicket } from "@/lib/fic-expenses";
import { buildExpensePayload, invoiceErrors, validateExpense } from "@/lib/expense-validation";
import type { InvoiceFields } from "@/lib/types";

const invoice: InvoiceFields = { supplier: "OpenAI", invoice_number: "IA8NO7NL-0095", invoice_date: "2026-08-31", currency: "EUR", net_amount: 13.21, tax_amount: 0, total_amount: 13.21, supplier_vat: "IE4143435AH" };
const options = { supplierId: 8, taxDeductibility: 75, vatDeductibility: 0, dueDate: "2026-09-30" };
const supplier = { id: 8, name: "OpenAI Ireland", vat_number: "IE4143435AH" };
const page = (data: unknown[], last_page = 1) => ({ data, last_page });
const ticket = (number: string): ExpenseTicket => ({ companyId: 123, invoice: { ...invoice, invoice_number: number }, options, expiresAt: Date.now() + 600000, owner: "test-session" });

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("FIC_SESSION_SECRET", "test-only-key");
  vi.mocked(listUserCompanies).mockResolvedValue([{ id: 123, name: "Test company", type: "company" }]);
});

describe("expense validation and payload", () => {
  it("preserves the invoice amounts and uses the explicitly chosen accounting settings", () => {
    const payload = buildExpensePayload(invoice, options, supplier);
    expect(payload).toMatchObject({ invoice_number: "IA8NO7NL-0095", date: "2026-08-31", amount_net: 13.21, amount_vat: 0, tax_deductibility: 75, vat_deductibility: 0, entity: { id: 8 }, payments_list: [{ amount: 13.21, due_date: "2026-09-30", status: "not_paid" }] });
    expect(payload).not.toHaveProperty("ei_data");
    expect(payload).not.toHaveProperty("attachment_token");
    expect(payload).not.toHaveProperty("amount_gross");
  });
  it.each([{ invoice_number: "" }, { invoice_date: "2026-02-30" }, { total_amount: 99 }, { net_amount: NaN }, { tax_amount: -1 }, { net_amount: 13.211 }])("blocks invalid invoice %j", (change) => {
    expect(invoiceErrors({ ...invoice, ...change }).length).toBeGreaterThan(0);
    expect(() => validateExpense({ ...invoice, ...change }, options)).toThrow();
  });
  it("blocks unsupported currency and unspecified deductions", () => {
    expect(() => validateExpense({ ...invoice, currency: "USD" }, options)).toThrow("EUR");
    expect(() => validateExpense(invoice, { ...options, taxDeductibility: null })).toThrow();
  });
  it("does not treat read-only or missing scope as permission to write", () => {
    expect(canWriteExpenses()).toBe(false);
    expect(canWriteExpenses("received_documents:r")).toBe(false);
    expect(canWriteExpenses("entity.suppliers:r received_documents:rw")).toBe(true);
  });
});

describe("manual confirmation ticket", () => {
  it("binds exact invoice, company, settings and login session", () => {
    const value = ticket("SIGNED-1");
    const signed = signExpenseTicket(value);
    expect(readExpenseTicket(signed, value.owner)).toEqual(value);
    expect(() => readExpenseTicket(signed, "other-login")).toThrow();
    const [, signature] = signed.split(".");
    const modified = Buffer.from(JSON.stringify({ ...value, companyId: 456 })).toString("base64url");
    expect(() => readExpenseTicket(`${modified}.${signature}`, value.owner)).toThrow();
  });
  it("rejects expired previews", () => {
    const value = { ...ticket("EXPIRED"), expiresAt: Date.now() - 1 };
    expect(() => readExpenseTicket(signExpenseTicket(value), value.owner)).toThrow("scaduta");
  });
});

describe("duplicate protection and expense creation", () => {
  it("checks subsequent pages and identifies the supplier plus complete invoice number", async () => {
    vi.mocked(ficFetch).mockResolvedValueOnce(page([{ id: 1, invoice_number: invoice.invoice_number, entity: { id: 99, name: "Other" } }], 2))
      .mockResolvedValueOnce(page([{ id: 2, invoice_number: " ia8no7nl-0095 ", entity: supplier }], 2));
    expect((await findExistingExpense("test", 123, invoice, supplier))?.id).toBe(2);
    expect(vi.mocked(ficFetch).mock.calls[1][1]).toContain("page=2");
  });
  it("fails closed on incomplete duplicate checks", async () => {
    vi.mocked(ficFetch).mockResolvedValue({ data: [] });
    await expect(findExistingExpense("test", 123, invoice, supplier)).rejects.toThrow("incompleto");
  });
  it("never writes an expense already present", async () => {
    const value = ticket("EXISTING-1");
    vi.mocked(ficFetch).mockResolvedValueOnce(page([supplier])).mockResolvedValueOnce(page([{ id: 77, invoice_number: "EXISTING-1", entity: supplier }]));
    await expect(createReviewedExpense("test", value)).resolves.toEqual({ id: 77, alreadyExists: true });
    expect(vi.mocked(ficFetch).mock.calls.every((call) => call[2]?.method !== "POST")).toBe(true);
  });
  it("creates once and blocks replay within the process", async () => {
    const value = ticket("CREATE-1");
    vi.mocked(ficFetch).mockResolvedValueOnce(page([supplier])).mockResolvedValueOnce(page([])).mockResolvedValueOnce({ data: { id: 88 } });
    await expect(createReviewedExpense("test", value)).resolves.toEqual({ id: 88, alreadyExists: false });
    await expect(createReviewedExpense("test", value)).rejects.toThrow("gia avviato");
    expect(vi.mocked(ficFetch).mock.calls.filter((call) => call[2]?.method === "POST")).toHaveLength(1);
  });
  it("blocks mismatched supplier VAT before writing", async () => {
    vi.mocked(ficFetch).mockResolvedValueOnce(page([{ ...supplier, vat_number: "DE12345" }]));
    await expect(createReviewedExpense("test", ticket("MISMATCH"))).rejects.toThrow("VAT");
    expect(vi.mocked(ficFetch).mock.calls.every((call) => call[2]?.method !== "POST")).toBe(true);
  });
  it("does not retry an uncertain write", async () => {
    const value = ticket("TIMEOUT-1");
    vi.mocked(ficFetch).mockResolvedValueOnce(page([supplier])).mockResolvedValueOnce(page([])).mockRejectedValueOnce(new Error("timeout"));
    await expect(createReviewedExpense("test", value)).rejects.toThrow("nessun reinvio automatico");
    await expect(createReviewedExpense("test", value)).rejects.toThrow("gia avviato");
    expect(vi.mocked(ficFetch).mock.calls.filter((call) => call[2]?.method === "POST")).toHaveLength(1);
  });
  it("blocks a company not accessible to the connected account", async () => {
    await expect(createReviewedExpense("test", { ...ticket("COMPANY"), companyId: 999 })).rejects.toThrow("non accessibile");
    expect(ficFetch).not.toHaveBeenCalled();
  });
});
