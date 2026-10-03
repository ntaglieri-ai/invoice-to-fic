import type { ParsedInvoice } from "./types";

export const HISTORY_KEY = "invoice-to-fic:history:v1";
export type HistoryInvoice = ParsedInvoice & { id: string };

export function readInvoiceHistory(raw: string | null): HistoryInvoice[] {
  if (!raw) return [];
  try {
    const data: unknown = JSON.parse(raw);
    if (!Array.isArray(data)) return [];
    return data.filter((item): item is HistoryInvoice => Boolean(
      item && typeof item.id === "string" && typeof item.file_name === "string" &&
      item.invoice && typeof item.invoice.invoice_number === "string" &&
      typeof item.invoice.invoice_date === "string" && Array.isArray(item.warnings) &&
      ["extracted", "needs_review", "duplicate", "approved"].includes(item.status)
    ));
  } catch { return []; }
}

export function invoiceMonth(item: HistoryInvoice): string {
  return /^\d{4}-(0[1-9]|1[0-2])-\d{2}$/.test(item.invoice.invoice_date)
    ? item.invoice.invoice_date.slice(0, 7) : "undated";
}

export function serializeInvoiceHistory(items: HistoryInvoice[]): string {
  // Persist invoice data, not transient dialogs, previews, or company-specific drafts.
  return JSON.stringify(items.map(({ id, index, file_name, invoice, status, confidence, warnings }) => ({
    id, index, file_name, invoice, status, confidence, warnings, extracted_text_preview: "",
  })));
}
