import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
vi.mock("@/lib/fatture-in-cloud", () => ({ ficFetch: vi.fn(), listUserCompanies: vi.fn() }));
import { ficFetch, listUserCompanies } from "@/lib/fatture-in-cloud";
import { createTd17, findExistingTd17, previewTd17, readTd17Ticket, signTd17Ticket, td17Settings } from "@/lib/fic-td17";
import { buildTd17Payload, eligibleTd17Vat, td17Amounts, validateTd17, type Td17Options, type Td17Supplier } from "@/lib/td17";
import type { InvoiceFields } from "@/lib/types";

const invoice: InvoiceFields = { supplier: "OpenAI", invoice_number: "IA8NO7NL-0094", invoice_date: "2026-08-31", currency: "EUR", net_amount: 12.82, tax_amount: 0, total_amount: 12.82, supplier_vat: "IE4143435AH" };
const options: Td17Options = { supplierId: 8, documentDate: "2026-08-31", vatId: 0, numeration: "/TD17", paymentMethod: "MP08" };
const supplier: Td17Supplier = { id: 8, name: "OpenAI Ireland Limited", vat_number: "IE4143435AH", country: "Irlanda", address_street: "Test street 1", address_city: "Dublin", address_postal_code: "00000", address_province: "EE", address_extra: "" };
const vat = { id: 0, value: 22, e_invoice: true, ei_type: "0" };
const page = (data: unknown[], last_page = 1) => ({ data, last_page });
let documents: unknown[];
let source: typeof invoice;
let currentSupplier: Td17Supplier;
let currentVat: typeof vat;
let totalsMismatch: boolean;
let missingExpense: boolean;
let uncertainWrite: boolean;
let invalidXml: boolean;
let sequence = 0;

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("FIC_SESSION_SECRET", "test-only-td17-key");
  source = { ...invoice, invoice_number: `TEST-${++sequence}` };
  documents = []; currentSupplier = { ...supplier }; currentVat = { ...vat };
  totalsMismatch = missingExpense = uncertainWrite = invalidXml = false;
  vi.mocked(listUserCompanies).mockResolvedValue([{ id: 123, name: "Test Company", type: "company" }]);
  vi.mocked(ficFetch).mockImplementation(async (_token, path, init) => {
    if (path.includes("/entities/suppliers/8")) return { data: currentSupplier };
    if (path.includes("/received_documents?")) return page(missingExpense ? [] : [{ id: 44, invoice_number: source.invoice_number, entity: { id: 8 } }]);
    if (path.includes("/received_documents/44")) return { data: { id: 44, type: "expense", invoice_number: source.invoice_number, entity: { id: 8, vat_number: supplier.vat_number }, date: invoice.invoice_date, amount_net: 12.82, amount_vat: 0, currency: { id: "EUR" } } };
    if (path.includes("/issued_documents/info")) return { data: { vat_types_list: [currentVat] } };
    if (path.includes("/issued_documents?")) return page(documents);
    if (path.endsWith("/issued_documents/totals")) return { data: { amount_net: totalsMismatch ? 99 : 12.82, amount_vat: 2.82, amount_gross: 15.64 } };
    if (path.endsWith("/issued_documents") && init?.method === "POST") {
      if (uncertainWrite) throw new Error("timeout");
      return { data: { id: 900, number: 1, numeration: "/TD17", ei_status: "not_sent" } };
    }
    if (path.endsWith("/e_invoice/xml_verify")) {
      if (invalidXml) throw new Error("XML validation error");
      return { data: { success: true } };
    }
    throw new Error(`Unexpected API call: ${path}`);
  });
});
afterEach(() => vi.unstubAllEnvs());

const writes = () => vi.mocked(ficFetch).mock.calls.filter(([, path, init]) => path.endsWith("/issued_documents") && init?.method === "POST");
async function ticket() {
  const preview = await previewTd17("token", 123, source, options, "owner");
  if (!("ticket" in preview)) throw new Error("Expected preview");
  return readTd17Ticket(preview.ticket, "owner");
}

describe("TD17 payload", () => {
  it("sets the Italian buyer's FIC routing code on the document, not on the supplier registry", () => {
    const payload = buildTd17Payload(invoice, options, supplier, vat, "marker");
    expect(payload.entity.ei_code).toBe("M5UXCR1");
    expect(supplier).not.toHaveProperty("ei_code");
  });
  it("rejects the actual 64-character OpenAI address without truncating it", () => {
    const address = "1st Floor, The Liffey Trust Center, 117-126 Sheriff Street Upper";
    expect(address.length).toBe(64);
    expect(() => buildTd17Payload(invoice, options, { ...supplier, address_street: address }, vat, "marker")).toThrow("massimo 60 caratteri");
    const corrected = "1st Floor, Liffey Trust Center, 117-126 Sheriff Street Upper";
    expect(corrected.length).toBe(60);
    expect(buildTd17Payload(invoice, options, { ...supplier, address_street: corrected }, vat, "marker").entity.address_street).toBe(corrected);
  });
  it("rejects invalid city length and address line breaks", () => {
    expect(() => buildTd17Payload(invoice, options, { ...supplier, address_city: "X".repeat(61) }, vat, "marker")).toThrow("Comune");
    expect(() => buildTd17Payload(invoice, options, { ...supplier, address_street: "Street\nUpper" }, vat, "marker")).toThrow("Indirizzo");
  });
  it.each([
    { id: 0, value: 22 },
    { id: 0, value: 22, e_invoice: null, is_disabled: null, ei_type: null },
    { id: 0, value: 22, e_invoice: true, is_disabled: false, ei_type: "0" },
  ])("accepts ordinary positive VAT with optional FIC metadata: %j", (rate) => {
    expect(eligibleTd17Vat(rate)).toBe(true);
    expect(buildTd17Payload(invoice, options, supplier, rate, "marker").items_list[0].vat.id).toBe(0);
  });
  it.each([
    { id: 0, value: 22, e_invoice: false },
    { id: 0, value: 22, is_disabled: true },
    { id: 0, value: 22, ei_type: "N6.9" },
    { id: 0, value: 0 }, { id: -1, value: 22 }, { id: 0, value: NaN },
  ])("still rejects incompatible VAT: %j", (rate) => {
    expect(eligibleTd17Vat(rate)).toBe(false);
  });
  it("loads nullable pre-create metadata without losing the 22 percent rate", async () => {
    vi.mocked(ficFetch).mockResolvedValueOnce({ data: { vat_types_list: [{ id: 0, value: 22, e_invoice: null, is_disabled: null, ei_type: null }] } });
    expect(await td17Settings("token", 123)).toMatchObject({ vatTypes: [{ id: 0, value: 22 }], warning: undefined });
  });
  it("returns an actionable warning instead of failing the entire settings response", async () => {
    const log = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      vi.mocked(ficFetch).mockResolvedValueOnce({ data: { vat_types_list: [{ id: 0, value: 22, e_invoice: false }] } });
      expect(await td17Settings("token", 123)).toMatchObject({ vatTypes: [], warning: expect.any(String) });
    } finally { log.mockRestore(); }
  });
  it("uses the foreign supplier as seller, preserves references, integrates VAT and reverses the extra payment", () => {
    const payload = buildTd17Payload(invoice, options, supplier, vat, "marker");
    expect(payload).toMatchObject({ type: "self_supplier_invoice", entity: supplier, e_invoice: true, rc_center: "WEB", numeration: "/TD17", payments_list: [{ amount: 15.64, status: "reversed" }], items_list: [{ net_price: 12.82, vat: { id: 0 } }] });
    expect(payload.ei_raw.FatturaElettronicaBody.DatiGenerali).toEqual({ DatiGeneraliDocumento: { TipoDocumento: "TD17" }, DatiFattureCollegate: [{ IdDocumento: "IA8NO7NL-0094", Data: "2026-08-31" }] });
    expect(payload).not.toHaveProperty("number");
    expect(payload).not.toHaveProperty("ei_status");
    expect(payload).not.toHaveProperty("attachment_token");
    expect(invoice.tax_amount).toBe(0);
  });
  it("rounds reverse charge amounts to cents", () => {
    expect(td17Amounts(13.21, 22)).toEqual({ net: 13.21, tax: 2.91, total: 16.12 });
  });
  it.each([{ currency: "USD" }, { tax_amount: 1, total_amount: 13.82 }, { supplier_vat: "IT12345678901" }, { supplier_vat: "" }, { invoice_number: "A".repeat(21) }, { supplier: "Sconosciuto" }, { net_amount: 0, total_amount: 0 }])("rejects unsupported invoice %j", (change) => {
    expect(() => validateTd17({ ...invoice, ...change } as InvoiceFields, options)).toThrow();
  });
  it.each([{ documentDate: "2026-02-30" }, { vatId: -1 }, { supplierId: 0 }, { numeration: "bad\nvalue" }, { paymentMethod: "fake" }])("rejects invalid settings %j", (change) => {
    expect(() => validateTd17(invoice, { ...options, ...change })).toThrow();
  });
});

describe("TD17 workflow", () => {
  it("only reads and calculates during preview", async () => {
    const preview = await previewTd17("token", 123, source, options, "owner");
    expect(preview).toMatchObject({ expenseId: 44, net: 12.82, tax: 2.82, total: 15.64 });
    expect(writes()).toHaveLength(0);
  });
  it("rejects a changed ticket, session, expiration, or expense ticket", async () => {
    const value = await ticket();
    expect(() => readTd17Ticket(signTd17Ticket(value), "other")).toThrow();
    expect(() => readTd17Ticket(signTd17Ticket({ ...value, expiresAt: 1 }), "owner")).toThrow();
    const signed = signTd17Ticket(value);
    expect(() => readTd17Ticket(signed.slice(0, -4) + "aaaa", "owner")).toThrow();
    expect(() => readTd17Ticket("expense.ticket", "owner")).toThrow();
  });
  it("creates exactly one unsent document, verifies XML, and never sends or creates another expense", async () => {
    const value = await ticket();
    expect(await createTd17("token", value)).toMatchObject({ id: 900, eiStatus: "not_sent", xmlValid: true, alreadyExists: false });
    expect(writes()).toHaveLength(1);
    expect(vi.mocked(ficFetch).mock.calls.some(([, path]) => path.includes("/send") || path.includes("/email"))).toBe(false);
    expect(vi.mocked(ficFetch).mock.calls.filter(([, , init]) => init?.method === "POST").map(([, path]) => path)).toEqual(["/c/123/issued_documents/totals", "/c/123/issued_documents"]);
    await expect(createTd17("token", value)).rejects.toThrow("gia avviata");
    expect(writes()).toHaveLength(1);
  });
  it("detects manually created TD17 references, including already sent documents", async () => {
    documents = [{ id: 77, ei_status: "sent", entity: { vat_number: supplier.vat_number }, ei_raw: { FatturaElettronicaBody: { DatiGenerali: { DatiGeneraliDocumento: { TipoDocumento: "TD17" }, DatiFattureCollegate: [{ IdDocumento: source.invoice_number, Data: source.invoice_date }] } } } }];
    expect(await previewTd17("token", 123, source, options, "owner")).toMatchObject({ existing: { id: 77, eiStatus: "sent", alreadyExists: true } });
    expect(writes()).toHaveLength(0);
  });
  it("checks duplicates again just before saving", async () => {
    const value = await ticket();
    const calculateCall = vi.mocked(ficFetch).mock.calls.find(([, path]) => path.endsWith("/totals"))!;
    documents = [{ id: 78, subject: JSON.parse(String(calculateCall[2]!.body)).data.subject, ei_status: "not_sent" }];
    expect(await createTd17("token", value)).toMatchObject({ id: 78, alreadyExists: true });
    expect(writes()).toHaveLength(0);
  });
  it("refuses incomplete pagination", async () => {
    vi.mocked(ficFetch).mockResolvedValueOnce({ data: [] });
    await expect(findExistingTd17("token", 123, source, supplier)).rejects.toThrow("incompleto");
  });
  it("blocks a missing expense or different amounts", async () => {
    missingExpense = true;
    await expect(ticket()).rejects.toThrow("Registra prima");
    missingExpense = false;
    source = { ...source, net_amount: 15, total_amount: 15 };
    await expect(ticket()).rejects.toThrow("non coincide");
    expect(writes()).toHaveLength(0);
  });
  it("requires a complete foreign supplier and matching VAT", async () => {
    currentSupplier = { ...supplier, country: "Italia" };
    await expect(ticket()).rejects.toThrow("anagrafica estera");
    currentSupplier = { ...supplier, address_city: "" };
    await expect(ticket()).rejects.toThrow("anagrafica estera");
    currentSupplier = { ...supplier, vat_number: "IEOTHER" };
    await expect(ticket()).rejects.toThrow("anagrafica estera");
  });
  it("blocks changed supplier or VAT settings after confirmation preview", async () => {
    const value = await ticket();
    currentSupplier = { ...supplier, address_street: "Changed address" };
    await expect(createTd17("token", value)).rejects.toThrow("Dati FIC cambiati");
    currentSupplier = supplier; currentVat = { ...vat, value: 10 };
    await expect(createTd17("token", value)).rejects.toThrow("Dati FIC cambiati");
    expect(writes()).toHaveLength(0);
  });
  it("blocks a total calculation mismatch", async () => {
    totalsMismatch = true;
    await expect(ticket()).rejects.toThrow("Totali FIC non coincidenti");
    expect(writes()).toHaveLength(0);
  });
  it("retains a created document id when XML validation fails", async () => {
    const value = await ticket(); invalidXml = true;
    expect(await createTd17("token", value)).toMatchObject({ id: 900, xmlValid: null, warning: expect.stringContaining("senza ricrearlo") });
    expect(writes()).toHaveLength(1);
  });
  it("does not retry uncertain writes", async () => {
    const value = await ticket(); uncertainWrite = true;
    await expect(createTd17("token", value)).rejects.toThrow("Esito creazione TD17 non confermato");
    await expect(createTd17("token", value)).rejects.toThrow("gia avviata");
    expect(writes()).toHaveLength(1);
  });
  it("rejects simultaneous submissions in the same process", async () => {
    const value = await ticket();
    const first = createTd17("token", value);
    await expect(createTd17("token", value)).rejects.toThrow("gia avviata");
    await first;
    expect(writes()).toHaveLength(1);
  });
});
