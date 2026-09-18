import type { ParsedInvoice } from "./types";

export function currencyTotals(items: Pick<ParsedInvoice, "invoice" | "status">[]) {
  const totals = new Map<string, number>();
  for (const item of items) {
    if (item.status === "duplicate") continue;
    const currency = item.invoice.currency || "?";
    totals.set(currency, (totals.get(currency) ?? 0) + (item.invoice.total_amount ?? 0));
  }
  return [...totals].map(([currency, value]) => `${value.toLocaleString("it-IT", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${currency}`).join(" · ") || "0,00 EUR";
}
