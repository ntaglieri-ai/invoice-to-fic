import type { ParsedInvoice } from "./types";

export function repairMissingSupabaseTaxId<T extends ParsedInvoice>(existing: T, parsed: ParsedInvoice): T {
  const old = existing.invoice, fresh = parsed.invoice;
  // Only fill a missing identifier after the same document is explicitly re-imported.
  if (old.supplier !== "Supabase" || fresh.supplier !== "Supabase" || old.supplier_vat?.trim() ||
    !/^(?:SG)?\d{9}[A-Z]$/i.test(fresh.supplier_vat) || old.invoice_number !== fresh.invoice_number || old.invoice_date !== fresh.invoice_date ||
    old.currency !== fresh.currency || old.net_amount !== fresh.net_amount || old.tax_amount !== fresh.tax_amount || old.total_amount !== fresh.total_amount) return existing;
  return { ...existing, invoice: { ...old, supplier_vat: fresh.supplier_vat }, warnings: existing.warnings.filter((warning) => warning !== "Campo da verificare: supplier_vat") };
}
