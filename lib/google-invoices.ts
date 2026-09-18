import { createHash, randomUUID } from "node:crypto";
import { googleFetch, type GoogleSession } from "@/lib/google-session";
import { classifyMail, flattenParts, inRomeMonth, monthQuery, openaiInvoiceLink, supplierQuery, type MailMessage } from "@/lib/mail-invoices";
import { parseInvoicePdf } from "@/lib/invoice-parser";
import type { ParsedInvoice } from "@/lib/types";

const hash = (value: string | Buffer) => createHash("sha256").update(value).digest("hex");
const MAX_PDF_BYTES = 10 * 1024 * 1024;
const escapeQuery = (value: string) => value.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
type DriveFile = { id: string; name: string; appProperties?: Record<string, string> };

async function json<T>(session: GoogleSession, path: string, init?: RequestInit): Promise<T> { return (await googleFetch(session, path, init)).json(); }

async function labelId(session: GoogleSession) {
  const result = await json<{ labels: { id: string; name: string }[] }>(session, "/gmail/v1/users/me/labels");
  const label = result.labels.find((item) => item.name === "Fatture SaaS");
  if (!label) throw new Error('Etichetta Gmail "Fatture SaaS" non trovata.');
  return label.id;
}

export async function scanGoogleInvoices(session: GoogleSession, month: string, pageToken = "", supplier: unknown = "") {
  const query = [monthQuery(month), supplierQuery(supplier)].filter(Boolean).join(" ");
  const id = await labelId(session);
  const params = new URLSearchParams({ labelIds: id, q: query, maxResults: "10" });
  if (pageToken) params.set("pageToken", pageToken);
  const page = await json<{ messages?: { id: string }[]; nextPageToken?: string }>(session, `/gmail/v1/users/me/messages?${params}`);
  const items = [];
  for (const item of page.messages ?? []) {
    const message = await json<MailMessage>(session, `/gmail/v1/users/me/messages/${encodeURIComponent(item.id)}?format=full`);
    const candidate = classifyMail(message);
    if (message.labelIds?.includes(id) && inRomeMonth(message, month) && (!supplier || candidate.supplier === supplier)) items.push(candidate);
  }
  return { items, nextPageToken: page.nextPageToken ?? null };
}

async function findFile(session: GoogleSession, key: string, value: string) {
  const params = new URLSearchParams({ q: `trashed = false and appProperties has { key='${key}' and value='${escapeQuery(value)}' }`, fields: "files(id,name,appProperties)", pageSize: "100" });
  const data = await json<{ files: DriveFile[] }>(session, `/drive/v3/files?${params}`);
  return data.files[0];
}

async function folder(session: GoogleSession, name: string, parent?: string) {
  const folderKey = hash(`${parent ?? "root"}/${name}`);
  const existing = await findFile(session, "ficFolder", folderKey);
  if (existing) return existing.id;
  const result = await json<DriveFile>(session, "/drive/v3/files?fields=id", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name, mimeType: "application/vnd.google-apps.folder", ...(parent ? { parents: [parent] } : {}), appProperties: { ficFolder: folderKey } }) });
  return result.id;
}

export type ArchivedInvoice = { invoice: ParsedInvoice; driveId: string; duplicate: boolean };
async function restore(session: GoogleSession, file: DriveFile): Promise<ArchivedInvoice> {
  const response = await googleFetch(session, `/drive/v3/files/${encodeURIComponent(file.id)}?alt=media`);
  const buffer = await limitedBuffer(response);
  return { invoice: await parseInvoicePdf(buffer, file.name), driveId: file.id, duplicate: true };
}

async function limitedBuffer(response: Response) {
  const reader = response.body?.getReader();
  if (!reader) throw new Error("PDF non disponibile.");
  let size = 0;
  const chunks: Buffer[] = [];
  try {
    for (;;) {
      const part = await reader.read();
      if (part.done) break;
      size += part.value.length;
      if (size > MAX_PDF_BYTES) throw new Error("PDF oltre il limite di 10 MB.");
      chunks.push(Buffer.from(part.value));
    }
  } finally { await reader.cancel(); }
  const buffer = Buffer.concat(chunks);
  if (buffer.subarray(0, 5).toString() !== "%PDF-") throw new Error("Allegato non PDF.");
  return buffer;
}

async function archive(session: GoogleSession, buffer: Buffer, fileName: string, sourceKey: string, expectedSupplier: string): Promise<ArchivedInvoice> {
  if (buffer.length > MAX_PDF_BYTES || buffer.subarray(0, 5).toString() !== "%PDF-") throw new Error("Allegato non PDF o oltre 10 MB.");
  const invoice = await parseInvoicePdf(buffer, fileName);
  if (invoice.invoice.supplier !== expectedSupplier) throw new Error("Il fornitore nel PDF non corrisponde alla mail. Verifica manuale richiesta.");
  const contentKey = hash(buffer);
  const existing = await findFile(session, "ficContent", contentKey);
  if (existing) return restore(session, existing);
  // Only use a business key when the parser considers number and date reliable.
  const businessKey = invoice.status === "extracted" && invoice.invoice.invoice_number
    ? hash(`${expectedSupplier}:${invoice.invoice.invoice_number.trim().toUpperCase()}`) : undefined;
  if (businessKey) {
    const sameInvoice = await findFile(session, "ficInvoice", businessKey);
    if (sameInvoice) {
      if (sameInvoice.appProperties?.ficContent !== contentKey) throw new Error("Numero fattura gia archiviato con un PDF diverso. Confronta i documenti su Drive.");
      return restore(session, sameInvoice);
    }
  }
  const root = await folder(session, "Fatture SaaS");
  const date = invoice.invoice.invoice_date;
  let parent = root;
  if (/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    parent = await folder(session, date.slice(0, 4), parent);
    parent = await folder(session, date.slice(5, 7), parent);
  } else parent = await folder(session, "Da verificare", parent);
  parent = await folder(session, expectedSupplier, parent);
  const safeName = fileName.replace(/[\/\\\x00-\x1f]/g, "_").slice(0, 160);
  const metadata = { name: safeName, mimeType: "application/pdf", parents: [parent], appProperties: { ficSource: sourceKey, ficContent: contentKey, ...(businessKey ? { ficInvoice: businessKey } : {}) } };
  const boundary = `fic_${randomUUID()}`;
  const body = Buffer.concat([Buffer.from(`--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(metadata)}\r\n--${boundary}\r\nContent-Type: application/pdf\r\n\r\n`), buffer, Buffer.from(`\r\n--${boundary}--\r\n`)]);
  const uploaded = await json<DriveFile>(session, "/upload/drive/v3/files?uploadType=multipart&fields=id,name", { method: "POST", headers: { "Content-Type": `multipart/related; boundary=${boundary}` }, body });
  return { invoice, driveId: uploaded.id, duplicate: false };
}

// Serializes this personal app's imports within a worker. Drive keys also protect later sessions.
const activeImports = new Set<string>();
export async function importGoogleInvoice(session: GoogleSession, messageId: string, partId: string): Promise<ArchivedInvoice> {
  if (!/^[a-zA-Z0-9_-]{1,100}$/.test(messageId) || partId.length > 100) throw new Error("Riferimento mail non valido.");
  const lock = hash(session.refresh);
  if (activeImports.has(lock)) throw new Error("Importazione in corso. Attendi prima di riprovare.");
  activeImports.add(lock);
  try {
    const label = await labelId(session);
    const message = await json<MailMessage>(session, `/gmail/v1/users/me/messages/${messageId}?format=full`);
    if (!message.labelIds?.includes(label)) throw new Error("La mail non appartiene a Fatture SaaS.");
    const candidate = classifyMail(message);
    if (candidate.supplier === "Sconosciuto") throw new Error("Mittente non riconosciuto.");
    const sourceKey = hash(`${messageId}:${partId}`);
    const existing = await findFile(session, "ficSource", sourceKey);
    if (existing) return restore(session, existing);
    if (partId === "openai-link") {
      const link = candidate.supplier === "OpenAI" ? openaiInvoiceLink(message) : null;
      if (!link) throw new Error("Link fattura mancante.");
      const { downloadOpenaiInvoice } = await import("@/lib/invoice-link-download");
      const buffer = await downloadOpenaiInvoice(link);
      const parsed = await parseInvoicePdf(buffer, "OpenAI.pdf");
      const number = parsed.invoice.invoice_number;
      const mailText = flattenParts(message.payload).filter((p) => p.mimeType?.startsWith("text/")).map((p) => Buffer.from(p.body?.data ?? "", "base64url").toString()).join(" ");
      if (!number || !mailText.includes(number)) throw new Error("Numero fattura non corrispondente alla mail OpenAI.");
      return archive(session, buffer, `Invoice-${number}.pdf`, sourceKey, candidate.supplier);
    }
    if (!candidate.invoices.some((p) => p.partId === partId)) throw new Error("Allegato non riconosciuto come fattura.");
    const part = flattenParts(message.payload).find((p) => p.partId === partId)!;
    if ((part.body?.size ?? 0) > MAX_PDF_BYTES) throw new Error("PDF oltre il limite di 10 MB.");
    const data = part.body?.attachmentId
      ? await json<{ data: string }>(session, `/gmail/v1/users/me/messages/${messageId}/attachments/${encodeURIComponent(part.body.attachmentId)}`)
      : part.body;
    return archive(session, Buffer.from(data?.data ?? "", "base64url"), part.filename!, sourceKey, candidate.supplier);
  } finally { activeImports.delete(lock); }
}
