import { expect, it } from "vitest";
import { invoiceTaxReview } from "./invoice-tax-review";
import { parseInvoiceText } from "./invoice-parser";
import { invoiceErrors, validateExpensePreparation } from "./expense-validation";
import { nextInvoiceAction } from "./invoice-workflow";
import { EMPTY_INVOICE } from "./suppliers/common";

it.each([["7358273", 30, 6.6, 36.6], ["7417682", 20, 4.4, 24.4]])("flags Anthropic invoice %s with charged VAT without changing amounts", (number, net, vat, total) => {
  const parsed = parseInvoiceText(`Anthropic Ireland, Limited\nIE VAT IE4276970QH\nInvoice number 9BF0758D-${number}\nDate of issue October 1, 2026\nBill to\nn.taglieri@gmail.com's Organization\nItaly\nSubtotal EUR${net}\nVAT - Italy (22% on EUR${net}) EUR${vat}\nTotal EUR${total}`);
  expect(parsed.invoice.net_amount).toBe(net);
  expect(parsed.invoice.tax_amount).toBe(vat);
  expect(parsed.invoice.total_amount).toBe(total);
  expect(parsed.status).toBe("needs_review");
  expect(parsed.warnings.join(" ")).toContain("IVA addebitata nel totale");
  expect(invoiceErrors(parsed.invoice).join(" ")).toContain("IVA addebitata");
  expect(nextInvoiceAction({ ...parsed, id: "pdf", status: "approved", ficId: 1 })).toBe("review");
  expect(() => validateExpensePreparation(parsed.invoice, { supplierId: 1, taxDeductibility: 100, vatDeductibility: 100, dueDate: "2026-10-01" })).toThrow("IVA addebitata");
});
it("flags included tax even if the extracted VAT is missing or incorrectly zero", () => {
  expect(invoiceTaxReview({ ...EMPTY_INVOICE, net_amount: 30, total_amount: 36.6, tax_amount: null })).toBeTruthy();
  expect(invoiceTaxReview({ ...EMPTY_INVOICE, net_amount: 30, total_amount: 36.6, tax_amount: 0 })).toBeTruthy();
});
it("does not block a zero-VAT invoice or assume a charged-VAT invoice is personal", () => {
  expect(invoiceTaxReview({ ...EMPTY_INVOICE, net_amount: 30, total_amount: 30, tax_amount: 0 })).toBeUndefined();
  expect(invoiceTaxReview({ ...EMPTY_INVOICE, customer_vat: "IT02071070664", tax_amount: 6.6 })).toContain("Se riguarda l'attivita");
});
