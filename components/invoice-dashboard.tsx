"use client";

import { useEffect, useEffectEvent, useRef, useState } from "react";
import { AlertTriangle, ArrowLeft, ArrowRight, CheckCheck, ChevronLeft, ChevronRight, Files, Layers, Link2, LogOut, Plus, RotateCcw, Search, Settings2 } from "lucide-react";
import { ExpenseDialog } from "@/components/expense-dialog";
import { Td17Dialog } from "@/components/td17-dialog";
import { AcquisitionPanel } from "@/components/acquisition-panel";
import { AppDrawer } from "@/components/app-drawer";
import { InvoiceRegister } from "@/components/invoice-register";
import { InvoiceDetail } from "@/components/invoice-detail";
import { useInvoiceMemory } from "@/components/use-invoice-memory";
import { invoiceErrors, type PreparedExpense } from "@/lib/expense-validation";
import { canPrepareTd17, canWriteExpenses, ficConnectionNotice } from "@/lib/fic-permissions";
import { currencyTotals } from "@/lib/invoice-totals";
import { customerVatIssue } from "@/lib/customer-vat";
import { invoiceMonth } from "@/lib/invoice-history";
import { processingKey, td17DeliveryState, type ProcessingRecord } from "@/lib/processing-state";
import { matchesWorkflow, newestInvoicesFirst, workflowStage, type WorkflowFilter, type WorkflowInvoice } from "@/lib/invoice-workflow";
import type { ManagedInvoice } from "@/lib/invoice-memory";
import type { ArchivedInvoice } from "@/lib/google-invoices";
import type { InvoiceFields, InvoiceStatus, ParsedInvoice } from "@/lib/types";

type UiInvoice = WorkflowInvoice & { expenseDraft?: PreparedExpense };
type FicCompany = { id: number | null; name: string | null; type: string | null; vat_number?: string | null; controlled_companies?: FicCompany[] | null };
type FicStatus = { connected: boolean; config: { configured: boolean; missing: string[] }; companies: FicCompany[]; scope?: string; error?: string };
type Operation = { type: "expense" | "td17"; id: string; invoice: InvoiceFields; companyId: number; draft?: PreparedExpense };
type Verification = { key: string; expenseExists?: boolean; td17Exists?: boolean; expenseId?: number; td17Id?: number; td17EiStatus?: string };
const filterLabels: [WorkflowFilter, string][] = [["all", "Tutte"], ["work", "Da lavorare"], ["send", "TD17 da inviare"], ["done", "Completate"]];
function currentMonth() {
  const parts = new Intl.DateTimeFormat("en", { timeZone: "Europe/Rome", year: "numeric", month: "2-digit" }).formatToParts(new Date());
  return `${parts.find((part) => part.type === "year")!.value}-${parts.find((part) => part.type === "month")!.value}`;
}
function monthLabel(month: string) { return month === "all" ? "Tutti i mesi" : month === "undated" ? "Senza data" : new Intl.DateTimeFormat("it-IT", { month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(`${month}-01T12:00:00Z`)); }
function flatten(companies: FicCompany[]): FicCompany[] { return companies.flatMap((company) => [company, ...flatten(company.controlled_companies ?? [])]); }
async function post(path: string, body: unknown) {
  const response = await fetch(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || "Operazione non riuscita.");
  return result;
}

export function InvoiceDashboard() {
  const [month, setMonth] = useState(currentMonth);
  const [filter, setFilter] = useState<WorkflowFilter>("all");
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(8);
  const [fic, setFic] = useState<FicStatus | null>(null);
  const [googleConnected, setGoogleConnected] = useState(false);
  const [companyId, setCompanyId] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [drawer, setDrawer] = useState<"acquire" | "settings" | null>(null);
  const [operation, setOperation] = useState<Operation | null>(null);
  const [busy, setBusy] = useState(false);
  const [acquiring, setAcquiring] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [updated, setUpdated] = useState("");
  const [uploading, setUploading] = useState(false);
  const syncedRef = useRef("");
  const memory = useInvoiceMemory<UiInvoice>(companyId);
  const { invoices, setInvoices, ledger, setLedger } = memory;
  const companies = flatten(fic?.companies ?? []).filter((company) => company.id && company.type !== "accountant");
  const company = companies.find((company) => String(company.id) === companyId);
  const canWrite = Boolean(memory.ready && !memory.error && !memory.pending && fic?.connected && canWriteExpenses(fic.scope));
  const canTd17 = Boolean(memory.ready && !memory.error && !memory.pending && fic?.connected && canPrepareTd17(fic.scope));
  const enriched = (() => {
    const seen = new Set<string>();
    return invoices.map((item) => {
      const record = ledger[processingKey(companyId, item.invoice)];
      const issue = customerVatIssue(item.invoice, company?.vat_number);
      const identity = item.invoice.invoice_number ? processingKey(companyId, item.invoice) : "";
      const duplicate = Boolean(identity && seen.has(identity));
      if (identity) seen.add(identity);
      const warnings = item.warnings.filter((warning) => !warning.startsWith("Partita IVA cliente"));
      return { ...item, ficId: record?.expenseId, td17: record?.td17Id ? { companyId: Number(companyId), id: record.td17Id, state: record.td17State, eiStatus: record.td17EiStatus } : undefined,
        status: duplicate ? "duplicate" as InvoiceStatus : issue ? "needs_review" as InvoiceStatus : record?.expenseId || record?.td17Id ? "approved" as InvoiceStatus : item.status === "duplicate" ? invoiceErrors(item.invoice).length ? "needs_review" as InvoiceStatus : "extracted" as InvoiceStatus : item.status,
        warnings: issue ? [issue, ...warnings] : warnings };
    });
  })();
  const monthly = enriched.filter((item) => month === "all" || invoiceMonth(item) === month);
  const filtered = newestInvoicesFirst(monthly.filter((item) => matchesWorkflow(item, filter, query)));
  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const currentPage = Math.min(page, totalPages - 1);
  const visible = filtered.slice(currentPage * pageSize, (currentPage + 1) * pageSize);
  const selected = enriched.find((item) => item.id === selectedId);
  const months = [...new Set([currentMonth(), month, ...Array.from({ length: 24 }, (_, index) => { const now = new Date(); return new Date(Date.UTC(now.getFullYear(), now.getMonth() - index, 1)).toISOString().slice(0, 7); }), ...invoices.map(invoiceMonth)])].filter((value) => value !== "all").sort().reverse();
  const locked = busy || acquiring || uploading || Boolean(operation);

  async function refreshConnections() {
    try {
      const response = await fetch("/api/fatture-in-cloud/status", { cache: "no-store" });
      if (!response.ok) throw new Error("Connessione FIC non disponibile.");
      const result: FicStatus = await response.json();
      setFic(result);
      const available = flatten(result.companies).filter((item) => item.id && item.type !== "accountant");
      setCompanyId((current) => available.some((item) => String(item.id) === current) ? current : String(available[0]?.id ?? ""));
      const connectionNotice = ficConnectionNotice(new URLSearchParams(window.location.search).get("fic"), result.connected, result.scope);
      if (connectionNotice?.error) setError(connectionNotice.message);
    } catch (e) { setError(e instanceof Error ? e.message : "Connessione non disponibile."); }
    try { const response = await fetch("/api/google/invoices", { cache: "no-store" }); if (response.ok) setGoogleConnected((await response.json()).connected); }
    catch { setGoogleConnected(false); }
  }
  const initializeConnections = useEffectEvent(() => { void refreshConnections(); });
  useEffect(() => { const timer = setTimeout(() => initializeConnections(), 0); return () => clearTimeout(timer); }, []);

  function saveProcessing(invoice: InvoiceFields, change: Partial<ProcessingRecord>) {
    setLedger((current) => { const key = processingKey(companyId, invoice); return { ...current, [key]: { ...current[key], ...change, updatedAt: new Date().toISOString() } }; });
  }
  async function refreshMonth(target = month) {
    if (!memory.ready || !companyId || busy || memory.pending) return;
    setBusy(true); setError(""); setNotice("");
    try {
      const recovered: ManagedInvoice[] = target === "all" || target === "undated" ? [] : (await post("/api/fatture-in-cloud/month", { companyId: Number(companyId), month: target })).invoices;
      const known = enriched.filter((item) => (target === "all" || invoiceMonth(item) === target) && (item.ficId || item.td17));
      const verified: Verification[] = [];
      for (let offset = 0; offset < known.length; offset += 5) {
        const records = known.slice(offset, offset + 5).map((item) => ({ key: processingKey(companyId, item.invoice), expenseId: item.ficId, td17Id: item.td17?.id, invoice: item.invoice }));
        verified.push(...(await post("/api/fatture-in-cloud/processing", { companyId: Number(companyId), records })).records);
      }
      setInvoices((current) => {
        const next = [...current];
        for (const item of recovered) if (!next.some((existing) => processingKey(companyId, existing.invoice) === processingKey(companyId, item.invoice))) {
          const { processing: _processing, ...invoice } = item; void _processing; next.push(invoice);
        }
        return next;
      });
      setLedger((current) => {
        const next = { ...current };
        for (const record of verified) {
          next[record.key] = { ...next[record.key], updatedAt: new Date().toISOString() };
          if (record.expenseId) next[record.key].expenseId = record.expenseId;
          if (record.td17Id) next[record.key].td17Id = record.td17Id;
          if (record.expenseExists === false) delete next[record.key].expenseId;
          if (record.td17Exists === false) { delete next[record.key].td17Id; delete next[record.key].td17State; delete next[record.key].td17EiStatus; }
          else if (record.td17EiStatus !== undefined) { next[record.key].td17EiStatus = record.td17EiStatus; next[record.key].td17State = td17DeliveryState(record.td17EiStatus); }
        }
        for (const item of recovered) if (item.processing) next[processingKey(companyId, item.invoice)] = { ...next[processingKey(companyId, item.invoice)], ...item.processing };
        return next;
      });
      setUpdated(new Date().toLocaleTimeString("it-IT", { hour: "2-digit", minute: "2-digit" }));
      setNotice(recovered.length ? `${recovered.length} fatture recuperate da FIC.` : "Stati FIC aggiornati.");
    } catch (e) { setError(e instanceof Error ? e.message : "Aggiornamento FIC non riuscito. Stati conservati."); }
    finally { setBusy(false); }
  }
  const initialSync = useEffectEvent(() => { void refreshMonth(month); });
  useEffect(() => {
    if (!memory.ready || !companyId) return;
    const key = `${companyId}:${month}`;
    if (syncedRef.current === key) return;
    syncedRef.current = key;
    initialSync();
  }, [memory.ready, companyId, month]);

  function changeMonth(value: string) { if (!locked && !memory.pending) { setMonth(value); setPage(0); setSelectedId(null); setNotice(""); setQuery(""); } }
  function shiftMonth(delta: number) {
    if (!/^\d{4}-\d{2}$/.test(month)) return;
    changeMonth(new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)) - 1 + delta, 1)).toISOString().slice(0, 7));
  }
  function acquire(result: ArchivedInvoice) {
    setInvoices((current) => {
      const existing = current.find((item) => item.driveId === result.driveId || (result.invoice.invoice.invoice_number && processingKey(companyId, item.invoice) === processingKey(companyId, result.invoice.invoice)));
      if (existing) return existing.driveId ? current : current.map((item) => item.id === existing.id ? { ...item, driveId: result.driveId } : item);
      return [...current, { ...result.invoice, driveId: result.driveId, id: `drive-${result.driveId}` }];
    });
    const importedMonth = invoiceMonth({ ...result.invoice, id: result.driveId });
    if (importedMonth !== month && month !== "all") setNotice(`Fattura acquisita nel mese ${monthLabel(importedMonth)}.`);
  }
  async function uploadFiles(files: File[]) {
    if (!memory.ready || memory.error) return;
    const pdfs = files.filter((file) => file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf"));
    if (!pdfs.length) { setError("Seleziona almeno un PDF."); return; }
    setUploading(true); setError("");
    try {
      const body = new FormData(); pdfs.forEach((file) => body.append("files", file));
      const response = await fetch("/api/invoices/upload", { method: "POST", body });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Lettura PDF non riuscita.");
      setInvoices((current) => [...current, ...(data.invoices as ParsedInvoice[]).map((item) => ({ ...item, id: `${item.file_name}-${crypto.randomUUID()}` }))]);
      setNotice(`${data.invoices.length} fatture acquisite. Sono nel mese riportato sul documento.`);
    } catch (e) { setError(e instanceof Error ? e.message : "Acquisizione non riuscita."); }
    finally { setUploading(false); }
  }
  function updateInvoice(field: keyof InvoiceFields, value: string) {
    if (!selected || selected.ficId || selected.td17) return;
    const normalized = value.includes(",") ? value.replace(/\./g, "").replace(",", ".") : value;
    const amount = normalized.trim() && Number.isFinite(Number(normalized)) ? Math.round(Number(normalized) * 100) / 100 : null;
    setInvoices((current) => current.map((item) => item.id === selected.id ? { ...item, checked_at: undefined, status: "needs_review", expenseDraft: undefined, invoice: { ...item.invoice, [field]: field.endsWith("_amount") ? amount : value } } : item));
  }
  function approveInvoice() {
    if (!selected || selected.status === "duplicate" || selected.ficId || selected.td17) return;
    const errors = invoiceErrors(selected.invoice);
    const issue = customerVatIssue(selected.invoice, company?.vat_number); if (issue) errors.push(issue);
    if (errors.length) { setError(errors.join(" ")); return; }
    setError(""); setInvoices((current) => current.map((item) => item.id === selected.id ? { ...item, checked_at: new Date().toISOString(), status: "approved" } : item));
  }
  function acknowledgeInvoice(id: string) {
    if (memory.pending || memory.error || !memory.ready || locked) return;
    const item = enriched.find((item) => item.id === id);
    if (!item || item.status === "duplicate") return;
    const issues = [...invoiceErrors(item.invoice), ...(customerVatIssue(item.invoice, company?.vat_number) ? ["Intestazione da verificare"] : [])];
    setError("");
    setInvoices((current) => current.map((invoice) => invoice.id === id ? { ...invoice, checked_at: new Date().toISOString(), status: issues.length ? "needs_review" : "approved" } : invoice));
    setNotice(issues.length ? "Controllo registrato. Restano verifiche da risolvere prima di spesa e TD17." : "Fattura controllata. Ora puoi registrare la spesa.");
  }
  function beginOperation(type: Operation["type"], id?: string) {
    const target = id ? enriched.find((item) => item.id === id) : selected;
    if (!target || target.status !== "approved" || invoiceErrors(target.invoice).length || (type === "expense" ? !canWrite || target.ficId : !canTd17 || !target.ficId || target.td17)) return;
    setSelectedId(target.id);
    setOperation({ type, id: target.id, invoice: structuredClone(target.invoice), companyId: Number(companyId), draft: target.expenseDraft });
  }
  function removeInvoice() {
    if (!selected || !window.confirm("Rimuovere questa fattura dal registro? Il PDF su Drive e i documenti FIC restano intatti.")) return;
    const id = selected.id; setSelectedId(null); setInvoices((current) => current.filter((item) => item.id !== id));
  }
  function resetProcessing() {
    if (!selected || !window.confirm("Azzerare i riferimenti di questa fattura? Nessun documento verra cancellato in FIC.")) return;
    const key = processingKey(companyId, selected.invoice); setLedger((current) => { const next = { ...current }; delete next[key]; return next; });
  }
  async function disconnect(service: "fic" | "google") {
    if (memory.pending || locked || !window.confirm(`Scollegare ${service === "fic" ? "Fatture in Cloud" : "Google"}? Le fatture salvate restano intatte.`)) return;
    setBusy(true);
    try {
      if (service === "google") await post("/api/google/invoices", { action: "disconnect" });
      else { const response = await fetch("/api/fatture-in-cloud/disconnect", { method: "POST" }); if (!response.ok) throw new Error("Scollegamento non riuscito."); }
      setSelectedId(null); await refreshConnections(); memory.refresh();
    } catch (e) { setError(e instanceof Error ? e.message : "Scollegamento non riuscito."); }
    finally { setBusy(false); }
  }
  const feedback = <>{(error || memory.error) && <div role="alert" className="sf-alert alert-error"><AlertTriangle size={17}/><span>{error || memory.error}</span>{memory.error && <button onClick={memory.ready ? memory.retrySave : memory.refresh} className="sf-text-button">Riprova</button>}</div>}{notice && <p role="status" className="sf-notice">{notice}</p>}</>;
  return <div className="manager-shell">
    <aside className="manager-sidebar"><div className="manager-brand"><span><Layers size={22}/></span><strong>MosTag</strong></div><div className="manager-company"><strong>{company?.name || "La tua azienda"}</strong><small>Gestione aziendale</small></div><nav aria-label="Navigazione gestionale"><small>ACQUISTI</small><button className="manager-nav active" onClick={() => { if (!locked) { setDrawer(null); setSelectedId(null); } }}><Files size={18}/>Fatture estere</button><button className="manager-nav" disabled={locked} onClick={() => { setSelectedId(null); setDrawer("settings"); }}><Settings2 size={18}/>Impostazioni</button></nav><div className="sidebar-connections"><span><i className={fic?.connected ? "online-dot" : "offline-dot"}/>Fatture in Cloud</span><span><i className={googleConnected ? "online-dot" : "offline-dot"}/>Gmail e Drive</span></div></aside>
    <main className="manager-main"><header className="manager-header"><div><p>Acquisti / Fatture estere</p><h1>Fatture estere</h1></div><div className="manager-actions"><div className="month-switch"><button className="sf-icon" aria-label="Mese precedente" title="Mese precedente" disabled={locked || memory.pending || month === "all" || month === "undated"} onClick={() => shiftMonth(-1)}><ChevronLeft size={17}/></button><select aria-label="Mese cronologia" value={month} disabled={locked || memory.pending} onChange={(e) => changeMonth(e.target.value)}><option value="all">Tutti i mesi</option>{months.map((value) => <option key={value} value={value}>{monthLabel(value)}</option>)}</select><button className="sf-icon" aria-label="Mese successivo" title="Mese successivo" disabled={locked || memory.pending || month === "all" || month === "undated"} onClick={() => shiftMonth(1)}><ChevronRight size={17}/></button></div><button className="sf-button sf-primary" disabled={locked} onClick={() => { setSelectedId(null); setDrawer("acquire"); }}><Plus size={17}/>Acquisisci fatture</button></div></header>
      <section className="manager-overview"><div className="manager-metrics"><div><strong>{monthly.length}</strong><small>Fatture del mese</small></div><div><strong>{currencyTotals(monthly)}</strong><small>Totale acquisti</small></div><div className="metric-aqua"><strong>{monthly.filter((item) => workflowStage(item) === "done").length} / {monthly.length}</strong><small>Completate</small></div></div><div className="manager-sync"><span>{busy ? "Aggiornamento FIC..." : updated ? `FIC aggiornato alle ${updated}` : "FIC da aggiornare"}<small className={memory.error ? "sync-error" : memory.pending ? "sync-pending" : ""}>{memory.error ? "Salvataggio non riuscito" : memory.pending ? "Salvataggio in corso..." : memory.ready ? "Salvato online" : "Collega Google e FIC"}</small></span><button className="sf-icon" title="Aggiorna da Fatture in Cloud" aria-label="Aggiorna da FIC" disabled={!memory.ready || memory.pending || locked} onClick={() => void refreshMonth()}><RotateCcw size={17} className={busy ? "animate-spin" : ""}/></button><form action="/api/auth/logout" method="post" onSubmit={(e) => { if (memory.pending || locked) { e.preventDefault(); setError("Completa le operazioni e il salvataggio prima di uscire."); } }}><button className="sf-icon" title="Esci" aria-label="Esci"><LogOut size={17}/></button></form></div></section>
      {feedback}
      {!memory.ready && !memory.error && <p className="sf-notice">{fic?.connected && googleConnected ? "Caricamento delle fatture gestite..." : "Collega Google e FIC nelle impostazioni per iniziare."}<button className="sf-text-button" onClick={() => setDrawer("settings")}>Impostazioni</button></p>}
      {memory.legacyCount > 0 && <p className="sf-notice"><button className="sf-text-button" onClick={memory.migrateLegacy}>Recupera lavoro precedente ({memory.legacyCount})</button></p>}
      <div className="register-toolbar"><nav className="register-filters" aria-label="Stato fatture">{filterLabels.map(([key, label]) => <button key={key} aria-pressed={filter === key} onClick={() => { setFilter(key); setPage(0); }}>{label}<span>{monthly.filter((item) => key === "all" || workflowStage(item) === key).length}</span></button>)}</nav><label className="register-search"><Search size={16}/><input aria-label="Cerca fattura o fornitore" value={query} onChange={(e) => { setQuery(e.target.value); setPage(0); }} placeholder="Cerca fattura o fornitore"/></label></div>
      <InvoiceRegister invoices={visible} onOpen={setSelectedId} onCheck={acknowledgeInvoice} onExpense={(id) => beginOperation("expense", id)} onTd17={(id) => beginOperation("td17", id)} canWrite={canWrite} canTd17={canTd17} pending={memory.pending || locked || Boolean(memory.error)} ready={memory.ready} onAcquire={() => setDrawer("acquire")}/>
      <footer className="register-footer">
        <span>{filtered.length ? currentPage * pageSize + 1 : 0} - {Math.min((currentPage + 1) * pageSize, filtered.length)} di {filtered.length} fatture · {monthLabel(month)}</span>
        <nav aria-label="Paginazione fatture">
          <select aria-label="Fatture per pagina" value={pageSize} onChange={(e) => { setPageSize(Number(e.target.value)); setPage(0); }}>{[8, 16, 32].map((size) => <option key={size} value={size}>{size} per pagina</option>)}</select>
          <span>{currentPage + 1} / {totalPages}</span>
          <button className="sf-icon" aria-label="Fatture precedenti" title="Pagina precedente" disabled={currentPage === 0} onClick={() => setPage(currentPage - 1)}><ArrowLeft size={15}/></button>
          <button className="sf-icon" aria-label="Fatture successive" title="Pagina successiva" disabled={currentPage + 1 >= totalPages} onClick={() => setPage(currentPage + 1)}><ArrowRight size={15}/></button>
        </nav>
      </footer><p className="manager-sdi"><CheckCheck size={13}/>Invio SDI: conferma finale in Fatture in Cloud</p>
    </main>
    {selected && !operation && !drawer && <InvoiceDetail item={selected} error={error || memory.error} canWrite={canWrite} canTd17={canTd17} pending={memory.pending || Boolean(memory.error) || busy} onClose={() => setSelectedId(null)} onApprove={approveInvoice} onExpense={() => beginOperation("expense")} onTd17={() => beginOperation("td17")} onChange={updateInvoice} onRemove={removeInvoice} onReset={resetProcessing} onRefresh={() => void refreshMonth(invoiceMonth(selected))}/>}
    {drawer === "acquire" && <AppDrawer wide title="Acquisisci fatture" onClose={() => setDrawer(null)} busy={acquiring || uploading} footer={<><span className="text-xs text-slate-500">{memory.pending ? "Salvataggio in corso..." : "Nessuna spesa o TD17 creati durante l'acquisizione."}</span><button className="sf-button" disabled={acquiring || uploading} onClick={() => setDrawer(null)}>Torna al registro</button></>}><AcquisitionPanel initialMonth={/^\d{4}-\d{2}$/.test(month) ? month : currentMonth()} invoices={invoices} enabled={memory.ready && !memory.error} onInvoice={acquire} onBusy={setAcquiring} onUpload={uploadFiles} uploading={uploading}/>{feedback}</AppDrawer>}
    {drawer === "settings" && <AppDrawer title="Impostazioni azienda" onClose={() => setDrawer(null)} busy={busy}><section className="settings-section"><h3>Azienda Fatture in Cloud</h3><select aria-label="Azienda Fatture in Cloud" value={companyId} disabled={memory.pending || locked} onChange={(e) => { setCompanyId(e.target.value); setSelectedId(null); setUpdated(""); setPage(0); }}>{!companies.length && <option value="">Nessuna azienda collegata</option>}{companies.map((item) => <option key={item.id} value={String(item.id)}>{item.name}</option>)}</select></section><section className="settings-section"><h3>Fatture in Cloud</h3><p>{fic?.connected ? "Collegato" : "Non collegato"}</p>{fic?.config.configured === false && <p className="text-sm text-red-700">Configurazione da completare: {fic.config.missing.join(", ")}</p>}<div className="settings-actions">{(!fic?.connected || !canWriteExpenses(fic.scope) || !canPrepareTd17(fic.scope)) && <a href="/api/fatture-in-cloud/connect" className="sf-button sf-primary"><Link2 size={16}/>{fic?.connected ? "Autorizza spese e TD17" : "Collega FIC"}</a>}<button className="sf-button" disabled={busy} onClick={() => void refreshConnections()}><RotateCcw size={15}/>Aggiorna</button>{fic?.connected && <button className="sf-text-button" disabled={memory.pending || busy} onClick={() => void disconnect("fic")}>Scollega</button>}</div></section><section className="settings-section"><h3>Gmail e Drive</h3><p>{googleConnected ? "Collegati · Etichetta Fatture SaaS" : "Non collegati"}</p><div className="settings-actions"><a href="/api/google/connect" className="sf-button"><Link2 size={16}/>{googleConnected ? "Ricollega Google" : "Collega Google"}</a>{googleConnected && <button className="sf-text-button" disabled={memory.pending || busy} onClick={() => void disconnect("google")}>Scollega</button>}</div></section><dl className="settings-defaults"><dt>Centro di costo</dt><dd>WEB</dd><dt>Invio SDI</dt><dd>Manuale in FIC</dd></dl>{memory.error && <button className="sf-button" onClick={memory.refresh}>Ricarica fatture salvate</button>}{feedback}</AppDrawer>}
    {operation?.type === "expense" && <ExpenseDialog key={`${operation.id}-${operation.companyId}`} invoice={operation.invoice} companyId={operation.companyId} initialDraft={operation.draft?.companyId === operation.companyId ? operation.draft : undefined} onClose={() => setOperation(null)} onPrepared={(expenseDraft) => setInvoices((current) => current.map((item) => item.id === operation.id ? { ...item, expenseDraft } : item))} onCreated={(expenseId) => saveProcessing(operation.invoice, { expenseId })}/>}
    {operation?.type === "td17" && <Td17Dialog key={`${operation.id}-${operation.companyId}`} invoice={operation.invoice} companyId={operation.companyId} onClose={() => setOperation(null)} onCreated={(result) => saveProcessing(operation.invoice, { td17Id: result.id, td17State: td17DeliveryState(result.eiStatus), td17EiStatus: result.eiStatus })}/>}
  </div>;
}
