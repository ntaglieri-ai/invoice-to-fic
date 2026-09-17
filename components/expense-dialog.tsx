"use client";

import { useEffect, useRef, useState } from "react";
import { CheckCircle2, Send, X } from "lucide-react";
import type { InvoiceFields } from "@/lib/types";
import type { ExpensePreview, FicSupplier } from "@/lib/expense-validation";

async function expenseRequest(body: unknown) {
  const response = await fetch("/api/fatture-in-cloud/expenses", {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error ?? "Operazione non riuscita.");
  return result;
}

export function ExpenseDialog({ invoice, companyId, onClose, onCreated }: {
  invoice: InvoiceFields;
  companyId: number;
  onClose: () => void;
  onCreated: (id: number) => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const submitting = useRef(false);
  const [suppliers, setSuppliers] = useState<FicSupplier[]>([]);
  const [supplierId, setSupplierId] = useState("");
  const [tax, setTax] = useState("");
  const [vat, setVat] = useState("");
  const [dueDate, setDueDate] = useState(invoice.invoice_date);
  const [preview, setPreview] = useState<ExpensePreview | null>(null);
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState("");
  const [result, setResult] = useState<{ id: number; alreadyExists: boolean } | null>(null);
  const [uncertain, setUncertain] = useState(false);

  useEffect(() => {
    dialog.current?.showModal();
    let cancelled = false;
    expenseRequest({ action: "suppliers", companyId }).then((payload) => {
      if (!cancelled) setSuppliers(payload.suppliers);
    }).catch((error) => { if (!cancelled) setError(error.message); })
      .finally(() => { if (!cancelled) setBusy(false); });
    return () => { cancelled = true; };
  }, [companyId]);

  async function prepare(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      const payload = await expenseRequest({
        action: "preview", companyId, invoice, approved: true,
        options: { supplierId: Number(supplierId), taxDeductibility: Number(tax), vatDeductibility: Number(vat), dueDate },
      });
      setPreview(payload);
      setConfirmed(false);
    } catch (error) { setError(error instanceof Error ? error.message : "Anteprima non disponibile."); }
    finally { setBusy(false); }
  }

  async function create() {
    if (!preview || !confirmed || submitting.current) return;
    submitting.current = true;
    setBusy(true);
    setError("");
    try {
      const response = await expenseRequest({ action: "create", ticket: preview.ticket, confirmed: true });
      setResult(response);
      onCreated(response.id);
    } catch (error) {
      setUncertain(true);
      setError(error instanceof Error ? error.message : "Esito non confermato: verifica le Spese in FIC.");
    } finally { setBusy(false); }
  }

  const input = "mt-1 h-10 w-full rounded-md border border-line bg-white px-3 text-sm";
  return (
    <dialog ref={dialog} aria-labelledby="expense-title" className="m-auto max-h-[90dvh] w-[min(680px,calc(100%-32px))] overflow-y-auto rounded-lg border border-line p-0 text-ink shadow-xl backdrop:bg-black/40"
      onCancel={(event) => { event.preventDefault(); if (!busy) onClose(); }}>
      <header className="flex items-center justify-between border-b border-line p-5">
        <h2 id="expense-title" className="text-lg font-semibold">{result ? "Spesa registrata" : preview ? "Conferma spesa" : "Prepara spesa"}</h2>
        <button type="button" aria-label="Chiudi" title="Chiudi" disabled={busy} onClick={onClose} className="flex size-9 items-center justify-center rounded-md hover:bg-slate-100 disabled:opacity-40"><X size={20} /></button>
      </header>
      <div className="space-y-5 p-5">
        <p className="text-sm font-medium">{invoice.supplier} · {invoice.invoice_number}</p>
        {error && <p role="alert" className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</p>}
        {result ? <div role="status" className="space-y-3">
          <CheckCircle2 className="text-emerald-600" />
          <p>{result.alreadyExists ? "La spesa era gia presente: nessun duplicato creato." : "Spesa creata in Fatture in Cloud."}</p>
          <p className="text-sm">Identificativo: <strong>{result.id}</strong></p>
          <button type="button" onClick={onClose} className="rounded-md bg-ink px-4 py-2 text-white">Chiudi</button>
        </div> : preview ? <div className="space-y-4">
          <dl className="grid grid-cols-[auto,1fr] gap-x-5 gap-y-2 text-sm [&_dd]:break-words">
            <dt>Azienda</dt><dd className="font-medium">{preview.companyName}</dd>
            <dt>Fornitore FIC</dt><dd>{preview.supplier.name} · {preview.supplier.vat_number || "VAT non presente"}</dd>
            <dt>Data</dt><dd>{invoice.invoice_date.split("-").reverse().join("/")}</dd>
            <dt>Imponibile / IVA</dt><dd>{invoice.net_amount?.toFixed(2)} / {invoice.tax_amount?.toFixed(2)} EUR</dd>
            <dt>Totale</dt><dd className="font-semibold">{invoice.total_amount?.toFixed(2)} EUR</dd>
            <dt>Deducibilita costo</dt><dd>{preview.options.taxDeductibility}%</dd>
            <dt>Detraibilita IVA</dt><dd>{preview.options.vatDeductibility}%</dd>
            <dt>Pagamento</dt><dd>Non pagato · scadenza {preview.options.dueDate.split("-").reverse().join("/")}</dd>
            <dt>Reverse charge / SDI</dt><dd>Non elaborati</dd>
            <dt>Allegato PDF</dt><dd>Non trasferito</dd>
          </dl>
          <label className="flex items-start gap-3 border-t border-line pt-4 text-sm">
            <input type="checkbox" className="mt-1 size-4" checked={confirmed} disabled={busy || uncertain} onChange={(event) => setConfirmed(event.target.checked)} />
            <span>Confermo i dati e la registrazione della spesa nell&apos;azienda {preview.companyName}.</span>
          </label>
          <div className="flex flex-wrap justify-end gap-3">
            <button type="button" disabled={busy || uncertain} onClick={() => setPreview(null)} className="rounded-md border border-line px-4 py-2 text-sm disabled:opacity-40">Modifica</button>
            <button type="button" disabled={!confirmed || busy || uncertain} onClick={create} className="inline-flex items-center gap-2 rounded-md bg-ink px-4 py-2 text-sm text-white disabled:opacity-40"><Send size={16} />{busy ? "Registrazione..." : "Conferma e crea spesa"}</button>
          </div>
        </div> : <form onSubmit={prepare} className="space-y-4">
          <label className="block text-sm">Fornitore in Fatture in Cloud
            <select required disabled={busy} className={input} value={supplierId} onChange={(event) => setSupplierId(event.target.value)}>
              <option value="">Seleziona fornitore</option>
              {suppliers.map((supplier) => <option key={supplier.id} value={supplier.id}>{supplier.name} {supplier.vat_number ? `(${supplier.vat_number})` : ""}</option>)}
            </select>
          </label>
          {!busy && !suppliers.length && <p className="text-sm text-amber-700">Nessun fornitore disponibile. Aggiungi il fornitore in Fatture in Cloud e riapri questa finestra.</p>}
          <div className="grid gap-4 sm:grid-cols-2">
            <label className="block text-sm">Deducibilita costo (%)<input required type="number" min="0" max="100" step="0.01" className={input} value={tax} onChange={(event) => setTax(event.target.value)} /></label>
            <label className="block text-sm">Detraibilita IVA (%)<input required type="number" min="0" max="100" step="0.01" className={input} value={vat} onChange={(event) => setVat(event.target.value)} /></label>
          </div>
          <label className="block text-sm">Scadenza pagamento<input required type="date" className={input} value={dueDate} onChange={(event) => setDueDate(event.target.value)} /></label>
          <p className="text-sm text-slate-600">Stato iniziale: non pagato. Reverse charge e TD17/TD18 da gestire separatamente.</p>
          <div className="flex justify-end"><button disabled={busy || !suppliers.length} className="rounded-md bg-ink px-4 py-2 text-sm text-white disabled:opacity-40" type="submit">{busy ? "Verifica..." : "Verifica e mostra anteprima"}</button></div>
        </form>}
      </div>
    </dialog>
  );
}
