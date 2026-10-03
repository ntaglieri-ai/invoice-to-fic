import type { InvoiceFields } from "./types";

export type Td17DeliveryState = "not_sent" | "sent";
export function td17DeliveryState(status?: string): Td17DeliveryState {
  return ["sent", "processing", "not_delivered", "accepted", "no_response"].includes(status ?? "") ? "sent" : "not_sent";
}
export type ProcessingRecord = { expenseId?: number; td17Id?: number; td17State?: Td17DeliveryState; td17EiStatus?: string; updatedAt: string };
export type ProcessingLedger = Record<string, ProcessingRecord>;
export const PROCESSING_STORAGE_KEY = "invoice-to-fic:processing:v1";
export function processingKey(companyId: string, invoice: InvoiceFields) {
  return JSON.stringify([companyId, invoice.supplier, invoice.invoice_number.trim().toUpperCase()]);
}
export function readProcessingLedger(value: string | null): ProcessingLedger {
  try {
    const data: unknown = JSON.parse(value ?? "{}");
    if (!data || typeof data !== "object" || Array.isArray(data)) return {};
    return Object.fromEntries(Object.entries(data).filter(([, item]) => item && typeof item === "object" && typeof item.updatedAt === "string" &&
      [item.expenseId, item.td17Id].every((id) => id === undefined || (Number.isSafeInteger(id) && id > 0))));
  } catch { return {}; }
}
