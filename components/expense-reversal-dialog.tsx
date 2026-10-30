"use client";
import { useEffect, useState } from "react";
import { CheckCheck } from "lucide-react";
import { AppDrawer } from "./app-drawer";
import type { ExpensePaymentState } from "@/lib/expense-payment-state";
type Plan = { companyName: string; ticket: string; skipped: number; documents: { id: number; invoice_number: string; date: string; supplier?: string; amount: number; currency?: string }[] };
type Result = { id: number; paymentState: ExpensePaymentState };
async function request(body: unknown) {
  const response = await fetch("/api/fatture-in-cloud/expense-payments", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || "Operazione FIC non riuscita.");
  return data;
}
export function ExpenseReversalDialog({ companyId, ids, onClose, onUpdated }: { companyId: number; ids: number[]; onClose: () => void; onUpdated: (results: Result[]) => void }) {
  const [plan, setPlan] = useState<Plan | null>(null);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState("");
  const [done, setDone] = useState<Result[]>([]);
  useEffect(() => {
    let cancelled = false;
    async function load() {
      try { const result = await request({ action: "preview", companyId, expenseIds: ids, month: "2026-09" }); if (!cancelled) setPlan(result); }
      catch (e) { if (!cancelled) setError(e instanceof Error ? e.message : "Controllo FIC non riuscito."); }
      finally { if (!cancelled) setBusy(false); }
    }
    void load(); return () => { cancelled = true; };
  }, [companyId, ids]);
  async function confirm() {
    if (!plan || busy) return;
    setBusy(true); setError("");
    const results: Result[] = [];
    try {
      for (const doc of plan.documents.filter((doc) => !done.some((item) => item.id === doc.id))) {
        const result = await request({ action: "reverse", confirmed: true, ticket: plan.ticket, id: doc.id });
        if (result.id !== doc.id || !["paid", "reversed", "mixed"].includes(result.paymentState)) throw new Error("Esito FIC non confermato. Controlla prima di riprovare.");
        results.push(result); setDone((current) => [...current, result]);
      }
    } catch (e) { setError(e instanceof Error ? e.message : "Operazione interrotta."); }
    finally { if (results.length) onUpdated(results); setBusy(false); }
  }
  const remaining = plan ? plan.documents.length - done.length : 0;
  return <AppDrawer title="Storna scadenze spese · settembre 2026" busy={busy} onClose={onClose} footer={<button className="sf-button sf-primary" disabled={busy || !remaining} onClick={() => void confirm()}><CheckCheck size={16}/>{busy ? "Operazione in corso..." : `Conferma Stornato e salva ${remaining} spese su FIC`}</button>}>
    {busy && !plan && <p role="status" className="sf-notice">Controllo scadenze su FIC...</p>}
    {plan && <><div className="invoice-identity"><h3>{plan.companyName}</h3><strong>{plan.documents.length} spese da aggiornare</strong></div><p className="sf-alert alert-warning">Operazione reale su FIC: le rate da pagare diventano Stornato, come Conferma → Stornato → Salva. Nessuna nuova spesa o nota di credito; importi, scadenze e TD17 restano invariati.</p>
      <p className="sf-notice">N/A escluse. {plan.skipped} spese gia senza debiti da aggiornare. Nessun conto di pagamento richiesto.</p>
      <ul className="divide-y">{plan.documents.map((doc) => <li key={doc.id} className="flex items-center justify-between gap-3 py-3 text-sm"><span><strong>{doc.supplier} · {doc.invoice_number}</strong><br/>{doc.date} · {doc.amount.toFixed(2)} {doc.currency}</span><span className={`sf-badge ${done.some((item) => item.id === doc.id) ? "badge-aqua" : "badge-amber"}`}>{done.some((item) => item.id === doc.id) ? "Verificata su FIC" : "Da stornare"}</span></li>)}</ul>
      {done.length > 0 && <p role="status" className="sf-notice">{done.length} di {plan.documents.length} spese confermate su FIC.</p>}
      {!plan.documents.length && <p className="sf-notice">Nessuna rata da stornare: queste spese sono gia pagate o stornate in FIC.</p>}
    </>}
    {error && <p role="alert" className="sf-alert alert-error">{error}</p>}
  </AppDrawer>;
}
