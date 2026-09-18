import { load } from "cheerio";
import type { SupportedSupplier } from "@/lib/types";

export type MailPart = { partId?: string; filename?: string; mimeType?: string; body?: { attachmentId?: string; data?: string; size?: number }; parts?: MailPart[]; headers?: { name: string; value: string }[] };
export type MailMessage = { id: string; labelIds?: string[]; internalDate?: string; payload: MailPart };
export type MailCandidate = { id: string; subject: string; supplier: SupportedSupplier; date: string; invoices: { partId: string; name: string }[]; receipts: number; linkAvailable: boolean; warning?: string };

const SENDERS: Record<string, SupportedSupplier> = {
  "noreply@tm.openai.com": "OpenAI", "invoice+statements@mail.anthropic.com": "Anthropic",
  "invoice+statements@vercel.com": "Vercel", "invoice+statements@supabase.com": "Supabase", "billing@hetzner.com": "Hetzner",
};
export function supplierQuery(supplier: unknown = "") {
  if (supplier === "") return "";
  const senders = Object.entries(SENDERS).filter(([, name]) => name === supplier).map(([sender]) => sender);
  if (!senders.length) throw new Error("Fornitore non valido.");
  return `{${senders.map((sender) => `from:${sender}`).join(" ")}}`;
}
export function flattenParts(part: MailPart): MailPart[] { return [part, ...(part.parts ?? []).flatMap(flattenParts)]; }
export function mailHeader(message: MailMessage, name: string) { return message.payload.headers?.find((h) => h.name.toLowerCase() === name.toLowerCase())?.value ?? ""; }

export function allowedInvoiceUrl(value: string) {
  try {
    const u = new URL(value);
    return u.protocol === "https:" && !u.username && !u.password && !u.port && ["mandrillapp.com", "invoice.stripe.com"].includes(u.hostname);
  } catch { return false; }
}

export function openaiInvoiceLink(message: MailMessage) {
  for (const part of flattenParts(message.payload)) {
    if (part.mimeType !== "text/html" || !part.body?.data) continue;
    const $ = load(Buffer.from(part.body.data, "base64url").toString());
    for (const a of $("a").toArray()) {
      const label = $(a).text().trim();
      const href = $(a).attr("href") ?? "";
      if (/^(Visualizza la fattura|View invoice|View your invoice)$/i.test(label) && allowedInvoiceUrl(href)) return href;
    }
  }
  return null;
}

export function classifyMail(message: MailMessage): MailCandidate {
  const from = mailHeader(message, "from").trim().toLowerCase();
  const sender = from.match(/<([^<>]+)>/)?.[1] ?? from;
  const supplier = SENDERS[sender] ?? "Sconosciuto";
  const parts = flattenParts(message.payload).filter((p) => /\.pdf$/i.test(p.filename ?? ""));
  const invoices = parts.filter((p) => !/receipt|ricevuta/i.test(p.filename!) && /invoice|fattura|hetzner/i.test(p.filename!)).map((p) => ({ partId: p.partId ?? "", name: p.filename! }));
  const date = new Date(Number(message.internalDate));
  const linkAvailable = supplier === "OpenAI" && Boolean(openaiInvoiceLink(message));
  return { id: message.id, subject: mailHeader(message, "subject"), supplier, date: Number.isFinite(date.getTime()) ? date.toISOString().slice(0, 10) : "", invoices: supplier === "Sconosciuto" ? [] : invoices, receipts: parts.filter((p) => /receipt|ricevuta/i.test(p.filename!)).length, linkAvailable,
    warning: supplier === "Sconosciuto" ? "Mittente non riconosciuto: verifica manuale." : !invoices.length && !linkAvailable ? "Nessuna fattura recuperabile automaticamente." : undefined };
}

export function monthQuery(month: string) {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) throw new Error("Mese non valido.");
  const [year, m] = month.split("-").map(Number);
  if (year < 2000 || year > 2100) throw new Error("Anno non valido.");
  // Epoch bounds avoid Gmail's implicit Pacific timezone and include the whole Rome month.
  const start = new Date(`${month}-01T00:00:00Z`);
  const end = new Date(Date.UTC(year, m, 1));
  return `after:${Math.floor(start.getTime() / 1000) - 86400} before:${Math.floor(end.getTime() / 1000) + 86400}`;
}

export function inRomeMonth(message: MailMessage, month: string) {
  const date = new Date(Number(message.internalDate));
  if (!Number.isFinite(date.getTime())) return false;
  const parts = new Intl.DateTimeFormat("en", { timeZone: "Europe/Rome", year: "numeric", month: "2-digit" }).formatToParts(date);
  return `${parts.find((p) => p.type === "year")?.value}-${parts.find((p) => p.type === "month")?.value}` === month;
}
