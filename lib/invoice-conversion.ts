import type { EurConversion, InvoiceFields } from "./types";

export function cleanEurConversion(raw: unknown): EurConversion {
  const value = raw as EurConversion;
  if (!value || typeof value.rate !== "number" || !Number.isFinite(value.rate) || value.rate <= 0 || value.rate > 1000000 ||
    typeof value.date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value.date) || !Number.isFinite(Date.parse(value.date)) || new Date(value.date).toISOString().slice(0, 10) !== value.date ||
    !["ECB", "manual"].includes(value.source) || typeof value.confirmed_at !== "string" || value.confirmed_at.length > 40 || !Number.isFinite(Date.parse(value.confirmed_at))) throw new Error("Conferma un cambio valido: EUR per una unita della valuta originale.");
  return { rate: value.rate, date: value.date, source: value.source, confirmed_at: value.confirmed_at };
}

export function invoiceForFic(invoice: InvoiceFields): InvoiceFields {
  if (invoice.currency === "EUR") return invoice;
  if (!/^[A-Z]{3}$/.test(invoice.currency)) throw new Error("Valuta originale non valida.");
  const conversion = cleanEurConversion(invoice.eur_conversion);
  const amount = (value: number | null) => {
    if (typeof value !== "number" || !Number.isFinite(value) || value < 0) throw new Error("Importi originali non validi.");
    return Math.round((value * conversion.rate + Number.EPSILON) * 100) / 100;
  };
  const net = amount(invoice.net_amount), tax = amount(invoice.tax_amount);
  const total = Math.round((net + tax) * 100) / 100;
  if (Math.abs(total - amount(invoice.total_amount)) > 0.011) throw new Error("Gli importi originali non corrispondono al totale.");
  const { eur_conversion: _conversion, ...original } = invoice; void _conversion;
  return { ...original, currency: "EUR", net_amount: net, tax_amount: tax, total_amount: total,
    foreign_reference: `Originale ${invoice.total_amount!.toFixed(2)} ${invoice.currency}; 1 ${invoice.currency} = ${conversion.rate} EUR; cambio ${conversion.date} (${conversion.source === "ECB" ? "BCE" : "manuale"}).` };
}
