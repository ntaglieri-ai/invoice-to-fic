"use client";

import { Check, CheckCheck, Clock3, Files, ExternalLink, Pencil } from "lucide-react";
import Image from "next/image";
import { useState } from "react";
import { displayInvoiceDate, invoiceAmount, type WorkflowInvoice } from "@/lib/invoice-workflow";
import { invoiceErrors } from "@/lib/expense-validation";
import { invoiceTaxReview } from "@/lib/invoice-tax-review";

const supplierDomains: Record<string, string> = { OpenAI: "openai.com", Anthropic: "anthropic.com", Vercel: "vercel.com", Hetzner: "hetzner.com", Supabase: "supabase.com" };
function SupplierMark({ supplier }: { supplier: string }) {
  const [failed, setFailed] = useState(false);
  return <span className={`supplier-monogram supplier-${supplier.toLowerCase()}`} aria-hidden="true">{supplierDomains[supplier] && !failed ? <Image unoptimized src={`https://www.google.com/s2/favicons?domain=${supplierDomains[supplier]}&sz=64`} width={18} height={18} alt="" onError={() => setFailed(true)}/> : supplier.slice(0, 1)}</span>;
}

export function InvoiceRegister({ invoices, onOpen, onCheck, onExpense, onTd17, canWrite, canTd17, pending, ready, onAcquire }: {
  invoices: WorkflowInvoice[]; onOpen: (id: string) => void; onCheck: (id: string) => void; onExpense: (id: string) => void; onTd17: (id: string) => void; canWrite: boolean; canTd17: boolean; pending: boolean; ready: boolean; onAcquire: () => void;
}) {
  return <div className="register-surface"><table className="invoice-register"><colgroup><col className="col-supplier"/><col className="col-number"/><col className="col-date"/><col className="col-amount"/><col className="col-expense"/><col className="col-td17"/><col className="col-action"/></colgroup>
    <thead><tr><th>Fornitore</th><th>Fattura</th><th>Data</th><th className="text-right">Importo</th><th>Spesa FIC</th><th>TD17</th><th>Prossimo passo</th></tr></thead>
    <tbody>{invoices.map((item) => <tr key={item.id}>
      <td><span className="register-supplier"><SupplierMark supplier={item.invoice.supplier}/><strong>{item.invoice.supplier}</strong></span></td>
      <td><button className="register-link" onClick={() => onOpen(item.id)}>{item.invoice.invoice_number || "Numero da verificare"}</button><small>{item.status === "duplicate" ? "Duplicato" : item.status === "needs_review" ? "Da verificare" : item.driveId ? "PDF su Drive" : item.id.startsWith("fic-") ? "Recuperata da FIC" : "Documento acquisito"}</small></td>
      <td>{displayInvoiceDate(item.invoice.invoice_date)}</td><td className="register-amount">{invoiceAmount(item)}</td>
      <td>{item.ficId ? <><span className="sf-badge badge-green"><Check size={12}/>Registrata</span><small className="register-reference">#{item.ficId}</small></> : <span className="sf-badge badge-neutral">Da registrare</span>}</td>
      <td>{item.td17 ? <><span className={`sf-badge ${item.td17.state === "sent" ? "badge-aqua" : "badge-amber"}`} data-delivery={item.td17.state === "sent" ? "sent" : "not_sent"} title={item.td17.eiStatus ? `Stato FIC: ${item.td17.eiStatus}` : undefined}>{item.td17.state === "sent" ? <CheckCheck size={12}/> : <Clock3 size={12}/>} {item.td17.state === "sent" ? "Inviato" : "Creato · non inviato"}</span><small className="register-reference">#{item.td17.id}</small></> : <span className={`sf-badge ${invoiceTaxReview(item.invoice) ? "badge-amber" : "badge-neutral"}`}>{invoiceTaxReview(item.invoice) ? "IVA · da verificare" : "Da preparare"}</span>}</td>
      <td><div className="register-action-stack">
        {item.checked_at || item.status === "approved" ? <span className="sf-badge badge-aqua"><Check size={12}/>Controllata</span> : <button className="register-link" disabled={pending || !ready || item.status === "duplicate"} onClick={() => onCheck(item.id)}><Check size={14}/>Fattura controllata</button>}
        <button className="register-link" onClick={() => onOpen(item.id)}><Pencil size={14}/>{item.ficId || item.td17 ? "Dettaglio fattura" : "Modifica fattura"}</button>
        {!item.ficId && !item.td17 && <button className="register-link" disabled={pending || !canWrite || item.status !== "approved" || Boolean(invoiceErrors(item.invoice).length) || item.invoice.currency !== "EUR"} onClick={() => onExpense(item.id)}>Registra spesa</button>}
        {!item.td17 && <button className="register-link" disabled={pending || !canTd17 || !item.ficId || item.status !== "approved" || Boolean(invoiceErrors(item.invoice).length) || item.invoice.currency !== "EUR"} onClick={() => onTd17(item.id)}>Prepara TD17</button>}
        {!item.td17 && <small>{invoiceTaxReview(item.invoice) ? "Trattamento IVA da chiarire" : item.invoice.currency !== "EUR" ? "Valuta non EUR: gestione da verificare" : item.status !== "approved" ? "Prima conferma i dati della fattura" : !item.ficId ? "Prima spesa, poi TD17" : "Spesa pronta: crea TD17"}</small>}
        {item.td17 && <button className="register-link" onClick={() => onOpen(item.id)}><ExternalLink size={14}/>Vedi TD17 e stato FIC</button>}
      </div></td>
    </tr>)}</tbody>
  </table>{!invoices.length && <div className="register-empty"><span className="empty-symbol"><Files size={28}/></span><h2>{ready ? "Nessuna fattura in questa vista" : "Caricamento fatture"}</h2>{ready && <button className="sf-button" onClick={onAcquire}>Acquisisci fatture</button>}</div>}</div>;
}
