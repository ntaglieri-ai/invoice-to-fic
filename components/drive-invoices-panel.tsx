"use client";

import { useState } from "react";
import { ChevronLeft, ChevronRight, Download, ExternalLink, FolderOpen, Search } from "lucide-react";
import type { ArchivedInvoice, DriveInvoiceFile } from "@/lib/google-invoices";

type Page = { files: DriveInvoiceFile[]; nextPageToken: string | null };
async function request(body: unknown) {
  const response = await fetch("/api/google/invoices", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || "Archivio Drive non disponibile.");
  return data;
}

export function DriveInvoicesPanel({ onInvoice }: { onInvoice: (result: ArchivedInvoice) => void }) {
  const [month, setMonth] = useState(() => new Date().toLocaleDateString("sv-SE").slice(0, 7));
  const [supplier, setSupplier] = useState("");
  const [pages, setPages] = useState<Page[]>([]);
  const [index, setIndex] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const page = pages[index];
  function reset() { setPages([]); setIndex(0); setError(""); setNotice(""); }
  async function search(target = 0, token = "") {
    setBusy(true); setError(""); setNotice("");
    try {
      const result: Page = await request({ action: "drive-list", month, supplier, ...(token ? { pageToken: token } : {}) });
      setPages((current) => [...current.slice(0, target), result]); setIndex(target);
    } catch (e) { setError(e instanceof Error ? e.message : "Ricerca non riuscita."); }
    finally { setBusy(false); }
  }
  async function load(files: DriveInvoiceFile[]) {
    setBusy(true); setError(""); setNotice(""); let count = 0;
    try {
      for (const file of files) { onInvoice(await request({ action: "drive-load", fileId: file.id })); count++; }
    } catch (e) { setError(e instanceof Error ? e.message : "Caricamento non riuscito."); }
    finally { if (count) setNotice(`${count} fatture caricate in revisione.`); setBusy(false); }
  }
  return <div className="mt-5 border-t border-line pt-4">
    <h3 className="flex items-center gap-2 font-semibold"><FolderOpen size={18} /> Archivio Drive</h3>
    <div className="mt-3 flex flex-wrap items-end gap-3">
      <label className="text-sm">Mese fatture<input aria-label="Mese archivio Drive" type="month" value={month} disabled={busy} onChange={(e) => { setMonth(e.target.value); reset(); }} className="mt-1 block h-10 rounded-md border border-line bg-white px-3" /></label>
      <label className="text-sm">Fornitore<select aria-label="Fornitore archivio Drive" value={supplier} disabled={busy} onChange={(e) => { setSupplier(e.target.value); reset(); }} className="mt-1 block h-10 rounded-md border border-line bg-white px-3"><option value="">Tutti</option>{["OpenAI", "Anthropic", "Vercel", "Hetzner", "Supabase"].map((name) => <option key={name}>{name}</option>)}</select></label>
      <button type="button" disabled={busy || !month} onClick={() => search()} className="flex h-10 items-center gap-2 rounded-md border border-line bg-white px-3 text-sm disabled:opacity-40"><Search size={16} /> Cerca su Drive</button>
      <button type="button" disabled={busy || !page?.files.length} onClick={() => load(page.files)} className="flex h-10 items-center gap-2 rounded-md bg-ink px-3 text-sm text-white disabled:opacity-40"><Download size={16} /> Carica pagina in revisione</button>
    </div>
    {busy && <p role="status" className="mt-3 text-sm">Operazione in corso...</p>}
    {error && <p role="alert" className="mt-3 text-sm text-red-700">{error}</p>}
    {notice && <p role="status" className="mt-3 text-sm text-emerald-700">{notice}</p>}
    {page && <>
      <nav aria-label="Paginazione archivio Drive" className="mt-4 flex items-center justify-between text-sm"><span>Pagina {index + 1}</span><div className="flex gap-2"><button type="button" aria-label="Pagina Drive precedente" title="Pagina precedente" disabled={busy || index === 0} onClick={() => setIndex(index - 1)} className="h-9 w-9 rounded-md border border-line bg-white disabled:opacity-40"><ChevronLeft className="mx-auto" size={18} /></button><button type="button" aria-label="Pagina Drive successiva" title="Pagina successiva" disabled={busy || !page.nextPageToken} onClick={() => pages[index + 1] ? setIndex(index + 1) : search(index + 1, page.nextPageToken!)} className="h-9 w-9 rounded-md border border-line bg-white disabled:opacity-40"><ChevronRight className="mx-auto" size={18} /></button></div></nav>
      {!page.files.length && <p className="mt-3 text-sm text-slate-500">Nessuna fattura archiviata nel mese selezionato.</p>}
      <ul className="mt-2 divide-y divide-line">{page.files.map((file) => <li key={file.id} className="flex flex-wrap items-center justify-between gap-3 py-3 text-sm"><div className="min-w-0 flex-1 break-words"><p className="font-medium">{file.name}</p>{file.invoiceDate && <p className="text-slate-500">{file.invoiceDate.split("-").reverse().join("/")}</p>}</div><a aria-label={`Apri su Drive ${file.name}`} href={`https://drive.google.com/file/d/${encodeURIComponent(file.id)}/view`} target="_blank" rel="noopener noreferrer" title="Apri su Drive"><ExternalLink size={16} /></a><button type="button" disabled={busy} onClick={() => load([file])} className="rounded-md border border-line bg-white px-3 py-2 disabled:opacity-40">Carica in revisione</button></li>)}</ul>
    </>}
  </div>;
}
