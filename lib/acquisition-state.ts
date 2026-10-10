import type { MailCandidate } from "./mail-invoices";
import type { WorkflowInvoice } from "./invoice-workflow";
export type AcquisitionEntry = { key: string; name: string; date?: string; dateKind?: "invoice" | "mail"; supplier?: string; invoiceNumber?: string; driveId?: string; messageId?: string; partId?: string; warning?: string; archiveChecked?: boolean };
export function mailAcquisitionEntries(mail: MailCandidate): AcquisitionEntry[] {
  const parts = mail.invoices.length ? mail.invoices : [{ partId: mail.linkAvailable ? "openai-link" : "", name: mail.invoiceNumber ? `Invoice-${mail.invoiceNumber}.pdf` : mail.linkAvailable ? "Fattura OpenAI (numero non disponibile)" : mail.subject }];
  return parts.map((part) => {
    const archive = mail.archives?.[part.partId];
    return { key: `${mail.id}:${part.partId}`, messageId: mail.id, partId: part.partId, supplier: mail.supplier, invoiceNumber: part.partId === "openai-link" ? mail.invoiceNumber : undefined, name: `${mail.supplier} · ${archive?.name || part.name}`, date: archive?.invoiceDate || mail.date, dateKind: archive?.invoiceDate ? "invoice" : "mail", driveId: archive?.driveId, archiveChecked: mail.archives !== undefined, warning: part.partId ? undefined : mail.warning || "Apri la mail per recuperare il PDF." };
  });
}
export function acquisitionInRegister(entry: AcquisitionEntry, invoices: readonly WorkflowInvoice[], loaded: readonly string[]) {
  return loaded.includes(entry.key) || invoices.some((item) => Boolean(entry.driveId && item.driveId === entry.driveId) || Boolean(entry.invoiceNumber && item.invoice.supplier === entry.supplier && item.invoice.invoice_number.trim().toUpperCase() === entry.invoiceNumber && (item.driveId || !item.id.startsWith("fic-"))));
}
export function acquisitionDownloadState(entry: AcquisitionEntry, loaded: readonly string[], manual: readonly string[]) {
  if (entry.driveId || loaded.includes(entry.key)) return "downloaded";
  if (entry.messageId && manual.includes(entry.messageId)) return "manual";
  return entry.archiveChecked ? "not_downloaded" : "unknown";
}
