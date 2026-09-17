import { expect, it } from "vitest";
import { expensePreferencesKey, matchExpenseSupplier, parseExpensePreferences, suggestedForeignDocument, suggestedSaasPreferences } from "./expense-preferences";
import { validateExpense, validateExpensePreparation } from "./expense-validation";
import type { InvoiceFields } from "./types";

const invoice: InvoiceFields = { supplier: "OpenAI", invoice_number: "IA8NO7NL-0095", invoice_date: "2026-08-31", currency: "EUR", net_amount: 13.21, tax_amount: 0, total_amount: 13.21, supplier_vat: "IE4143435AH" };
const options = { supplierId: 8, dueDate: "2026-08-31", taxDeductibility: null, vatDeductibility: null };

it("permits preparing an incomplete draft but never permits writing it", () => {
  expect(() => validateExpensePreparation(invoice, options)).not.toThrow();
  expect(() => validateExpense(invoice, options)).toThrow("da confermare");
});
it("does not turn blank or invalid fiscal settings into zero", () => {
  for (const value of ["", "100", -1, 101, undefined, NaN]) {
    expect(() => validateExpensePreparation(invoice, { ...options, taxDeductibility: value })).toThrow();
  }
  expect(() => validateExpense(invoice, { ...options, taxDeductibility: 0, vatDeductibility: 0 })).not.toThrow();
});
it("keeps invoice validation active for drafts", () => {
  expect(() => validateExpensePreparation({ ...invoice, total_amount: 999 }, options)).toThrow();
  expect(() => validateExpensePreparation(invoice, { ...options, supplierId: 0 })).toThrow();
});
it("pre-fills 100/100 for recognized SaaS suppliers only", () => {
  expect(suggestedSaasPreferences(invoice)).toEqual({ taxDeductibility: 100, vatDeductibility: 100 });
  expect(suggestedSaasPreferences({ ...invoice, supplier: "Anthropic" })).toEqual({ taxDeductibility: 100, vatDeductibility: 100 });
  expect(suggestedSaasPreferences({ ...invoice, supplier: "Sconosciuto" })).toBeNull();
});
it("proposes TD17 only for recognized services without supplier VAT charged or an Italian VAT identity", () => {
  expect(suggestedForeignDocument(invoice)).toBe("TD17");
  expect(suggestedForeignDocument({ ...invoice, tax_amount: 2.91 })).toBeNull();
  expect(suggestedForeignDocument({ ...invoice, supplier_vat: "IT12345678901" })).toBeNull();
  expect(suggestedForeignDocument({ ...invoice, supplier: "Sconosciuto" })).toBeNull();
});
it("isolates saved preferences by company and FIC supplier", () => {
  expect(expensePreferencesKey(1, 8)).not.toBe(expensePreferencesKey(2, 8));
  expect(expensePreferencesKey(1, 8)).not.toBe(expensePreferencesKey(1, 9));
});
it("ignores corrupted or incompatible browser preferences", () => {
  for (const raw of [null, "broken", "null", '{"version":2}', '{"version":1,"taxDeductibility":null,"vatDeductibility":100}']) expect(parseExpensePreferences(raw)).toBeNull();
  expect(parseExpensePreferences(JSON.stringify({ version: 1, taxDeductibility: 75, vatDeductibility: 0 }))).toEqual({ taxDeductibility: 75, vatDeductibility: 0 });
});
it("auto-selects only a unique VAT match, never a guessed name", () => {
  const supplier = { id: 8, name: "OpenAI Ireland", vat_number: "IE4143435AH" };
  expect(matchExpenseSupplier([supplier], " ie4143435ah ")).toEqual(supplier);
  expect(matchExpenseSupplier([supplier], "")).toBeNull();
  expect(matchExpenseSupplier([supplier, { ...supplier, id: 9 }], invoice.supplier_vat)).toBeNull();
  expect(matchExpenseSupplier([{ ...supplier, vat_number: "OTHER" }], invoice.supplier_vat)).toBeNull();
});
