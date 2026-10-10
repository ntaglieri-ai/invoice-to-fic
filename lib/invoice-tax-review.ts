import type { InvoiceFields } from "./types";

export function invoiceTaxReview(invoice: InvoiceFields): string | undefined {
  const chargedVat = typeof invoice.tax_amount === "number" && invoice.tax_amount > 0;
  const totalIncludesTax = typeof invoice.total_amount === "number" && typeof invoice.net_amount === "number" && Math.round(invoice.total_amount * 100) > Math.round(invoice.net_amount * 100);
  if (!chargedVat && !totalIncludesTax) return undefined;
  return "IVA addebitata nel totale: da verificare. Se l'acquisto e personale, non procedere con il TD17. Se riguarda l'attivita, verifica intestazione, partita IVA cliente e trattamento IVA con il commercialista; potrebbe servire una fattura corretta. Non azzerare l'IVA per sbloccare il documento.";
}
