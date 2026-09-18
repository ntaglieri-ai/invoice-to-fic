"use client";

import { useEffect, useState } from "react";
import { Download, ExternalLink, Link2, LoaderCircle, Mail, Search, Unplug } from "lucide-react";
import type { MailCandidate } from "@/lib/mail-invoices";
import type { ArchivedInvoice } from "@/lib/google-invoices";

type Status = { connected: boolean; config: { configured: boolean; missing: string[] } };
type Item = MailCandidate & { partId: string; fileName: string; key: string; result?: ArchivedInvoice; error?: string };
async function action(body: unknown) {
  const response = await fetch("/api/google/invoices", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || "Google non disponibile.");
  return data;
}

export function GoogleInvoicesPanel({ onInvoice }: { onInvoice: (result: ArchivedInvoice) => void }) {
  const [status, setStatus] = useState<Status | null>(null);
  const [month, setMonth] = useState(() => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`; });
  const [items, setItems] = useState<Item[]>([]);
  const [nextPage, setNextPage] = useState<string | null>(null);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [scanned, setScanned] = useState(false);
  useEffect(() => {
    fetch("/api/google/invoices", { cache: "no-store" }).then(async (r) => { if (!r.ok) throw new Error("Connessione Google non disponibile."); setStatus(await r.json()); }).catch((e) => setError(e.message));
    if (new URLSearchParams(window.location.search).get("google") === "authorization-error") setError("Autorizzazione Google non completata. Ricollega e autorizza Gmail e Drive.");
  }, []);

  async function scan(more = false) {
    setBusy("scan"); setError("");
    try {
      const data = await action({ action: "scan", month, ...(more && nextPage ? { pageToken: nextPage } : {}) });
      const rows = (data.items as MailCandidate[]).flatMap((mail) => {
        const files = mail.invoices.length ? mail.invoices : [{ partId: mail.linkAvailable ? "openai-link" : "", name: mail.linkAvailable ? "Fattura OpenAI (link)" : "Da verificare" }];
        return files.map((file) => ({ ...mail, partId: file.partId, fileName: file.name, key: `${mail.id}:${file.partId}` }));
      });
      setItems((previous) => more ? [...previous, ...rows.filter((r) => !previous.some((p) => p.key === r.key))] : rows);
      setNextPage(data.nextPageToken); setScanned(true);
    } catch (e) { setError(e instanceof Error ? e.message : "Ricerca non riuscita."); }
    finally { setBusy(""); }
  }

  async function importRows(rows: Item[]) {
    for (const row of rows) {
      setBusy(row.key);
      try {
        const result: ArchivedInvoice = await action({ action: "import", messageId: row.id, partId: row.partId });
        onInvoice(result);
        setItems((current) => current.map((item) => item.key === row.key ? { ...item, result, error: undefined } : item));
      } catch (e) {
        setItems((current) => current.map((item) => item.key === row.key ? { ...item, error: e instanceof Error ? e.message : "Importazione non riuscita." } : item));
      }
    }
    setBusy("");
  }

  return <section className="border-y border-line py-5" aria-labelledby="google-title">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <h2 id="google-title" className="flex items-center gap-2 text-lg font-semibold"><Mail size={20} /> Gmail e Drive <span className="text-sm font-normal text-slate-500">Fatture SaaS</span></h2>
      {status?.connected ? <button type="button" disabled={Boolean(busy)} className="flex items-center gap-2 text-sm disabled:opacity-50" onClick={async () => { setBusy("disconnect"); try { await action({ action: "disconnect" }); setStatus({ ...status, connected: false }); setItems([]); setScanned(false); } catch { setError("Scollegamento non riuscito."); } finally { setBusy(""); } }}><Unplug size={16} /> Scollega Google</button>
        : status?.config.configured ? <a href="/api/google/connect" className="flex items-center gap-2 rounded-md bg-ink px-4 py-2 text-sm text-white"><Link2 size={16} /> Collega Google</a>
          : <span className="text-sm text-amber-800">Configurazione Google da completare</span>}
    </div>
    {error && <p role="alert" className="mt-3 text-sm text-red-700">{error}</p>}
    {status?.connected && <>
      <div className="mt-4 flex flex-wrap items-end gap-3">
        <label className="text-sm">Mese ricezione mail<input aria-label="Mese ricezione mail" type="month" value={month} disabled={Boolean(busy)} onChange={(e) => { setMonth(e.target.value); setItems([]); setNextPage(null); setScanned(false); }} className="mt-1 block h-10 rounded-md border border-line bg-white px-3" /></label>
        <button disabled={Boolean(busy) || !month} onClick={() => scan()} className="flex h-10 items-center gap-2 rounded-md border border-line bg-white px-3 text-sm disabled:opacity-50"><Search size={16} /> Cerca mail</button>
        <button disabled={Boolean(busy) || !items.some((i) => i.partId && !i.result)} onClick={() => importRows(items.filter((i) => i.partId && !i.result))} className="flex h-10 items-center gap-2 rounded-md bg-ink px-3 text-sm text-white disabled:opacity-50"><Download size={16} /> Importa fatture elencate</button>
        {busy && <span role="status" className="flex items-center gap-2 text-sm"><LoaderCircle className="animate-spin" size={16} /> {busy === "scan" ? "Ricerca mail" : "Operazione in corso"}</span>}
      </div>
      {scanned && !items.length && <p className="mt-4 text-sm text-slate-500">Nessuna mail trovata per questo mese.</p>}
      <ul className="mt-4 divide-y divide-line">
        {items.map((item) => <li key={item.key} className="flex flex-wrap items-center justify-between gap-3 py-3 text-sm">
          <div className="min-w-0 flex-1 basis-64 break-words"><p className="font-medium">{item.supplier} · {item.fileName}</p><p className="text-slate-500">{item.subject}</p>
            {item.receipts > 0 && <p className="text-xs text-slate-500">{item.receipts} ricevute escluse</p>}
            {item.warning && <p className="text-amber-800">{item.warning}</p>}
            {item.error && <p role="alert" className="text-red-700">{item.error}</p>}
          </div>
          <a href={`https://mail.google.com/mail/u/0/#all/${encodeURIComponent(item.id)}`} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1">Mail <ExternalLink size={14} /></a>
          {item.result ? <a href={`https://drive.google.com/file/d/${encodeURIComponent(item.result.driveId)}/view`} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-emerald-700">{item.result.duplicate ? "Gia su Drive" : "Archiviata"} <ExternalLink size={14} /></a>
            : item.partId && <button disabled={Boolean(busy)} onClick={() => importRows([item])} className="rounded-md border border-line bg-white px-3 py-2 disabled:opacity-50">{item.error ? "Riprova" : "Importa"}</button>}
        </li>)}
      </ul>
      {nextPage && <button disabled={Boolean(busy)} onClick={() => scan(true)} className="mt-2 text-sm underline disabled:opacity-50">Altre mail</button>}
    </>}
  </section>;
}
