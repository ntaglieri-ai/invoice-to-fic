"use client";

import { useEffect, useRef, useState } from "react";
import { CheckCircle2, ChevronLeft, ChevronRight, Download, ExternalLink, Link2, LoaderCircle, Mail, Search, Unplug } from "lucide-react";
import type { MailCandidate } from "@/lib/mail-invoices";
import type { ArchivedInvoice } from "@/lib/google-invoices";
import { DriveInvoicesPanel } from "@/components/drive-invoices-panel";

type Status = { connected: boolean; config: { configured: boolean; missing: string[] } };
type Item = MailCandidate & { partId: string; fileName: string; key: string; result?: ArchivedInvoice; error?: string };
type MailPage = { items: Item[]; nextToken: string | null; archiveWarning: string };
const DOWNLOAD_MARKS_KEY = "invoice-to-fic:manual-downloads:v1";
class ImportError extends Error {
  constructor(message: string, public stopBatch: boolean) { super(message); }
}
function archivedId(item: Item) { return item.result?.driveId ?? item.archives?.[item.partId]?.driveId; }
function displayDate(value?: string) { return value?.match(/^(\d{4})-(\d{2})-(\d{2})$/)?.slice(1).reverse().join("/") || "Non disponibile"; }
async function action(body: unknown) {
  const response = await fetch("/api/google/invoices", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const data = await response.json();
  if (!response.ok) throw new ImportError(data.error || "Google non disponibile.", data.stopBatch === true || response.status === 401 || response.status === 429);
  return data;
}

export function GoogleInvoicesPanel({ onInvoice }: { onInvoice: (result: ArchivedInvoice) => void }) {
  const [status, setStatus] = useState<Status | null>(null);
  const [source, setSource] = useState<"mail" | "drive">("drive");
  const [supplier, setSupplier] = useState("");
  const [month, setMonth] = useState(() => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`; });
  const [pages, setPages] = useState<MailPage[]>([]);
  const [pageIndex, setPageIndex] = useState(0);
  const [manualDownloads, setManualDownloads] = useState<Set<string>>(new Set());
  const listRef = useRef<HTMLDivElement>(null);
  const activePage = pages[pageIndex];
  const items = activePage?.items ?? [];
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const scanned = Boolean(activePage);
  const archiveWarning = activePage?.archiveWarning ?? "";
  useEffect(() => {
    fetch("/api/google/invoices", { cache: "no-store" }).then(async (r) => {
      if (!r.ok) throw new Error("Connessione Google non disponibile.");
      const connection: Status = await r.json();
      try {
        const stored: unknown = JSON.parse(localStorage.getItem(DOWNLOAD_MARKS_KEY) ?? "[]");
        if (Array.isArray(stored)) setManualDownloads(new Set(stored.filter((id): id is string => typeof id === "string" && /^[a-zA-Z0-9_-]{1,100}$/.test(id))));
      } catch { /* Keep the list usable when browser storage is unavailable. */ }
      setStatus(connection);
      if (new URLSearchParams(window.location.search).get("google") === "authorization-error") setError("Autorizzazione Google non completata. Ricollega e autorizza Gmail e Drive.");
    }).catch((e) => setError(e.message));
  }, []);

  function resetPages() {
    setPages([]); setPageIndex(0); setError("");
  }

  function markDownloaded(messageId: string, downloaded: boolean) {
    const next = new Set(manualDownloads);
    if (downloaded) next.add(messageId); else next.delete(messageId);
    setManualDownloads(next);
    try { localStorage.setItem(DOWNLOAD_MARKS_KEY, JSON.stringify([...next])); }
    catch { setError("Il browser non permette di salvare i check: resteranno disponibili fino al ricaricamento."); }
  }

  async function scan(targetIndex = 0, pageToken = "") {
    setBusy("scan"); setError("");
    try {
      const data = await action({ action: "scan", month, supplier, ...(pageToken ? { pageToken } : {}) });
      const rows = (data.items as MailCandidate[]).flatMap((mail) => {
        const files = mail.invoices.length ? mail.invoices : [{ partId: mail.linkAvailable ? "openai-link" : "", name: mail.linkAvailable ? "Fattura OpenAI (link)" : "Da verificare" }];
        return files.map((file) => ({ ...mail, partId: file.partId, fileName: file.name, key: `${mail.id}:${file.partId}` }));
      });
      const page = { items: rows, nextToken: data.nextPageToken ?? null, archiveWarning: data.archiveWarning ?? "" };
      setPages((previous) => [...previous.slice(0, targetIndex), page]);
      setPageIndex(targetIndex);
      if (targetIndex > 0) listRef.current?.scrollIntoView({ block: "start" });
    } catch (e) { setError(e instanceof Error ? e.message : "Ricerca non riuscita."); }
    finally { setBusy(""); }
  }

  function navigatePage(targetIndex: number) {
    if (pages[targetIndex]) {
      setPageIndex(targetIndex); setError("");
      listRef.current?.scrollIntoView({ block: "start" });
    } else if (activePage?.nextToken) void scan(targetIndex, activePage.nextToken);
  }

  function updateItem(key: string, change: Partial<Item>) {
    setPages((current) => current.map((page, index) => index === pageIndex
      ? { ...page, items: page.items.map((item) => item.key === key ? { ...item, ...change } : item) }
      : page));
  }

  async function importRows(rows: Item[]) {
    setError("");
    for (const row of rows) {
      setBusy(row.key);
      try {
        const result: ArchivedInvoice = await action({ action: "import", messageId: row.id, partId: row.partId });
        onInvoice(result);
        updateItem(row.key, { result, error: undefined });
      } catch (e) {
        updateItem(row.key, { error: e instanceof Error ? e.message : "Importazione non riuscita." });
        if (e instanceof ImportError && e.stopBatch) { setError(`Importazione interrotta. ${e.message} Le fatture successive non sono state elaborate.`); break; }
      }
    }
    setBusy("");
  }

  return <section className="border-y border-line py-5" aria-labelledby="google-title">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <h2 id="google-title" className="flex items-center gap-2 text-lg font-semibold"><Mail size={20} /> Gmail e Drive <span className="text-sm font-normal text-slate-500">Fatture SaaS</span></h2>
      {status?.connected ? <button type="button" disabled={Boolean(busy)} className="flex items-center gap-2 text-sm disabled:opacity-50" onClick={async () => { setBusy("disconnect"); try { await action({ action: "disconnect" }); setStatus({ ...status, connected: false }); resetPages(); } catch { setError("Scollegamento non riuscito."); } finally { setBusy(""); } }}><Unplug size={16} /> Scollega Google</button>
        : status?.config.configured ? <a href="/api/google/connect" className="flex items-center gap-2 rounded-md bg-ink px-4 py-2 text-sm text-white"><Link2 size={16} /> Collega Google</a>
          : <span className="text-sm text-amber-800">Configurazione Google da completare</span>}
    </div>
    {error && <p role="alert" className="mt-3 text-sm text-red-700">{error}</p>}
    {status?.connected && <>
      <nav aria-label="Sorgente fatture" className="workspace-tabs mt-4"><button type="button" aria-pressed={source === "mail"} onClick={() => setSource("mail")}><Mail size={16} /> Mail da archiviare</button><button type="button" aria-pressed={source === "drive"} onClick={() => setSource("drive")}><Download size={16} /> PDF su Drive</button></nav>
      <div hidden={source !== "mail"}>
      <div className="mt-4 flex flex-wrap items-end gap-3">
        <label className="text-sm">Mese ricezione mail<input aria-label="Mese ricezione mail" type="month" value={month} disabled={Boolean(busy)} onChange={(e) => { setMonth(e.target.value); resetPages(); }} className="mt-1 block h-10 rounded-md border border-line bg-white px-3" /></label>
        <label className="text-sm">Fornitore<select aria-label="Fornitore mail" value={supplier} disabled={Boolean(busy)} onChange={(e) => { setSupplier(e.target.value); resetPages(); }} className="mt-1 block h-10 w-44 max-w-full rounded-md border border-line bg-white px-3">
          <option value="">Tutti</option>
          {["OpenAI", "Anthropic", "Vercel", "Hetzner", "Supabase"].map((name) => <option key={name} value={name}>{name}</option>)}
        </select></label>
        <button disabled={Boolean(busy) || !month} onClick={() => scan()} className="flex h-10 items-center gap-2 rounded-md border border-line bg-white px-3 text-sm disabled:opacity-50"><Search size={16} /> Cerca mail</button>
        <button disabled={Boolean(busy) || !items.some((i) => i.partId && !archivedId(i) && !manualDownloads.has(i.id))} onClick={() => importRows(items.filter((i) => i.partId && !archivedId(i) && !manualDownloads.has(i.id)))} className="flex h-10 items-center gap-2 rounded-md bg-ink px-3 text-sm text-white disabled:opacity-50"><Download size={16} /> Archivia e carica pagina</button>
        {busy && <span role="status" className="flex items-center gap-2 text-sm"><LoaderCircle className="animate-spin" size={16} /> {busy === "scan" ? "Ricerca mail" : "Operazione in corso"}</span>}
      </div>
      {scanned && !items.length && <p className="mt-4 text-sm text-slate-500">Nessuna mail trovata con i filtri selezionati.</p>}
      {archiveWarning && <p role="alert" className="mt-3 text-sm text-amber-800">{archiveWarning}</p>}
      <div ref={listRef} className="mt-4 scroll-mt-4">
      {scanned && <nav aria-label="Paginazione mail" className="flex flex-wrap items-center justify-between gap-3 border-b border-line pb-3 text-sm">
        <span>{supplier || "Tutti i fornitori"} · Pagina {pageIndex + 1}</span>
        <div className="flex items-center gap-2">
          <button type="button" aria-label="Pagina precedente" title="Pagina precedente" disabled={Boolean(busy) || pageIndex === 0} onClick={() => navigatePage(pageIndex - 1)} className="flex h-9 w-9 items-center justify-center rounded-md border border-line bg-white disabled:opacity-40"><ChevronLeft size={18} /></button>
          <button type="button" aria-label="Pagina successiva" title="Pagina successiva" disabled={Boolean(busy) || !activePage?.nextToken} onClick={() => navigatePage(pageIndex + 1)} className="flex h-9 w-9 items-center justify-center rounded-md border border-line bg-white disabled:opacity-40"><ChevronRight size={18} /></button>
        </div>
      </nav>}
      <ul className="divide-y divide-line">
        {items.map((item) => <li key={item.key} className="flex flex-wrap items-center justify-between gap-3 py-3 text-sm">
          <div className="min-w-0 flex-1 basis-64 break-words"><p className="font-medium">{item.supplier} · {item.fileName}</p><p className="text-slate-500">{item.subject}</p>
            <p className="mt-1 text-xs text-slate-500">Mail del {displayDate(item.date)}{(item.result?.invoice.invoice.invoice_date || item.archives?.[item.partId]?.invoiceDate) && <> · Fattura del {displayDate(item.result?.invoice.invoice.invoice_date || item.archives?.[item.partId]?.invoiceDate)}</>}</p>
            {item.receipts > 0 && <p className="text-xs text-slate-500">{item.receipts} ricevute escluse</p>}
            {item.warning && <p className="text-amber-800">{item.warning}</p>}
            {item.error && <p role="alert" className="text-red-700">{item.error}</p>}
          </div>
          <a href={`https://mail.google.com/mail/u/0/#all/${encodeURIComponent(item.id)}`} target="_blank" rel="noopener noreferrer" onClick={() => markDownloaded(item.id, true)} className="inline-flex items-center gap-1">Mail <ExternalLink size={14} /></a>
          <label className="inline-flex items-center gap-2 whitespace-nowrap"><input type="checkbox" aria-label={`Scaricata: ${item.subject}`} checked={Boolean(archivedId(item)) || manualDownloads.has(item.id)} disabled={Boolean(archivedId(item)) || Boolean(busy)} onChange={(event) => markDownloaded(item.id, event.target.checked)} className="h-4 w-4 accent-emerald-600" />Scaricata</label>
          {archivedId(item) && <a href={`https://drive.google.com/file/d/${encodeURIComponent(archivedId(item)!)}/view`} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-emerald-700"><CheckCircle2 size={16} /> Archiviata su Drive <ExternalLink size={14} /></a>}
          {item.partId && <button disabled={Boolean(busy)} onClick={() => importRows([item])} className="rounded-md border border-line bg-white px-3 py-2 disabled:opacity-50">{item.error ? "Riprova" : archivedId(item) ? "Carica in revisione" : "Archivia e carica"}</button>}
        </li>)}
      </ul>
      </div>
      </div>
      <div hidden={source !== "drive"}><DriveInvoicesPanel onInvoice={onInvoice} /></div>
    </>}
  </section>;
}
