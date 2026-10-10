"use client";

import { Check, CheckCircle2, Cloud, Copy, ExternalLink, FileText, RotateCcw, Trash2 } from "lucide-react";
import { useState } from "react";
import { AppDrawer } from "@/components/app-drawer";
import { displayInvoiceDate, invoiceAmount, nextInvoiceAction, type WorkflowInvoice } from "@/lib/invoice-workflow";
import type { InvoiceFields } from "@/lib/types";
import { invoiceTaxReview } from "@/lib/invoice-tax-review";

const suppliers = ["OpenAI", "Anthropic", "Vercel", "Hetzner", "Supabase", "Sconosciuto"];
export function InvoiceDetail({ item, canWrite, canTd17, pending, error, onClose, onApprove, onExpense, onTd17, onChange, onRemove, onReset, onRefresh }: {
  item: WorkflowInvoice; canWrite: boolean; canTd17: boolean; pending: boolean; error?: string;
  onClose: () => void; onApprove: () => void; onExpense: () => void; onTd17: () => void;
  onChange: (field: keyof InvoiceFields, value: string) => void; onRemove: () => void; onReset: () => void; onRefresh: () => void;
}) {
  const [copyNotice, setCopyNotice] = useState("");
  const locked = Boolean(item.ficId || item.td17);
  const taxReview = invoiceTaxReview(item.invoice);
  const action = nextInvoiceAction(item);
  const canAct = action === "review" ? !pending && item.status !== "duplicate" : action === "expense" ? canWrite && item.invoice.currency === "EUR" : action === "td17" ? canTd17 && Boolean(item.ficId) && item.invoice.currency === "EUR" && item.invoice.tax_amount === 0 : true;
  const steps = [
    { label: "Documento acquisito", done: true, detail: item.driveId ? "PDF archiviato su Drive" : item.id.startsWith("fic-") ? "Dati recuperati da Fatture in Cloud" : item.file_name },
    { label: "Spesa registrata", done: Boolean(item.ficId), detail: item.ficId ? `FIC #${item.ficId}` : "Da registrare in Fatture in Cloud" },
    { label: "TD17 creato", done: Boolean(item.td17), detail: item.td17 ? `FIC #${item.td17.id}` : "Da preparare" },
    { label: "Inviato allo SDI", done: item.td17?.state === "sent", detail: item.td17?.state === "sent" ? "Invio rilevato in FIC" : "Conferma finale in Fatture in Cloud" },
  ];
  const primary = action === "fic" ? <a className="sf-button sf-primary" href="https://secure.fattureincloud.it/" target="_blank" rel="noopener noreferrer"><ExternalLink size={16}/>{item.td17?.state === "sent" ? "Vedi in FIC" : "Apri in FIC"}</a> : <button className="sf-button sf-primary" disabled={!canAct} onClick={action === "review" ? onApprove : action === "expense" ? onExpense : onTd17}>{action === "review" ? <CheckCircle2 size={16}/> : action === "expense" ? <Cloud size={16}/> : <FileText size={16}/>}{{ review: "Approva dati", expense: "Registra spesa", td17: "Prepara TD17" }[action]}</button>;
  return <AppDrawer title="Dettaglio fattura" onClose={onClose} footer={<>{pending && <span className="text-xs text-amber-800">Salvataggio in corso...</span>}{primary}</>}>
    <div className="invoice-identity"><div><span className="detail-supplier">{item.invoice.supplier}</span><h3>{item.invoice.invoice_number || "Numero da verificare"}</h3><small>{displayInvoiceDate(item.invoice.invoice_date)}</small></div><strong>{invoiceAmount(item)}</strong></div>
    {error && <p role="alert" className="sf-alert alert-error">{error}</p>}
    {taxReview && <p className="sf-alert alert-warning"><strong>IVA addebitata · Da verificare</strong><br/>{taxReview}</p>}
    {item.status === "duplicate" && <p className="sf-alert alert-warning">Fattura duplicata. Verifica prima di procedere.</p>}
    {item.warnings.length > 0 && <ul className="detail-warnings">{item.warnings.map((warning, index) => <li key={index}>{warning}</li>)}</ul>}
    <ol className="invoice-steps">{steps.map((step, index) => <li key={step.label}><span className={`step-mark ${step.done ? "step-done" : steps[index - 1]?.done ? "step-current" : ""}`}>{step.done ? <Check size={14}/> : index + 1}</span><div><strong>{step.label}</strong><small>{step.detail}</small></div></li>)}</ol>
    <section className="detail-section"><h3>Dati fattura</h3><div className="detail-fields">
      <label>Fornitore<select disabled={locked} value={item.invoice.supplier} onChange={(e) => onChange("supplier", e.target.value)}>{suppliers.map((supplier) => <option key={supplier}>{supplier}</option>)}</select></label>
      <label>Numero fattura<input disabled={locked} value={item.invoice.invoice_number} onChange={(e) => onChange("invoice_number", e.target.value)}/></label>
      <label>Data fattura<input type="date" disabled={locked} value={item.invoice.invoice_date} onChange={(e) => onChange("invoice_date", e.target.value)}/></label>
      <label>Valuta<input disabled={locked} maxLength={3} value={item.invoice.currency} onChange={(e) => onChange("currency", e.target.value.toUpperCase())}/></label>
      {([ ["net_amount", "Imponibile"], ["tax_amount", "IVA origine"], ["total_amount", "Totale"] ] as const).map(([field, label]) => <label key={field}>{label}<input inputMode="decimal" disabled={locked} value={item.invoice[field] ?? ""} onChange={(e) => onChange(field, e.target.value)}/></label>)}
      <label>VAT fornitore<input disabled={locked} value={item.invoice.supplier_vat} onChange={(e) => onChange("supplier_vat", e.target.value.toUpperCase())}/></label>
      {item.invoice.supplier === "Anthropic" && <label>Partita IVA cliente<input disabled={locked} value={item.invoice.customer_vat ?? ""} onChange={(e) => onChange("customer_vat", e.target.value.toUpperCase())}/></label>}
    </div></section>
    <section className="detail-section"><h3>Documenti e riferimenti</h3><div className="detail-documents">
      {item.driveId ? <a className="sf-button" href={`https://drive.google.com/file/d/${encodeURIComponent(item.driveId)}/view`} target="_blank" rel="noopener noreferrer"><FileText size={16}/>PDF su Drive<ExternalLink size={14}/></a> : <span className="text-sm text-slate-500">PDF non collegato a Drive</span>}
      {([ ["Spesa", item.ficId], ["TD17", item.td17?.id] ] as const).map(([label, id]) => id ? <button key={label} className={`sf-reference ${label === "TD17" ? item.td17?.state === "sent" ? "reference-aqua" : "reference-amber" : ""}`} title="Copia riferimento FIC" aria-label={`${label} FIC #${id}`} onClick={async () => { try { await navigator.clipboard.writeText(String(id)); setCopyNotice("Riferimento copiato"); } catch { setCopyNotice("Copia non disponibile"); } }}><span><small>{label} FIC</small><strong>#{id}</strong></span><Copy size={14}/></button> : null)}
    </div>{copyNotice && <p role="status" className="text-xs text-slate-500 mt-2">{copyNotice}</p>}
      {item.td17 && <button className="sf-text-button mt-3" disabled={pending} onClick={onRefresh}><RotateCcw size={14}/>Aggiorna stato FIC</button>}
    </section>
    <details className="detail-other"><summary>Altre azioni</summary><div><button className="sf-text-button" disabled={pending || !locked} onClick={onReset}><RotateCcw size={15}/>Reset riferimenti FIC</button><button className="sf-text-button sf-danger" disabled={pending} onClick={onRemove}><Trash2 size={15}/>Rimuovi dal registro</button></div></details>
    {!canAct && action !== "fic" && !pending && <p className="sf-alert alert-warning">{action === "td17" && !item.ficId ? "Registra prima la spesa." : item.invoice.currency !== "EUR" ? "Registrazione disponibile per fatture EUR." : action === "td17" && item.invoice.tax_amount !== 0 ? "IVA origine da verificare prima del TD17." : "Verifica i dati e le autorizzazioni nelle impostazioni."}</p>}
  </AppDrawer>;
}
