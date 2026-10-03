import { describe, expect, it } from "vitest";
import { invoiceMonth, readInvoiceHistory, serializeInvoiceHistory, type HistoryInvoice } from "./invoice-history";

const item: HistoryInvoice = { id: "one", index: 0, file_name: "invoice.pdf", invoice: { supplier: "OpenAI", invoice_number: "IA-0095", invoice_date: "2026-08-31", currency: "EUR", net_amount: 13.21, tax_amount: 0, total_amount: 13.21, supplier_vat: "IE4143435AH" }, status: "approved", confidence: 0.75, warnings: [], extracted_text_preview: "private preview" };
describe("monthly invoice history", () => {
  it("restores edited fields and approval after a reload", () => {
    const restored = readInvoiceHistory(serializeInvoiceHistory([item]));
    expect(restored[0].invoice).toEqual(item.invoice);
    expect(restored[0].status).toBe("approved");
    expect(restored[0].extracted_text_preview).toBe("");
  });
  it("groups by invoice month and keeps undated invoices accessible", () => {
    expect(invoiceMonth(item)).toBe("2026-08");
    expect(invoiceMonth({ ...item, invoice: { ...item.invoice, invoice_date: "" } })).toBe("undated");
  });
  it("handles malformed storage", () => {
    expect(readInvoiceHistory("broken")).toEqual([]);
    expect(readInvoiceHistory('[{"id":"bad"}]')).toEqual([]);
  });
});
