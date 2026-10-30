import { expect, it } from "vitest";
import { repairMissingSupabaseTaxId } from "./supplier-tax-repair";
import type { ParsedInvoice } from "./types";
const invoice: ParsedInvoice & { id: string; driveId: string; processing: { expenseId: number } } = { id: "existing", driveId: "pdf", processing: { expenseId: 123 }, index: 0, file_name: "supabase.pdf", invoice: { supplier: "Supabase", invoice_number: "RZWLOS-00009", invoice_date: "2026-10-18", currency: "USD", net_amount: 54.86, tax_amount: 0, total_amount: 54.86, supplier_vat: "" }, confidence: 0.5, status: "needs_review", warnings: ["Campo da verificare: supplier_vat"], extracted_text_preview: "" };
const parsed = { ...invoice, invoice: { ...invoice.invoice, supplier_vat: "202005760H" }, warnings: [] };
it("repairs only the missing GST on explicit re-import, preserving IDs, financials and processing", () => {
  const result = repairMissingSupabaseTaxId(invoice, parsed);
  expect(result.invoice.supplier_vat).toBe("202005760H");
  expect(result.id).toBe("existing"); expect(result.driveId).toBe("pdf"); expect(result.processing).toBe(invoice.processing);
  expect(result.invoice.total_amount).toBe(54.86); expect(result.invoice.currency).toBe("USD"); expect(result.status).toBe("needs_review");
  expect(result.warnings).toEqual([]);
});
it("does not overwrite identifiers or repair a different document", () => {
  expect(repairMissingSupabaseTaxId(parsed, parsed)).toBe(parsed);
  for (const change of [{ invoice_number: "RZWLOS-00008" }, { invoice_date: "2026-10-19" }]) expect(repairMissingSupabaseTaxId(invoice, { ...parsed, invoice: { ...parsed.invoice, ...change } })).toBe(invoice);
});
it("repairs the tax ID on an already converted FIC expense, without changing euros", () => {
  const euro = { ...invoice, invoice: { ...invoice.invoice, currency: "EUR", net_amount: 49.37, total_amount: 49.37 } };
  const result = repairMissingSupabaseTaxId(euro, parsed);
  expect(result.invoice).toEqual({ ...euro.invoice, supplier_vat: "202005760H" });
  expect(result.processing.expenseId).toBe(123);
});
