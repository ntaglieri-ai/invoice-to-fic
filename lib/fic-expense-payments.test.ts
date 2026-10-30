import { afterEach, beforeEach, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
vi.mock("./fatture-in-cloud", () => ({ ficFetch: vi.fn() }));
vi.mock("./fic-expenses", () => ({ requireCompany: vi.fn() }));
import { ficFetch } from "./fatture-in-cloud";
import { requireCompany } from "./fic-expenses";
import { previewExpenseReversals, readReversalTicket, reversedPayments, reverseExpensePayments, type ExpenseForReversal } from "./fic-expense-payments";
import { expensePaymentState } from "./expense-payment-state";
const original: ExpenseForReversal = { id: 12, type: "expense", invoice_number: "IA8NO7NL-0160", date: "2026-09-13", entity: { id: 2, name: "OpenAI", vat_number: "IE4143435AH" }, amount_net: 12.33, amount_vat: 0, amount_gross: 12.33, currency: { id: "EUR" }, payments_list: [{ id: 9, amount: 12.33, due_date: "2026-09-13", paid_date: null, payment_account: null, status: "not_paid", payment_terms: { days: 0, type: "standard" } }] };
let doc: ExpenseForReversal;
beforeEach(() => {
  vi.resetAllMocks(); vi.stubEnv("FIC_SESSION_SECRET", "reversal-test-only"); doc = structuredClone(original);
  vi.mocked(requireCompany).mockResolvedValue({ id: 1, name: "Test", type: "company" });
  vi.mocked(ficFetch).mockImplementation(async (_token, _path, init) => {
    if (init?.method === "PUT") doc.payments_list = JSON.parse(init.body as string).data.payments_list;
    return { data: structuredClone(doc) };
  });
});
afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks(); });
it("changes only not_paid to reversed, preserving paid and reversed installments", () => {
  const paid = { ...original.payments_list[0], id: 10, status: "paid", paid_date: "2026-09-13", payment_account: { id: 88 } };
  const already = { ...original.payments_list[0], id: 11, status: "reversed" };
  const result = reversedPayments({ ...original, payments_list: [...original.payments_list, paid, already] });
  expect(result[0]).toEqual({ ...original.payments_list[0], status: "reversed" });
  expect(result[1]).toBe(paid); expect(result[2]).toBe(already);
  expect(original.payments_list[0].status).toBe("not_paid");
});
it("previews using reads only and restricts company, month and document type", async () => {
  const plan = await previewExpenseReversals("mock", 1, [12], "owner");
  expect(plan.documents.map((item) => item.id)).toEqual([12]);
  expect(vi.mocked(ficFetch).mock.calls.every(([, path, init]) => path.includes("received_documents/12") && !init?.method)).toBe(true);
  for (const change of [{ type: "self_supplier_invoice" }, { date: "2026-10-01" }, { date: "2026-09-31" }]) expect(() => reversedPayments({ ...original, ...change })).toThrow();
  expect(requireCompany).toHaveBeenCalledWith("mock", 1);
});
it("requires an unaltered, unexpired ticket tied to the login", async () => {
  const plan = await previewExpenseReversals("mock", 1, [12], "owner");
  expect(() => readReversalTicket(plan.ticket, "other")).toThrow();
  expect(() => readReversalTicket(`bad.${plan.ticket.split(".")[1]}`, "owner")).toThrow();
  vi.spyOn(Date, "now").mockReturnValue(Date.now() + 16 * 60000);
  expect(() => readReversalTicket(plan.ticket, "owner")).toThrow();
});
it("writes the real FIC expense and reads back the reversed status, with no account or new dates", async () => {
  const plan = await previewExpenseReversals("mock", 1, [12], "owner");
  const result = await reverseExpensePayments("mock", readReversalTicket(plan.ticket, "owner"), 12);
  expect(result).toEqual({ id: 12, paymentState: "reversed", alreadySettled: false });
  const writes = vi.mocked(ficFetch).mock.calls.filter(([, , init]) => init?.method);
  expect(writes).toHaveLength(1);
  expect(writes[0][1]).toBe("/c/1/received_documents/12");
  expect(writes[0][2]?.method).toBe("PUT");
  expect(JSON.parse(writes[0][2]?.body as string)).toEqual({ data: { payments_list: [{ ...original.payments_list[0], status: "reversed" }] } });
  expect({ ...doc, payments_list: original.payments_list }).toEqual(original);
});
it("does not overwrite a changed amount or unexpected rate status", async () => {
  const plan = await previewExpenseReversals("mock", 1, [12], "owner"); doc.amount_net = 99;
  await expect(reverseExpensePayments("mock", readReversalTicket(plan.ticket, "owner"), 12)).rejects.toThrow("modificata");
  expect(vi.mocked(ficFetch).mock.calls.some(([, , init]) => init?.method)).toBe(false);
  expect(() => reversedPayments({ ...original, payments_list: [{ ...original.payments_list[0], status: "unknown" }] })).toThrow();
});
it("never downgrades an already paid expense, creates a second expense or touches a TD17", async () => {
  const plan = await previewExpenseReversals("mock", 1, [12], "owner"); doc.payments_list[0].status = "paid";
  expect(await reverseExpensePayments("mock", readReversalTicket(plan.ticket, "owner"), 12)).toMatchObject({ paymentState: "paid", alreadySettled: true });
  expect(vi.mocked(ficFetch).mock.calls.every(([, path, init]) => path.includes("received_documents") && !init?.method)).toBe(true);
});
it("does not retry an uncertain write or announce success without a matching FIC read", async () => {
  const plan = await previewExpenseReversals("mock", 1, [12], "owner");
  vi.mocked(ficFetch).mockImplementation(async (_token, _path, init) => { if (init?.method === "PUT") throw new Error("timeout"); return { data: structuredClone(doc) }; });
  await expect(reverseExpensePayments("mock", readReversalTicket(plan.ticket, "owner"), 12)).rejects.toThrow("non confermato");
  expect(vi.mocked(ficFetch).mock.calls.filter(([, , init]) => init?.method === "PUT")).toHaveLength(1);
});
it("classifies FIC payment states without conflating reversed with paid", () => {
  expect(expensePaymentState([{ status: "reversed" }])).toBe("reversed");
  expect(expensePaymentState([{ status: "paid" }])).toBe("paid");
  expect(expensePaymentState([{ status: "paid" }, { status: "not_paid" }])).toBe("not_paid");
  expect(expensePaymentState([{ status: "paid" }, { status: "reversed" }])).toBe("mixed");
  expect(expensePaymentState([{ status: "unknown" }])).toBeUndefined();
});
