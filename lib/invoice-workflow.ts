import type { ParsedInvoice } from "./types";
import { invoiceTaxReview } from "./invoice-tax-review";
import type { Td17DeliveryState } from "./processing-state";

export type WorkflowInvoice = ParsedInvoice & {
  id: string; driveId?: string; ficId?: number;
  td17?: { companyId: number; id: number; state?: Td17DeliveryState; eiStatus?: string };
};
export type WorkflowFilter = "all" | "work" | "send" | "done";
export function newestInvoicesFirst(items: readonly WorkflowInvoice[]): WorkflowInvoice[] {
  const dateKey = (value: string) => /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : "";
  return [...items].sort((a, b) => dateKey(b.invoice.invoice_date).localeCompare(dateKey(a.invoice.invoice_date)) || b.invoice.invoice_number.localeCompare(a.invoice.invoice_number, "it", { numeric: true }) || a.id.localeCompare(b.id));
}
export function workflowStage(item: WorkflowInvoice): WorkflowFilter {
  if (item.status === "duplicate" || item.status === "needs_review") return "work";
  if (item.td17) return item.td17.state === "sent" ? "done" : "send";
  return "work";
}
export function nextInvoiceAction(item: WorkflowInvoice): "review" | "expense" | "td17" | "fic" {
  if (item.td17) return "fic";
  if (invoiceTaxReview(item.invoice)) return "review";
  if (item.status !== "approved") return "review";
  return item.ficId ? "td17" : "expense";
}
export function matchesWorkflow(item: WorkflowInvoice, filter: WorkflowFilter, query: string): boolean {
  return (filter === "all" || workflowStage(item) === filter) &&
    `${item.invoice.supplier} ${item.invoice.invoice_number} ${item.file_name}`.toLocaleLowerCase("it").includes(query.trim().toLocaleLowerCase("it"));
}
export function displayInvoiceDate(value: string): string {
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return match ? `${match[3]}/${match[2]}/${match[1]}` : value || "Da verificare";
}
export function invoiceAmount(item: WorkflowInvoice): string {
  const value = item.invoice.total_amount;
  if (value === null || !Number.isFinite(value)) return "Da verificare";
  try { return new Intl.NumberFormat("it-IT", { style: "currency", currency: item.invoice.currency }).format(value); }
  catch { return `${value.toFixed(2)} ${item.invoice.currency || "Valuta da verificare"}`; }
}
