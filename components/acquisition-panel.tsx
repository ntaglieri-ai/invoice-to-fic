"use client";
import { useState } from "react";
import { Mail, FolderOpen, Upload, Search, ChevronLeft, ChevronRight, Check, ExternalLink, Download, Clock3 } from "lucide-react";
import type { ArchivedInvoice } from "@/lib/google-invoices";
import type { MailCandidate } from "@/lib/mail-invoices";
import type { WorkflowInvoice } from "@/lib/invoice-workflow";
import { acquisitionDownloadState, acquisitionInRegister, mailAcquisitionEntries, type AcquisitionEntry } from "@/lib/acquisition-state";

type Entry = AcquisitionEntry;
type Page = { entries: Entry[]; next?: string };
class AcquisitionError extends Error { constructor(message: string, public stop: boolean) { super(message); } }
async function request(body: unknown) {
  const response = await fetch("/api/google/invoices", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const data = await response.json();
  if (!response.ok) throw new AcquisitionError(data.error || "Operazione non riuscita.", data.stopBatch || response.status === 401 || response.status === 429);
  return data;
}
export function AcquisitionPanel({ initialMonth, invoices, enabled, onInvoice, onBusy, onUpload, uploading }: {
  initialMonth: string; invoices: WorkflowInvoice[]; enabled: boolean; onInvoice: (value: ArchivedInvoice) => void; onBusy: (value: boolean) => void; onUpload: (files: File[]) => Promise<void>; uploading: boolean;
}) {
  const [source, setSource] = useState("mail");
  const [month, setMonth] = useState(initialMonth);
  const [supplier, setSupplier] = useState("");
  const [pages, setPages] = useState<Page[]>([]);
  const [index, setIndex] = useState(0);
  const [selected, setSelected] = useState<string[]>([]);
  const [loaded, setLoaded] = useState<string[]>([]);
  const [manualDownloads, setManualDownloads] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const page = pages[index];
  const present = (entry: Entry) => acquisitionInRegister(entry, invoices, loaded);
  const available = page?.entries.filter((entry) => !present(entry) && !entry.warning) ?? [];
  function reset() { setPages([]); setIndex(0); setSelected([]); setError(""); setNotice(""); }
  function working(value: boolean) { setBusy(value); onBusy(value); }
  function markManualDownload(messageId: string) {
    const next = [...new Set([...manualDownloads, messageId])];
    setManualDownloads(next);
    try { localStorage.setItem("invoice-to-fic:manual-downloads:v1", JSON.stringify(next)); }
    catch { setError("Segnalazione download disponibile solo in questa sessione."); }
  }
  async function search(target = 0, token?: string) {
    working(true); setError(""); setSelected([]); setNotice("");
    try {
      const data = await request({ action: source === "mail" ? "scan" : "drive-list", month, supplier, ...(token ? { pageToken: token } : {}) });
      try {
        const stored: unknown = JSON.parse(localStorage.getItem("invoice-to-fic:manual-downloads:v1") ?? "[]");
        if (Array.isArray(stored)) setManualDownloads(stored.filter((id): id is string => typeof id === "string"));
      } catch { /* Manual download markers are optional; managed invoices are stored online. */ }
      const entries: Entry[] = source === "mail" ? (data.items as MailCandidate[]).flatMap(mailAcquisitionEntries)
        : data.files.map((file: { id: string; name: string; invoiceDate?: string }) => ({ key: file.id, driveId: file.id, name: file.name, date: file.invoiceDate, dateKind: "invoice", archiveChecked: true }));
      setPages((current) => [...current.slice(0, target), { entries, next: data.nextPageToken }]); setIndex(target);
      if (data.archiveWarning) setError(data.archiveWarning);
    } catch (e) { setError(e instanceof Error ? e.message : "Ricerca non riuscita."); }
    finally { working(false); }
  }
  async function acquire(entries: Entry[]) {
    working(true); setError(""); setNotice(""); let count = 0;
    for (const entry of entries) {
      try {
        const result: ArchivedInvoice = await request(entry.driveId ? { action: "drive-load", fileId: entry.driveId } : { action: "import", messageId: entry.messageId, partId: entry.partId });
        onInvoice(result); setLoaded((current) => [...current, entry.key]); setSelected((current) => current.filter((key) => key !== entry.key)); count++;
        setPages((current) => current.map((page) => ({ ...page, entries: page.entries.map((item) => item.key === entry.key ? { ...item, driveId: result.driveId, date: result.invoice.invoice.invoice_date || item.date, dateKind: result.invoice.invoice.invoice_date ? "invoice" : item.dateKind } : item) })));
      } catch (e) { setError(`${entry.name}: ${e instanceof Error ? e.message : "Acquisizione non riuscita."}`); if (e instanceof AcquisitionError && e.stop) break; }
    }
    setNotice(count ? `${count} fatture acquisite nel registro, nel mese della fattura.` : ""); working(false);
  }
  return <div className="acquisition-panel"><nav className="acquisition-tabs" aria-label="Origine fatture">{[["mail", "Gmail", Mail], ["drive", "Drive", FolderOpen], ["computer", "Computer", Upload]].map(([key, label, Icon]) => {
    const Symbol = Icon as typeof Mail; return <button key={String(key)} aria-pressed={source === key} disabled={busy || uploading} onClick={() => { setSource(String(key)); reset(); }}><Symbol size={17}/>{String(label)}</button>;
  })}</nav>
    {!enabled && <p className="sf-alert alert-warning">Collega Google e FIC nelle impostazioni e attendi il caricamento del registro.</p>}
    {source === "computer" ? <label className="acquisition-upload"><Upload size={32}/><strong>Seleziona fatture PDF</strong><input aria-label="Seleziona fatture PDF" type="file" accept="application/pdf,.pdf" multiple disabled={!enabled || uploading} onChange={(e) => { void onUpload(Array.from(e.target.files ?? [])); e.target.value = ""; }}/>{uploading && <span role="status">Acquisizione in corso...</span>}</label> : <>
      <div className="acquisition-controls"><label>{source === "mail" ? "Ricezione mail" : "Mese fattura"}<input type="month" value={month} disabled={busy} onChange={(e) => { setMonth(e.target.value); reset(); }}/></label><label>Fornitore<select value={supplier} disabled={busy} onChange={(e) => { setSupplier(e.target.value); reset(); }}><option value="">Tutti i fornitori</option>{["OpenAI", "Anthropic", "Vercel", "Hetzner", "Supabase"].map((name) => <option key={name}>{name}</option>)}</select></label><button className="sf-button" disabled={!enabled || busy || !month} onClick={() => void search()}><Search size={16}/>Cerca</button></div>
      {page && <><div className="acquisition-selection"><label><input type="checkbox" aria-label="Seleziona pagina" disabled={busy || !available.length} checked={available.length > 0 && available.every((entry) => selected.includes(entry.key))} onChange={(e) => setSelected(e.target.checked ? available.map((entry) => entry.key) : [])}/>Seleziona pagina</label><button className="sf-button sf-primary" disabled={busy || !enabled || !selected.length} onClick={() => void acquire(available.filter((entry) => selected.includes(entry.key)))}><Upload size={15}/>Acquisisci {selected.length ? `(${selected.length})` : ""}</button></div>
      <ul className="acquisition-list">{page.entries.map((entry) => <li key={entry.key}>
        <input type="checkbox" aria-label={`Seleziona ${entry.name}`} disabled={busy || present(entry) || Boolean(entry.warning)} checked={selected.includes(entry.key)} onChange={(e) => setSelected((current) => e.target.checked ? [...current, entry.key] : current.filter((key) => key !== entry.key))}/>
        <div className="acquisition-row-name"><strong>{entry.name}</strong>{entry.driveId && <small>PDF su Drive</small>}{entry.warning && <small className="text-amber-800">{entry.warning}</small>}</div>
        <div className="acquisition-row-date"><span>{entry.date?.split("-").reverse().join("/") || "Data non disponibile"}</span><small>{entry.dateKind === "mail" ? "Ricezione mail" : "Data fattura"}</small></div>
        <div className="acquisition-row-state">{(() => {
          const state = acquisitionDownloadState(entry, present(entry) ? [entry.key] : loaded, manualDownloads);
          return <span className={`sf-badge ${state === "downloaded" ? "badge-aqua" : state === "not_downloaded" ? "badge-amber" : "badge-neutral"}`} data-download={state}>{state === "downloaded" ? <Check size={13}/> : state === "not_downloaded" ? <Download size={13}/> : <Clock3 size={13}/>}{{ downloaded: "Scaricata", not_downloaded: "Non scaricata", manual: "Scaricata (segnalata)", unknown: "Da verificare" }[state]}</span>;
        })()}{present(entry) && <small>In registro</small>}</div>
        <div className="acquisition-row-actions">
          {!present(entry) && !entry.warning && <button title={entry.driveId ? "Carica nel registro" : "Scarica e acquisisci"} aria-label={`Acquisisci ${entry.name}`} className="sf-icon" disabled={busy || !enabled} onClick={() => void acquire([entry])}><Upload size={16}/></button>}
          {entry.driveId ? <a className="sf-icon" title="Apri PDF su Drive" aria-label={`Apri PDF ${entry.name}`} href={`https://drive.google.com/file/d/${encodeURIComponent(entry.driveId)}/view`} target="_blank" rel="noopener noreferrer"><ExternalLink size={15}/></a> : entry.messageId && <a className="sf-icon" title="Apri mail" aria-label="Apri mail" href={`https://mail.google.com/mail/u/0/#all/${encodeURIComponent(entry.messageId)}`} target="_blank" rel="noopener noreferrer" onClick={() => markManualDownload(entry.messageId!)}><ExternalLink size={15}/></a>}
        </div>
      </li>)}</ul>
      {!page.entries.length && <p className="sf-notice">Nessuna fattura trovata.</p>}<nav className="acquisition-pagination" aria-label="Paginazione acquisizione"><span>Pagina {index + 1}</span><button className="sf-icon" title="Pagina precedente" aria-label="Pagina precedente" disabled={busy || index === 0} onClick={() => { setIndex(index - 1); setSelected([]); }}><ChevronLeft size={16}/></button><button className="sf-icon" title="Pagina successiva" aria-label="Pagina successiva" disabled={busy || !page.next} onClick={() => pages[index + 1] ? (setIndex(index + 1), setSelected([])) : void search(index + 1, page.next)}><ChevronRight size={16}/></button></nav></>}
    </>}{busy && <p role="status" className="sf-notice">Operazione in corso...</p>}{error && <p role="alert" className="sf-alert alert-error">{error}</p>}{notice && <p role="status" className="sf-notice">{notice}</p>}
  </div>;
}
