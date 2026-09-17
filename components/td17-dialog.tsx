"use client";

import { useEffect, useRef, useState } from "react";
import { CheckCircle2, ExternalLink, FileCheck2, X } from "lucide-react";
import type { InvoiceFields } from "@/lib/types";
import type { FicSupplier } from "@/lib/expense-validation";
import { matchExpenseSupplier } from "@/lib/expense-preferences";
import type { Td17Options, Td17Preview, Td17Result, Td17Vat } from "@/lib/td17";

async function requestTd17(body: unknown) {
  const response = await fetch("/api/fatture-in-cloud/td17", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error ?? "Operazione TD17 non riuscita.");
  return data;
}

const money = (value: number) => new Intl.NumberFormat("it-IT", { style: "currency", currency: "EUR" }).format(value);
const date = (value: string) => value.split("-").reverse().join("/");

export function Td17Dialog({ invoice, companyId, onClose, onCreated }: {
  invoice: InvoiceFields; companyId: number; onClose: () => void; onCreated: (result: Td17Result) => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const submitted = useRef(false);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState("");
  const [suppliers, setSuppliers] = useState<FicSupplier[]>([]);
  const [vats, setVats] = useState<Td17Vat[]>([]);
  const [options, setOptions] = useState<Td17Options>({ supplierId: 0, documentDate: invoice.invoice_date, vatId: -1, numeration: "/TD17", paymentMethod: "MP08" });
  const [preview, setPreview] = useState<Td17Preview | null>(null);
  const [result, setResult] = useState<Td17Result | null>(null);
  const [confirmed, setConfirmed] = useState(false);
  const [uncertain, setUncertain] = useState(false);

  useEffect(() => {
    dialog.current?.showModal();
    let cancelled = false;
    requestTd17({ action: "settings", companyId }).then((data: { suppliers: FicSupplier[]; vatTypes: Td17Vat[]; paymentMethod: string }) => {
      if (cancelled) return;
      setSuppliers(data.suppliers);
      setVats(data.vatTypes);
      const matches = data.vatTypes.filter((vat) => vat.value === 22);
      setOptions((current) => ({ ...current, supplierId: matchExpenseSupplier(data.suppliers, invoice.supplier_vat)?.id ?? 0, vatId: matches.length === 1 ? matches[0].id : -1, paymentMethod: data.paymentMethod }));
    }).catch((error) => { if (!cancelled) setError(error.message); }).finally(() => { if (!cancelled) setBusy(false); });
    return () => { cancelled = true; };
  }, [companyId, invoice]);

  function complete(data: Td17Result) { setResult(data); onCreated(data); }
  async function prepare() {
    setBusy(true); setError("");
    try {
      const data = await requestTd17({ action: "preview", companyId, invoice, options, approved: true });
      if (data.existing) complete(data.existing);
      else { setPreview(data); setConfirmed(false); }
    } catch (error) { setError(error instanceof Error ? error.message : "Verifica non riuscita."); }
    finally { setBusy(false); }
  }
  async function create() {
    if (!confirmed || !preview || submitted.current) return;
    submitted.current = true; setBusy(true); setError("");
    try { complete(await requestTd17({ action: "create", confirmed: true, ticket: preview.ticket })); }
    catch (error) { setUncertain(true); setError(error instanceof Error ? error.message : "Esito incerto: controlla le Autofatture in FIC senza ricreare il documento."); }
    finally { setBusy(false); }
  }

  const input = "mt-1 h-10 w-full min-w-0 rounded-md border border-line bg-white px-3 text-sm";
  return <dialog ref={dialog} aria-labelledby="td17-title" className="m-auto max-h-[90dvh] w-[min(680px,calc(100%-32px))] overflow-y-auto rounded-lg border border-line p-0 text-ink shadow-xl backdrop:bg-black/40" onCancel={(event) => { event.preventDefault(); if (!busy) onClose(); }}>
    <header className="flex items-center justify-between gap-3 border-b border-line p-5">
      <h2 id="td17-title" className="text-lg font-semibold">{result ? "TD17 in Fatture in Cloud" : preview ? "Conferma TD17 non inviato" : "Prepara TD17"}</h2>
      <button aria-label="Chiudi" title="Chiudi" disabled={busy} onClick={onClose} className="flex size-9 shrink-0 items-center justify-center rounded-md hover:bg-slate-100 disabled:opacity-40"><X size={20} /></button>
    </header>
    <div className="space-y-4 p-5">
      <p className="break-words text-sm font-medium">{invoice.supplier} · {invoice.invoice_number}</p>
      {error && <p role="alert" className="border-l-2 border-red-500 pl-3 text-sm text-red-700">{error}</p>}
      {result ? <div role="status" className="space-y-3 text-sm">
        <CheckCircle2 className="text-emerald-600" />
        <p>{result.alreadyExists ? "TD17 gia presente: nessun duplicato creato." : "TD17 salvato. L'app non ha effettuato l'invio allo SDI."}</p>
        <p>Documento FIC <strong>#{result.id}</strong>{result.number !== undefined ? ` · ${result.number}${result.numeration ?? ""}` : ""}</p>
        <p>Stato FIC: <strong>{result.eiStatus === "not_sent" ? "Non inviato" : result.eiStatus === "unknown" ? "Da verificare in FIC" : result.eiStatus}</strong></p>
        {result.xmlValid === true && <p className="text-emerald-700">Verifica formale XML superata.</p>}
        {result.warning && <p className="text-amber-800">{result.warning}</p>}
        <p>Controllo finale e invio restano in FIC, nella sezione Autofatture.</p>
        <a href="https://secure.fattureincloud.it/" target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-2 rounded-md bg-ink px-4 py-2 text-white"><ExternalLink size={16} />Apri Fatture in Cloud</a>
      </div> : preview ? <div className="space-y-4 text-sm">
        <dl className="grid grid-cols-[auto,minmax(0,1fr)] gap-x-4 gap-y-2 [&_dd]:break-words">
          <dt>Azienda</dt><dd>{preview.companyName}</dd>
          <dt>Fornitore estero</dt><dd>{preview.supplier.name} · {preview.supplier.vat_number}</dd>
          <dt>Paese</dt><dd>{preview.supplier.country}</dd>
          <dt>Indirizzo</dt><dd>{preview.supplier.address_street}, {preview.supplier.address_city}</dd>
          <dt>Regime fornitore</dt><dd>RF01</dd>
          <dt>Spesa originale</dt><dd>FIC #{preview.expenseId}</dd>
          <dt>Riferimento</dt><dd>{invoice.invoice_number} · {date(invoice.invoice_date)}</dd>
          <dt>Data TD17</dt><dd>{date(preview.options.documentDate)}</dd>
          <dt>Numerazione</dt><dd>Progressivo FIC automatico · {preview.options.numeration}</dd>
          <dt>Centro</dt><dd>WEB</dd>
          <dt>Imponibile</dt><dd>{money(preview.net)}</dd>
          <dt>IVA integrata</dt><dd>{preview.vat.value}% · {money(preview.tax)}</dd>
          <dt>Totale TD17</dt><dd className="font-semibold">{money(preview.total)}</dd>
          <dt>Pagamento TD17</dt><dd>Stornato · {preview.options.paymentMethod}</dd>
          <dt>Invio SDI</dt><dd>Non eseguito dall&apos;app</dd>
        </dl>
        <label className="flex items-start gap-3 border-t border-line pt-4">
          <input type="checkbox" className="mt-1 size-4 shrink-0" checked={confirmed} disabled={busy || uncertain} onChange={(event) => setConfirmed(event.target.checked)} />
          <span>Confermo servizi esteri, data e IVA. Salva il TD17 non inviato nell&apos;azienda {preview.companyName}; approvero l&apos;invio in FIC.</span>
        </label>
        <div className="flex flex-wrap justify-end gap-3">
          <button disabled={busy || uncertain} onClick={() => setPreview(null)} className="rounded-md border border-line px-4 py-2 disabled:opacity-40">Modifica</button>
          <button disabled={!confirmed || busy || uncertain} onClick={create} className="inline-flex items-center gap-2 rounded-md bg-ink px-4 py-2 text-white disabled:opacity-40"><FileCheck2 size={16} />{busy ? "Salvataggio..." : "Salva TD17 non inviato"}</button>
        </div>
      </div> : <div className="space-y-4 text-sm">
        <label className="block">Fornitore estero<select disabled={busy} className={input} value={options.supplierId || ""} onChange={(event) => setOptions({ ...options, supplierId: Number(event.target.value) })}>
          <option value="">Seleziona fornitore</option>{suppliers.map((supplier) => <option key={supplier.id} value={supplier.id}>{supplier.name}</option>)}
        </select></label>
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="block">Data TD17 (da confermare)<input type="date" disabled={busy} className={input} value={options.documentDate} onChange={(event) => setOptions({ ...options, documentDate: event.target.value })} /></label>
          <label className="block">IVA da integrare<select disabled={busy} className={input} value={options.vatId} onChange={(event) => setOptions({ ...options, vatId: Number(event.target.value) })}><option value={-1}>Seleziona aliquota</option>{vats.map((vat) => <option key={vat.id} value={vat.id}>{vat.value}% {vat.description}</option>)}</select></label>
        </div>
        <p className="text-xs text-slate-600">Data: mese di ricezione per servizi UE; data dell&apos;operazione per servizi extra UE. Il 22% e una proposta da confermare.</p>
        <details><summary className="cursor-pointer py-2">Numerazione e pagamento</summary><div className="grid gap-4 py-3 sm:grid-cols-2">
          <label>Sezionale<input disabled={busy} className={input} maxLength={11} value={options.numeration} onChange={(event) => setOptions({ ...options, numeration: event.target.value })} /></label>
          <label>Metodo pagamento<select disabled={busy} className={input} value={options.paymentMethod} onChange={(event) => setOptions({ ...options, paymentMethod: event.target.value })}>{Array.from({ length: 23 }, (_, i) => `MP${String(i + 1).padStart(2, "0")}`).map((code) => <option key={code} value={code}>{code}{code === "MP08" ? " - Carta" : code === "MP05" ? " - Bonifico" : ""}</option>)}</select></label>
        </div></details>
        <p className="border-l-2 border-amber-400 pl-3 text-amber-800">Solo salvataggio del TD17. Nessun invio SDI e nessuna nuova spesa.</p>
        <div className="flex justify-end"><button disabled={busy || !options.supplierId || options.vatId < 0} onClick={prepare} className="rounded-md bg-ink px-4 py-2 text-white disabled:opacity-40">{busy ? "Verifica..." : "Controlla TD17"}</button></div>
      </div>}
    </div>
  </dialog>;
}
