import { expect, test } from "vitest";
import { acceptRegisteredExpenses, reconcileFicProcessing } from "./fic-sync";
import type { ManagedInvoice } from "./invoice-memory";
import { processingKey } from "./processing-state";

const invoice: ManagedInvoice = { id: "one", index: 0, file_name: "one.pdf", status: "approved", confidence: 1, warnings: [], extracted_text_preview: "", invoice: { supplier: "OpenAI", invoice_number: "INV-001", invoice_date: "2026-10-01", currency: "EUR", net_amount: 10, tax_amount: 0, total_amount: 10, supplier_vat: "IE4143435AH" } };
const key = processingKey("1", invoice.invoice);
const oldTime = "2026-10-01T00:00:00Z";
const now = "2026-10-10T00:00:00Z";
test("explicit bulk acceptance affects verified expenses only, not N/A, payments or TD17", () => {
  const items = Array.from({ length: 31 }, (_, index) => ({ ...invoice, id: String(index), invoice: { ...invoice.invoice, invoice_number: `INV-${index}` } }));
  const excluded = { ...invoice, id: "excluded", not_applicable: true };
  const missing = { ...invoice, id: "missing", invoice: { ...invoice.invoice, invoice_number: "MISSING" } };
  const recovered = [...items, excluded].map((item, index) => ({ ...item, processing: { expenseId: index + 1, updatedAt: now } }));
  const result = acceptRegisteredExpenses([...items, excluded, missing], recovered, "1", now);
  expect(result.filter((item) => item.expense_acceptance).length).toBe(31);
  expect(result[31]).toBe(excluded);
  expect(result[32]).toBe(missing);
  expect(result[0].invoice).toBe(items[0].invoice);
  expect(result[0].status).toBe(items[0].status);
  expect(result[0].processing).toBeUndefined();
  expect(acceptRegisteredExpenses(result, recovered, "1", "2026-10-11T00:00:00Z")[0]).toBe(result[0]);
});

test("unchanged FIC verification preserves identity and does not trigger another save", () => {
  const current = { [key]: { expenseId: 12, td17Id: 14, td17State: "not_sent" as const, td17EiStatus: "not_sent", updatedAt: oldTime } };
  const recovered = [{ ...invoice, processing: { ...current[key], updatedAt: now } }];
  expect(reconcileFicProcessing(current, "1", recovered, [{ key, expenseId: 12, td17Id: 14, td17EiStatus: "not_sent" }], now)).toBe(current);
});

test("changed delivery is persisted once, retaining the previous immutable snapshot", () => {
  const current = { [key]: { expenseId: 12, td17Id: 14, td17State: "not_sent" as const, td17EiStatus: "not_sent", updatedAt: oldTime } };
  const next = reconcileFicProcessing(current, "1", [], [{ key, td17EiStatus: "sent" }], now);
  expect(next[key].td17State).toBe("sent");
  expect(next[key].updatedAt).toBe(now);
  expect(current[key].td17State).toBe("not_sent");
  expect(reconcileFicProcessing(next, "1", [], [{ key, td17EiStatus: "sent" }], "2026-10-11T00:00:00Z")).toBe(next);
});
test("FIC reversal is persisted while preserving TD17 delivery and expense ID", () => {
  const current = { [key]: { expenseId: 12, td17Id: 14, td17State: "not_sent" as const, expensePaymentState: "not_paid" as const, updatedAt: oldTime } };
  const next = reconcileFicProcessing(current, "1", [], [{ key, expensePaymentState: "reversed" }], now);
  expect(next[key]).toMatchObject({ expenseId: 12, td17Id: 14, td17State: "not_sent", expensePaymentState: "reversed" });
  expect(reconcileFicProcessing(next, "1", [], [{ key, expensePaymentState: "reversed" }], now)).toBe(next);
});

test("confirmed deletion overrides earlier recovery without restoring the deleted TD17", () => {
  const current = { [key]: { expenseId: 12, td17Id: 14, td17State: "not_sent" as const, updatedAt: oldTime } };
  const next = reconcileFicProcessing(current, "1", [{ ...invoice, processing: current[key] }], [{ key, td17Exists: false }], now);
  expect(next[key].expenseId).toBe(12);
  expect(next[key].td17Id).toBeUndefined();
  expect(next[key].td17State).toBeUndefined();
});
test("a background response cannot undo a reset made while it was in flight", () => {
  const baseline = { [key]: { expenseId: 12, td17Id: 14, updatedAt: oldTime } };
  const current = {};
  expect(reconcileFicProcessing(current, "1", [{ ...invoice, processing: baseline[key] }], [{ key, td17EiStatus: "sent" }], now, baseline)).toBe(current);
});
test("a complete FIC month clears manually deleted TD17s, preserving registered expenses", () => {
  const current = { [key]: { expenseId: 12, td17Id: 14, td17State: "not_sent" as const, td17EiStatus: "not_sent", updatedAt: oldTime } };
  const snapshot = [{ ...invoice, processing: { expenseId: 12, updatedAt: now } }];
  const next = reconcileFicProcessing(current, "1", snapshot, [], now, current);
  expect(next[key].expenseId).toBe(12);
  expect(next[key].td17Id).toBeUndefined();
  expect(next[key].td17State).toBeUndefined();
  expect(next[key].td17EiStatus).toBeUndefined();
});
