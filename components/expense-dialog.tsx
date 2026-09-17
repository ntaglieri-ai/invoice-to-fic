"use client";

import { useEffect, useRef, useState } from "react";
import { CheckCircle2, Save, Send, Settings2, X } from "lucide-react";
import type { InvoiceFields } from "@/lib/types";
import { EXPENSE_COST_CENTER, hasExpenseTaxSettings, type ExpensePreview, type FicSupplier, type PreparedExpense } from "@/lib/expense-validation";
import { expensePreferencesKey, matchExpenseSupplier, parseExpensePreferences, suggestedSaasPreferences, suggestedForeignDocument, type ExpenseTaxPreferences } from "@/lib/expense-preferences";

async function expenseRequest(body: unknown) {
  const response = await fetch("/api/fatture-in-cloud/expenses", {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error ?? "Operazione non riuscita.");
  return result;
}

export function ExpenseDialog({ invoice, companyId, initialDraft, onClose, onPrepared, onCreated }: {
  invoice: InvoiceFields;
  companyId: number;
  initialDraft?: PreparedExpense;
  onClose: () => void;
  onPrepared: (draft: PreparedExpense) => void;
  onCreated: (id: number) => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const submitting = useRef(false);
  const [suppliers, setSuppliers] = useState<FicSupplier[]>([]);
  const [supplierId, setSupplierId] = useState("");
  const [preferences, setPreferences] = useState<ExpenseTaxPreferences | null>(null);
  const [settingsNotice, setSettingsNotice] = useState("");
  const [suggested, setSuggested] = useState(false);
  const [tax, setTax] = useState("");
  const [vat, setVat] = useState("");
  const [dueDate, setDueDate] = useState(initialDraft?.options.dueDate ?? invoice.invoice_date);
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
      if (cancelled) return;
      const list = payload.suppliers as FicSupplier[];
      setSuppliers(list);
      const previous = list.find((supplier) => supplier.id === initialDraft?.options.supplierId);
      const matched = previous ?? matchExpenseSupplier(list, invoice.supplier_vat);
      if (matched) {
        setSupplierId(String(matched.id));
        let stored: ExpenseTaxPreferences | null = null;
        try { stored = parseExpensePreferences(localStorage.getItem(expensePreferencesKey(companyId, matched.id))); } catch { /* Browser storage is optional. */ }
        const draftOptions = initialDraft?.options;
        const values = stored ?? (draftOptions ? (hasExpenseTaxSettings(draftOptions) ? { taxDeductibility: draftOptions.taxDeductibility, vatDeductibility: draftOptions.vatDeductibility } : null) : suggestedSaasPreferences(invoice));
        setSuggested(!stored && !draftOptions && Boolean(values));
        setPreferences(values);
        setTax(values ? String(values.taxDeductibility) : "");
        setVat(values ? String(values.vatDeductibility) : "");
      }
    }).catch((error) => { if (!cancelled) setError(error.message); })
      .finally(() => { if (!cancelled) setBusy(false); });
    return () => { cancelled = true; };
  }, [companyId, invoice, initialDraft]);

  function selectSupplier(id: string) {
    setSupplierId(id);
    let stored: ExpenseTaxPreferences | null = null;
    try { stored = parseExpensePreferences(localStorage.getItem(expensePreferencesKey(companyId, Number(id)))); } catch { /* Keep preparation available without browser storage. */ }
    const values = stored ?? (id ? suggestedSaasPreferences(invoice) : null);
    setSuggested(!stored && Boolean(values));
    setPreferences(values);
    setTax(values ? String(values.taxDeductibility) : "");
    setVat(values ? String(values.vatDeductibility) : "");
    setSettingsNotice("");
    setError("");
  }

  function savePreferences() {
    const values = parseExpensePreferences(JSON.stringify({ version: 1, taxDeductibility: tax.trim() ? Number(tax) : null, vatDeductibility: vat.trim() ? Number(vat) : null }));
    if (!supplierId || !values) { setError("Per salvare le impostazioni servono entrambe le percentuali, tra 0 e 100. Puoi comunque preparare la bozza senza compilarle."); return; }
    setPreferences(values);
    setSuggested(false);
    setError("");
    try {
      localStorage.setItem(expensePreferencesKey(companyId, Number(supplierId)), JSON.stringify({ version: 1, ...values }));
      setSettingsNotice("Impostazioni salvate in questo browser per il fornitore e l'azienda selezionati.");
    } catch { setSettingsNotice("Impostazioni disponibili solo per questa sessione: il browser non consente il salvataggio."); }
  }

  function clearPreferences() {
    try { localStorage.removeItem(expensePreferencesKey(companyId, Number(supplierId))); }
    catch { setError("Impossibile rimuovere le impostazioni salvate dal browser."); return; }
    setPreferences(null);
    setSuggested(false);
    setTax("");
    setVat("");
    setSettingsNotice("Dati fiscali da confermare.");
  }

  async function prepare() {
    setBusy(true);
    setError("");
    try {
      const payload = await expenseRequest({
        action: "preview", companyId, invoice, approved: true,
        options: { supplierId: Number(supplierId), taxDeductibility: tax.trim() ? Number(tax) : null, vatDeductibility: vat.trim() ? Number(vat) : null, dueDate },
      });
      setPreview(payload);
      setConfirmed(false);
    } catch (error) { setError(error instanceof Error ? error.message : "Anteprima non disponibile."); }
    finally { setBusy(false); }
  }

  async function create() {
    if (!preview?.ticket || preview.status !== "ready" || !confirmed || submitting.current) return;
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

  function keepDraft() {
    if (!preview) return;
    onPrepared({ companyId, options: preview.options, status: preview.status });
    onClose();
  }

  const pending = preview?.status === "needs_configuration";
  const input = "mt-1 h-10 w-full rounded-md border border-line bg-white px-3 text-sm";
  return (
    <dialog ref={dialog} aria-labelledby="expense-title" className="m-auto max-h-[90dvh] w-[min(680px,calc(100%-32px))] overflow-y-auto rounded-lg border border-line p-0 text-ink shadow-xl backdrop:bg-black/40"
      onCancel={(event) => { event.preventDefault(); if (!busy) onClose(); }}>
      <header className="flex items-center justify-between border-b border-line p-5">
        <h2 id="expense-title" className="text-lg font-semibold">{result ? "Spesa registrata" : pending ? "Spesa preparata" : preview ? "Conferma spesa" : "Prepara spesa"}</h2>
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
          {pending && <p role="status" className="border-l-2 border-amber-400 pl-3 text-sm text-amber-800">Dati fiscali da confermare. Bozza verificata, non registrata in Fatture in Cloud.</p>}
          <dl className="grid grid-cols-[auto,minmax(0,1fr)] gap-x-5 gap-y-2 text-sm [&_dd]:break-words">
            <dt>Azienda</dt><dd className="font-medium">{preview.companyName}</dd>
            <dt>Centro di costo</dt><dd>{EXPENSE_COST_CENTER}</dd>
            <dt>Fornitore FIC</dt><dd>{preview.supplier.name} · {preview.supplier.vat_number || "VAT non presente"}</dd>
            <dt>Data</dt><dd>{invoice.invoice_date.split("-").reverse().join("/")}</dd>
            <dt>Imponibile / IVA</dt><dd>{invoice.net_amount?.toFixed(2)} / {invoice.tax_amount?.toFixed(2)} EUR</dd>
            <dt>Totale</dt><dd className="font-semibold">{invoice.total_amount?.toFixed(2)} EUR</dd>
            <dt>Deducibilita costo</dt><dd>{preview.options.taxDeductibility === null ? "Da confermare" : `${preview.options.taxDeductibility}%`}</dd>
            <dt>Detraibilita IVA</dt><dd>{preview.options.vatDeductibility === null ? "Da confermare" : `${preview.options.vatDeductibility}%`}</dd>
            <dt>Pagamento</dt><dd>Non pagato · scadenza {preview.options.dueDate.split("-").reverse().join("/")}</dd>
            <dt>Documento estero</dt><dd>{suggestedForeignDocument(invoice) ? "TD17 proposto, da preparare separatamente" : "Da verificare"}</dd>
            <dt>Invio SDI</dt><dd>Non effettuato</dd>
            <dt>Allegato PDF</dt><dd>Non trasferito</dd>
          </dl>
          {!pending && <label className="flex items-start gap-3 border-t border-line pt-4 text-sm">
            <input type="checkbox" className="mt-1 size-4" checked={confirmed} disabled={busy || uncertain} onChange={(event) => setConfirmed(event.target.checked)} />
            <span>Confermo i dati e la registrazione della spesa nell&apos;azienda {preview.companyName}.</span>
          </label>}
          <div className="flex flex-wrap justify-end gap-3">
            <button type="button" disabled={busy || uncertain} onClick={() => setPreview(null)} className="rounded-md border border-line px-4 py-2 text-sm disabled:opacity-40">Modifica</button>
            <button type="button" disabled={busy || uncertain} onClick={keepDraft} className={`inline-flex items-center gap-2 rounded-md px-4 py-2 text-sm disabled:opacity-40 ${pending ? "bg-ink text-white" : "border border-line"}`}><Save size={16} />Conserva bozza</button>
            {!pending && <button type="button" disabled={!confirmed || busy || uncertain} onClick={create} className="inline-flex items-center gap-2 rounded-md bg-ink px-4 py-2 text-sm text-white disabled:opacity-40"><Send size={16} />{busy ? "Registrazione..." : "Conferma e crea spesa"}</button>}
          </div>
          <p className="text-xs text-slate-500">La bozza resta disponibile in questa pagina fino alla chiusura o al ricaricamento.</p>
        </div> : <div className="space-y-4">
          <label className="block text-sm">Fornitore in Fatture in Cloud
            <select disabled={busy} className={input} value={supplierId} onChange={(event) => selectSupplier(event.target.value)}>
              <option value="">Seleziona fornitore</option>
              {suppliers.map((supplier) => <option key={supplier.id} value={supplier.id}>{supplier.name} {supplier.vat_number ? `(${supplier.vat_number})` : ""}</option>)}
            </select>
          </label>
          {!busy && !suppliers.length && <p className="text-sm text-amber-700">Nessun fornitore disponibile. Aggiungi il fornitore in Fatture in Cloud e riapri questa finestra.</p>}
          <label className="block text-sm">Scadenza pagamento (da confermare)<input type="date" className={input} value={dueDate} onChange={(event) => setDueDate(event.target.value)} /></label>
          <div className="space-y-1 border-y border-line py-3 text-sm">
            <p className={preferences ? "text-emerald-700" : "text-amber-700"}>{preferences ? `${suggested ? "Profilo SaaS proposto" : "Impostazioni fornitore"}: costo ${preferences.taxDeductibility}% · IVA ${preferences.vatDeductibility}%` : "Dati fiscali da confermare"}</p>
            {suggestedForeignDocument(invoice) && <p className="text-slate-600">TD17 proposto · preparazione e invio non ancora disponibili.</p>}
          </div>
          <details className="text-sm">
            <summary className="cursor-pointer py-2"><span className="inline-flex items-center gap-2"><Settings2 size={16} />Impostazioni fiscali del fornitore</span></summary>
            <div className="space-y-3 py-3">
              <div className="grid gap-4 sm:grid-cols-2">
                <label className="block">Deducibilita costo (%)<input type="number" min="0" max="100" step="0.01" className={input} value={tax} onChange={(event) => setTax(event.target.value)} /></label>
                <label className="block">Detraibilita IVA (%)<input type="number" min="0" max="100" step="0.01" className={input} value={vat} onChange={(event) => setVat(event.target.value)} /></label>
              </div>
              <div className="flex flex-wrap gap-3">
                <button type="button" disabled={busy || !supplierId} onClick={savePreferences} className="inline-flex items-center gap-2 rounded-md border border-line px-3 py-2 disabled:opacity-40"><Save size={16} />Salva impostazioni</button>
                {preferences && <button type="button" disabled={busy} onClick={clearPreferences} className="rounded-md border border-line px-3 py-2">Rimuovi impostazioni</button>}
              </div>
              {settingsNotice && <p role="status" className="text-xs text-slate-600">{settingsNotice}</p>}
            </div>
          </details>
          <p className="text-sm text-slate-600">Pagamento: non pagato. La scadenza non attesta l&apos;avvenuto addebito.</p>
          <div className="flex justify-end"><button disabled={busy || !supplierId} className="rounded-md bg-ink px-4 py-2 text-sm text-white disabled:opacity-40" type="button" onClick={prepare}>{busy ? "Verifica..." : "Controlla spesa"}</button></div>
        </div>}
      </div>
    </dialog>
  );
}
