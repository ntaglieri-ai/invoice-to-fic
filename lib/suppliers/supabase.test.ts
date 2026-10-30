import { describe, expect, it } from "vitest";
import { parseInvoiceText } from "../invoice-parser";
import { invoiceForFic } from "../invoice-conversion";
import { validateTd17 } from "../td17";

const text = `INVOICE
Supabase Pte. Ltd.
65 Chulia Street
Singapore
Bill to:
Example business
Italy
Invoice numberRZWLOS-00009
Invoice dateOct 18, 2026
Due dateOct 18, 2026
Amount due$54.86
Description Quantity Rate Amount
Compute Hours $29.86
Pro Plan $25.00
Memo:
For Singapore: GST is applied
For other countries: Prices are Net
Reverse charge: Customer to account for VAT/GST to their relevant authority
Singapore GST No: 202005760H
Subtotal$54.86
Amount due$54.86`;
const options = { supplierId: 1, documentDate: "2026-10-18", vatId: 1, numeration: "/TD17", paymentMethod: "MP08" };
describe("Supabase Singapore invoices", () => {
  it("extracts number, abbreviated English date, amount due and the printed GST ID", () => {
    const result = parseInvoiceText(text);
    expect(result.invoice).toMatchObject({ supplier: "Supabase", invoice_number: "RZWLOS-00009", invoice_date: "2026-10-18", currency: "USD", supplier_vat: "202005760H", net_amount: 54.86, tax_amount: 0, total_amount: 54.86 });
    expect(result.warnings).toEqual([]);
    expect(result.status).toBe("extracted");
  });
  it("keeps the full GST identifier instead of a customer VAT", () => {
    expect(parseInvoiceText(text.replace("Example business", "Example business\nIT VAT IT02071070664")).invoice.supplier_vat).toBe("202005760H");
  });
  it("never invents the supplier tax identifier if missing", () => {
    const result = parseInvoiceText(text.replace("Singapore GST No: 202005760H", ""));
    expect(result.invoice.supplier_vat).toBe("");
    expect(result.status).toBe("needs_review");
  });
  it("allows TD17 validation only after an explicit USD to EUR conversion", () => {
    const original = parseInvoiceText(text).invoice;
    expect(() => validateTd17(original, options)).toThrow("EUR");
    const euro = invoiceForFic({ ...original, eur_conversion: { rate: 0.9, date: "2026-10-16", source: "manual", confirmed_at: "2026-10-30T12:00:00Z" } });
    expect(euro.total_amount).toBe(49.37);
    expect(() => validateTd17(euro, options)).not.toThrow();
    expect(original.total_amount).toBe(54.86);
  });
  it("does not confuse subtotal with total or silently remove charged VAT", () => {
    const charged = text.replaceAll("Amount due$54.86", "Amount due$65.83").replace("Subtotal$54.86", "Subtotal$54.86\nVAT (20%)$10.97\nTotal$65.83");
    const result = parseInvoiceText(charged);
    expect(result.invoice).toMatchObject({ net_amount: 54.86, tax_amount: 10.97, total_amount: 65.83 });
    expect(result.status).toBe("needs_review");
  });
});
