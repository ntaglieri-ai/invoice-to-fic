import type { InvoiceFields, InvoiceStatus } from "./types";
import type { HistoryInvoice } from "./invoice-history";
import { processingKey, td17DeliveryState, type ProcessingLedger, type ProcessingRecord } from "./processing-state";

export type ManagedInvoice = HistoryInvoice & { driveId?: string; processing?: ProcessingRecord };
export type MemoryRecord = { value: ManagedInvoice | null; revision: string };
export type MemoryRecords = Record<string, MemoryRecord>;
export type MemoryChange = { id: string; expectedRevision: string | null; value: ManagedInvoice | null };
export type MemoryEvent = { version: 1; operationId: string; changes: MemoryChange[] };
const suppliers = ["OpenAI", "Anthropic", "Vercel", "Hetzner", "Supabase", "Sconosciuto"];
const statuses: InvoiceStatus[] = ["extracted", "needs_review", "duplicate", "approved"];
const text = (value: unknown, limit: number): value is string => typeof value === "string" && value.length <= limit;
const documentId = (value: unknown): value is number => Number.isSafeInteger(value) && Number(value) > 0;
const recordId = (value: unknown): value is string => text(value, 300) && Boolean(value) && !["__proto__", "constructor", "prototype"].includes(value);

export function cleanManagedInvoice(value: unknown): ManagedInvoice {
  if (!value || typeof value !== "object") throw new Error("Dati fattura non validi.");
  const item = value as ManagedInvoice;
  const invoice = item.invoice;
  if (!recordId(item.id) || !text(item.file_name, 200) || !Number.isSafeInteger(item.index) || item.index < 0 ||
    !invoice || !suppliers.includes(invoice.supplier) || !text(invoice.invoice_number, 200) || !text(invoice.invoice_date, 20) ||
    !text(invoice.currency, 10) || !text(invoice.supplier_vat, 100) || (invoice.customer_vat !== undefined && !text(invoice.customer_vat, 100)) ||
    ![invoice.net_amount, invoice.tax_amount, invoice.total_amount].every((amount) => amount === null || (typeof amount === "number" && Number.isFinite(amount))) ||
    !statuses.includes(item.status) || !Number.isFinite(item.confidence) || !Array.isArray(item.warnings) || item.warnings.length > 50 ||
    !item.warnings.every((warning) => text(warning, 1000)) || (item.driveId !== undefined && !/^[a-zA-Z0-9_-]{1,200}$/.test(item.driveId))) throw new Error("Dati fattura non validi.");
  const fields: InvoiceFields = { supplier: invoice.supplier, invoice_number: invoice.invoice_number, invoice_date: invoice.invoice_date,
    currency: invoice.currency, net_amount: invoice.net_amount, tax_amount: invoice.tax_amount, total_amount: invoice.total_amount,
    supplier_vat: invoice.supplier_vat, ...(invoice.customer_vat !== undefined ? { customer_vat: invoice.customer_vat } : {}) };
  let processing: ProcessingRecord | undefined;
  if (item.processing !== undefined) {
    const record = item.processing;
    if (!record || !text(record.updatedAt, 40) || !Number.isFinite(Date.parse(record.updatedAt)) ||
      ![record.expenseId, record.td17Id].every((id) => id === undefined || documentId(id)) ||
      (record.td17EiStatus !== undefined && !text(record.td17EiStatus, 100))) throw new Error("Stati FIC non validi.");
    processing = { updatedAt: record.updatedAt, ...(record.expenseId ? { expenseId: record.expenseId } : {}),
      ...(record.td17Id ? { td17Id: record.td17Id, td17State: td17DeliveryState(record.td17EiStatus), ...(record.td17EiStatus !== undefined ? { td17EiStatus: record.td17EiStatus } : {}) } : {}) };
  }
  return { id: item.id, index: item.index, file_name: item.file_name, invoice: fields, status: item.status, confidence: item.confidence,
    warnings: item.warnings, extracted_text_preview: "", ...(item.driveId ? { driveId: item.driveId } : {}), ...(processing ? { processing } : {}) };
}

export function cleanMemoryEvent(raw: unknown): MemoryEvent {
  const event = raw as MemoryEvent;
  if (!event || event.version !== 1 || !/^[a-f0-9-]{36}$/.test(event.operationId) || !Array.isArray(event.changes) || !event.changes.length || event.changes.length > 25) throw new Error("Aggiornamento memoria non valido.");
  const ids = new Set<string>();
  const changes = event.changes.map((change) => {
    if (!change || !recordId(change.id) || ids.has(change.id) ||
      (change.expectedRevision !== null && !/^[a-f0-9-]{36}$/.test(change.expectedRevision))) throw new Error("Riferimenti memoria non validi.");
    ids.add(change.id);
    const value = change.value === null ? null : cleanManagedInvoice(change.value);
    if (value && value.id !== change.id) throw new Error("Riferimento fattura incoerente.");
    return { id: change.id, expectedRevision: change.expectedRevision, value };
  });
  return { version: 1, operationId: event.operationId, changes };
}

// Append-only events avoid overwriting other invoices. Revisions also reject stale edits and resurrection after removal.
export function replayMemory(events: MemoryEvent[], base?: { records: MemoryRecords; accepted: string[]; seen: string[] }) {
  const records: MemoryRecords = { ...base?.records };
  const accepted = new Set<string>(base?.accepted);
  const seen = new Set<string>(base?.seen);
  for (const event of events) {
    if (seen.has(event.operationId)) continue;
    seen.add(event.operationId);
    if (event.changes.some((change) => (records[change.id]?.revision ?? null) !== change.expectedRevision)) continue;
    for (const change of event.changes) records[change.id] = { value: change.value, revision: event.operationId };
    accepted.add(event.operationId);
  }
  return { records, accepted, seen };
}

export function memoryLedger(records: MemoryRecords, companyId: string): ProcessingLedger {
  const ledger: ProcessingLedger = {};
  for (const { value } of Object.values(records)) if (value?.processing) ledger[processingKey(companyId, value.invoice)] = value.processing;
  return ledger;
}

export function memoryChanges(records: MemoryRecords, invoices: HistoryInvoice[], ledger: ProcessingLedger, companyId: string): MemoryChange[] {
  const current = new Map(invoices.map((item) => {
    const value = cleanManagedInvoice({ ...item, processing: ledger[processingKey(companyId, item.invoice)] });
    return [item.id, value] as const;
  }));
  const changes: MemoryChange[] = [];
  for (const [id, value] of current) if (JSON.stringify(value) !== JSON.stringify(records[id]?.value)) changes.push({ id, value, expectedRevision: records[id]?.revision ?? null });
  for (const [id, record] of Object.entries(records)) if (record.value && !current.has(id)) changes.push({ id, value: null, expectedRevision: record.revision });
  return changes;
}
