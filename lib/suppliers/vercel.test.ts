import { expect, it } from "vitest";
import { parseInvoiceText } from "../invoice-parser";
const text = `Invoice
Invoice number7R20H5XD\u00000091
Date of issueOctober 13, 2026
Date dueOctober 13, 2026
Vercel Inc.
Bill to
Example business
$36.60 USD due October 13, 2026
Vercel VAT ID\u0000 EU056329113
Subtotal$30.00
Total excluding tax$30.00
Standard Rate - ITALY \u000022% on $30.00\u0000$6.60
Total$36.60
Amount due$36.60 USD`;
it("places Stripe-style Vercel invoices in their actual issue month and preserves full number", () => {
  const result = parseInvoiceText(text);
  expect(result.invoice).toMatchObject({ supplier: "Vercel", invoice_number: "7R20H5XD-0091", invoice_date: "2026-10-13", currency: "USD", supplier_vat: "EU056329113", net_amount: 30, tax_amount: 6.6, total_amount: 36.6 });
  expect(result.warnings).not.toContain("Data fattura mancante o incerta.");
  expect(result.status).toBe("needs_review");
});
it("never assigns the selected month when the issue date is absent", () => {
  expect(parseInvoiceText(text.replace("Date of issueOctober 13, 2026", "")).invoice.invoice_date).toBe("");
});
it("still parses the Invoice date format without truncation", () => {
  expect(parseInvoiceText(text.replace("Date of issue", "Invoice date").replace("\u00000091", "-0091")).invoice.invoice_date).toBe("2026-10-13");
});
