import type { InvoiceFields } from "@/lib/types";

export function extractCustomerVat(text: string): string {
  // Stripe puts the supplier VAT before Bill to. Never search that section.
  const billing = text.split(/\bBill\s+to\b/i)[1]?.split(/\b(?:Ship\s+to|Description|Qty|Quantity|Subtotal|Amount\s+due)\b/i)[0];
  if (!billing) return "";
  const matches = [...billing.matchAll(/\b(?:IT\s*)?VAT(?:\s*(?:ID|number|no\.?))?\s*[:#]?\s*(IT\s*\d{11})(?!\d)/gi)];
  const values = [...new Set(matches.map((match) => match[1].replace(/\s/g, "").toUpperCase()))];
  return values.length === 1 ? values[0] : "";
}

function italianVat(value: unknown): string {
  if (typeof value !== "string") return "";
  const normalized = value.replace(/\s/g, "").toUpperCase();
  return /^(?:IT)?\d{11}$/.test(normalized) ? normalized.replace(/^IT/, "") : "";
}

export function customerVatIssue(invoice: InvoiceFields, companyVat: unknown): string | null {
  if (invoice.supplier !== "Anthropic") return null;
  const customer = italianVat(invoice.customer_vat);
  if (!customer) return "Partita IVA cliente assente o incerta: verifica l'intestazione del PDF prima di procedere.";
  const company = italianVat(companyVat);
  if (!company) return "Partita IVA azienda non disponibile: collega o aggiorna FIC per verificare l'intestazione.";
  if (customer !== company) return "Partita IVA cliente diversa dall'azienda selezionata: verifica l'intestazione del PDF.";
  return null;
}

export function requireCustomerVat(invoice: InvoiceFields, companyVat: unknown): void {
  const issue = customerVatIssue(invoice, companyVat);
  if (issue) throw new Error(issue);
}
