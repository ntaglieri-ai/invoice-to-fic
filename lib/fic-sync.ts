import type { ManagedInvoice } from "./invoice-memory";
import { processingKey, td17DeliveryState, type ProcessingLedger, type ProcessingRecord } from "./processing-state";
import type { ExpensePaymentState } from "./expense-payment-state";

export type ProcessingVerification = { key: string; expenseExists?: boolean; td17Exists?: boolean; expenseId?: number; expensePaymentState?: ExpensePaymentState; td17Id?: number; td17EiStatus?: string };
export function acceptRegisteredExpenses<T extends ManagedInvoice>(items: T[], recovered: ManagedInvoice[], companyId: string, now: string): T[] {
  const registered = new Map(recovered.filter((item) => item.processing?.expenseId).map((item) => [processingKey(companyId, item.invoice), item]));
  return items.map((item) => {
    const match = registered.get(processingKey(companyId, item.invoice));
    const id = match?.processing?.expenseId;
    if (item.not_applicable || !id || match?.invoice.invoice_date !== item.invoice.invoice_date || item.expense_acceptance?.id === id) return item;
    return { ...item, expense_acceptance: { id, at: now } };
  });
}

export function reconcileFicProcessing(current: ProcessingLedger, companyId: string, recovered: ManagedInvoice[], verified: ProcessingVerification[], now: string, baseline?: ProcessingLedger): ProcessingLedger {
  const candidates: ProcessingLedger = {};
  for (const item of recovered) if (item.processing) {
    const key = processingKey(companyId, item.invoice);
    // A complete month snapshot is authoritative, including absent TD17 references.
    candidates[key] = { ...item.processing };
  }
  // Existence checks win over a document returned earlier during recovery.
  for (const record of verified) {
    const next: ProcessingRecord = { ...current[record.key], ...candidates[record.key], updatedAt: now };
    if (record.expenseId) next.expenseId = record.expenseId;
    if (record.td17Id) next.td17Id = record.td17Id;
    if (record.expensePaymentState) next.expensePaymentState = record.expensePaymentState;
    if (record.expenseExists === false) { delete next.expenseId; delete next.expensePaymentState; }
    if (record.td17Exists === false) { delete next.td17Id; delete next.td17State; delete next.td17EiStatus; }
    else if (record.td17EiStatus !== undefined) { next.td17EiStatus = record.td17EiStatus; next.td17State = td17DeliveryState(record.td17EiStatus); }
    candidates[record.key] = next;
  }
  let result = current;
  for (const [key, candidate] of Object.entries(candidates)) {
    const previous = current[key];
    if (baseline && JSON.stringify(previous) !== JSON.stringify(baseline[key])) continue;
    if (previous && previous.expenseId === candidate.expenseId && previous.expensePaymentState === candidate.expensePaymentState && previous.td17Id === candidate.td17Id && previous.td17State === candidate.td17State && previous.td17EiStatus === candidate.td17EiStatus) continue;
    if (result === current) result = { ...current };
    result[key] = { ...candidate, updatedAt: now };
  }
  return result;
}
