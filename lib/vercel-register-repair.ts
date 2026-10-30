import type { WorkflowInvoice } from "./invoice-workflow";
import type { ParsedInvoice } from "./types";
import { processingKey } from "./processing-state";

export function repairUndatedVercel<T extends WorkflowInvoice>(items: T[], id: string, driveId: string, parsed: ParsedInvoice, companyId: string): T[] {
  const old = items.find((item) => item.id === id);
  if (!old || old.ficId || old.td17 || old.driveId !== driveId || old.invoice.supplier !== "Vercel" || old.invoice.invoice_date || parsed.invoice.supplier !== "Vercel" || !/^\d{4}-\d{2}-\d{2}$/.test(parsed.invoice.invoice_date) || !parsed.invoice.invoice_number) return items;
  if (old.invoice.invoice_number && old.invoice.invoice_number !== parsed.invoice.invoice_number && !parsed.invoice.invoice_number.startsWith(`${old.invoice.invoice_number}-`)) return items;
  const peer = items.find((item) => item.id !== id && processingKey(companyId, item.invoice) === processingKey(companyId, parsed.invoice));
  // A FIC-recovered row keeps its financial values and gains the source PDF reference.
  if (peer) return items.filter((item) => item.id !== id).map((item) => item.id === peer.id ? { ...item, driveId: item.driveId || driveId } : item);
  return items.map((item) => item.id === id ? { ...item, ...parsed, id: item.id, driveId, checked_at: undefined } : item);
}

export function recoverVercelDriveInvoice(items: WorkflowInvoice[], driveId: string, parsed: ParsedInvoice, companyId: string): WorkflowInvoice[] {
  if (parsed.invoice.supplier !== "Vercel" || !/^\d{4}-\d{2}-\d{2}$/.test(parsed.invoice.invoice_date) || !parsed.invoice.invoice_number || items.some((item) => item.driveId === driveId)) return items;
  const peer = items.find((item) => processingKey(companyId, item.invoice) === processingKey(companyId, parsed.invoice));
  if (peer) return peer.driveId ? items : items.map((item) => item.id === peer.id ? { ...item, driveId } : item);
  return [...items, { ...parsed, id: `drive-${driveId}`, driveId }];
}
