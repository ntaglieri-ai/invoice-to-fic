"use client";

import { Ban, Check, CheckCheck, Clock3, Files, ExternalLink, Pencil } from "lucide-react";
import Image from "next/image";
import { useState } from "react";
import { displayInvoiceDate, invoiceAmount, pendingTd17Label, type WorkflowInvoice } from "@/lib/invoice-workflow";
import { invoiceErrors } from "@/lib/expense-validation";
import { invoiceTaxReview } from "@/lib/invoice-tax-review";

const supplierDomains: Record<string, string> = { OpenAI: "openai.com", Anthropic: "anthropic.com", Vercel: "vercel.com", Hetzner: "hetzner.com", Supabase: "supabase.com" };
function SupplierMark({ supplier }: { supplier: string }) {
  const [failed, setFailed] = useState(false);
  return <span className={`supplier-monogram supplier-${supplier.toLowerCase()}`} aria-hidden="true">{supplierDomains[supplier] && !failed ? <Image unoptimized src={`https://www.google.com/s2/favicons?domain=${supplierDomains[supplier]}&sz=64`} width={18} height={18} alt="" onError={() => setFailed(true)}/> : supplier.slice(0, 1)}</span>;
}

export function InvoiceRegister({ invoices, onOpen, onCheck, onExpense, onTd17, onNotApplicable, canWrite, canTd17, pending, ready, onAcquire }: {
  invoices: WorkflowInvoice[]; onOpen: (id: string) => void; onCheck: (id: string) => void; onExpense: (id: string) => void; onTd17: (id: string) => void; onNotApplicable: (id: string) => void; canWrite: boolean; canTd17: boolean; pending: boolean; ready: boolean; onAcquire: () => void;
}) {
  return <div className="register-surface"><table className="invoice-register"><colgroup><col className="col-supplier"/><col className="col-number"/><col className="col-date"/><col className="col-amount"/><col className="col-expense"/><col className="col-td17"/><col className="col-action"/></colgroup>
    <thead><tr><th>Fornitore</th><th>Fattura</th><th>Data</th><th className="text-right">Importo</th><th>Spesa FIC</th><th>TD17</th><th>Prossimo passo</th></tr></thead>
    <tbody>{invoices.map((item) => <tr key={item.id}>
      <td><span className="register-supplier"><SupplierMark supplier={item.invoice.supplier}/><strong>{item.invoice.supplier}</strong></span></td>
      <td><button className="register-link" onClick={() => onOpen(item.id)}>{item.invoice.invoice_number || "Numero da verificare"}</button><small>{item.status === "duplicate" ? "Duplicato" : item.checked_at ? "Dati controllati" : item.status === "needs_review" ? "Da controllare" : item.driveId ? "PDF su Drive" : item.id.startsWith("fic-") ? "Recuperata da FIC" : "Documento acquisito"}</small></td>
      <td>{displayInvoiceDate(item.invoice.invoice_date)}</td><td className="register-amount">{invoiceAmount(item)}</td>
      <td>{item.ficId ? <><span className="sf-badge badge-green"><Check size={12}/>{item.expensePaymentState === "reversed" ? "Stornata" : item.expensePaymentState === "paid" ? "Pagata" : item.expensePaymentState === "mixed" ? "Saldo chiuso" : "Registrata"}</span><small className="register-reference">#{item.ficId}</small></> : <span className="sf-badge badge-neutral">{item.not_applicable ? "Esclusa" : "Da registrare"}</span>}</td>
      <td>{item.td17 ? <><span className={`sf-badge ${item.td17.state === "sent" ? "badge-aqua" : "badge-amber"}`} data-delivery={item.td17.state === "sent" ? "sent" : "not_sent"} title={item.td17.eiStatus ? `Stato FIC: ${item.td17.eiStatus}` : undefined}>{item.td17.state === "sent" ? <CheckCheck size={12}/> : <Clock3 size={12}/>} {item.td17.state === "sent" ? "Inviato" : "Creato · non inviato"}</span><small className="register-reference">#{item.td17.id}</small></> : <span title={invoiceTaxReview(item.invoice) && item.checked_at ? "Dati confermati; registrazione e trattamento fiscale da gestire separatamente. Nessun TD17 automatico." : undefined} className={`sf-badge ${!item.not_applicable && (invoiceTaxReview(item.invoice) || item.ficId) ? "badge-amber" : "badge-neutral"}`}>{pendingTd17Label(item)}</span>}</td>
      <td><div className="register-action-stack">
        <button className={`row-pill ${item.checked_at || item.status === "approved" ? "row-checked" : ""}`} disabled={pending || !ready || item.status === "duplicate" || Boolean(item.checked_at) || item.status === "approved"} onClick={() => onCheck(item.id)}><Check size={13}/>{item.checked_at || item.status === "approved" ? "Controllata" : "Controlla"}</button>
        <button className="sf-icon row-edit" title="Modifica fattura" aria-label={`Modifica fattura ${item.invoice.invoice_number}`} onClick={() => onOpen(item.id)}><Pencil size={13}/></button>
        <button className={`row-pill ${item.ficId ? "row-checked" : ""}`} title={item.ficId ? `Spesa FIC #${item.ficId}` : "Registra spesa"} disabled={item.not_applicable || (!item.ficId && (pending || !canWrite || item.status !== "approved" || Boolean(invoiceErrors(item.invoice).length)))} onClick={() => item.ficId ? onOpen(item.id) : onExpense(item.id)}>{item.ficId && <Check size={12}/>}Spesa</button>
        <button className={`row-pill ${item.td17 ? "row-checked" : ""}`} title={item.td17 ? `TD17 FIC #${item.td17.id}` : "Prepara TD17 dopo la spesa"} disabled={item.not_applicable || (!item.td17 && (pending || !canTd17 || !item.ficId || item.status !== "approved" || Boolean(invoiceErrors(item.invoice).length)))} onClick={() => item.td17 ? onOpen(item.id) : onTd17(item.id)}>{item.td17 && <ExternalLink size={12}/>}TD17</button>
        <button className={`row-pill ${item.not_applicable ? "row-excluded" : ""}`} aria-pressed={Boolean(item.not_applicable)} title={item.ficId || item.td17 ? "Documento gia presente in FIC" : item.not_applicable ? "Riattiva il flusso spesa e TD17" : "Escludi da conversione, spese e TD17"} disabled={pending || !ready || Boolean(item.ficId || item.td17)} onClick={() => onNotApplicable(item.id)}><Ban size={12}/>N/A</button>
      </div></td>
    </tr>)}</tbody>
  </table>{!invoices.length && <div className="register-empty"><span className="empty-symbol"><Files size={28}/></span><h2>{ready ? "Nessuna fattura in questa vista" : "Caricamento fatture"}</h2>{ready && <button className="sf-button" onClick={onAcquire}>Acquisisci fatture</button>}</div>}</div>;
}
