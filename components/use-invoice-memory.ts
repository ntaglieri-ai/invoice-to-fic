"use client";

import { useCallback, useEffect, useRef, useState, type Dispatch, type SetStateAction } from "react";
import { HISTORY_KEY, readInvoiceHistory, type HistoryInvoice } from "@/lib/invoice-history";
import { cleanMemoryEvent, memoryChanges, memoryLedger, type ManagedInvoice, type MemoryEvent, type MemoryRecords } from "@/lib/invoice-memory";
import { PROCESSING_STORAGE_KEY, readProcessingLedger, type ProcessingLedger } from "@/lib/processing-state";

type MemoryResponse = { records: MemoryRecords; accountId: string };
type State<T> = { companyId: string; accountId: string; records: MemoryRecords; invoices: T[]; ledger: ProcessingLedger; ready: boolean };
type Pending = { event: MemoryEvent; submitted: MemoryRecords };

async function request(companyId: string, event?: MemoryEvent): Promise<MemoryResponse> {
  const body = JSON.stringify({ companyId: Number(companyId), action: event ? "save" : "load", ...(event ? { event } : {}) });
  const response = await fetch("/api/invoice-memory", { method: "POST", headers: { "Content-Type": "application/json" }, body, keepalive: body.length < 60000 });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || "Memoria online non disponibile.");
  return result;
}

function outboxKey(companyId: string, accountId: string) { return `invoice-to-fic:pending:v1:${accountId}:${companyId}`; }
function values<T>(records: MemoryRecords) { return Object.values(records).flatMap(({ value }) => value ? [value as T] : []); }
function snapshot<T extends HistoryInvoice>(state: State<T>): MemoryRecords {
  return Object.fromEntries(memoryChanges({}, state.invoices, state.ledger, state.companyId).map(({ id, value }) => [id, { value, revision: state.records[id]?.revision ?? "" }]));
}

export function useInvoiceMemory<T extends HistoryInvoice>(companyId: string) {
  const [state, setState] = useState<State<T>>({ companyId: "", accountId: "", records: {}, invoices: [], ledger: {}, ready: false });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [reload, setReload] = useState(0);
  const [retry, setRetry] = useState(0);
  const [legacyCount, setLegacyCount] = useState(0);
  const pendingRef = useRef<Pending | null>(null);
  const recoveryKeyRef = useRef("");
  const activeRef = useRef(0);
  const ready = state.ready && state.companyId === companyId;
  const dirty = ready && memoryChanges(state.records, state.invoices, state.ledger, companyId).length > 0;

  useEffect(() => {
    const generation = ++activeRef.current;
    let cancelled = false;
    async function load() {
      setError(""); setSaving(false);
      setState({ companyId, accountId: "", records: {}, invoices: [], ledger: {}, ready: false });
      if (!companyId) return;
      try {
        let result = await request(companyId);
        const key = outboxKey(companyId, result.accountId);
        recoveryKeyRef.current = key;
        let stored: string | null = null;
        try { stored = localStorage.getItem(key); } catch { /* Online memory does not depend on browser storage. */ }
        if (stored) {
          const event = cleanMemoryEvent(JSON.parse(stored));
          // Same operation ID makes an uncertain save safe to confirm on the next login.
          result = await request(companyId, event);
          try { localStorage.removeItem(key); } catch { /* The server already confirmed the save. */ }
        }
        if (cancelled || activeRef.current !== generation) return;
        pendingRef.current = null;
        setState({ companyId, accountId: result.accountId, records: result.records, invoices: values<T>(result.records), ledger: memoryLedger(result.records, companyId), ready: true });
        try {
          const remote = values<ManagedInvoice>(result.records);
          setLegacyCount(readInvoiceHistory(localStorage.getItem(HISTORY_KEY)).filter((item) => !result.records[item.id] && !remote.some((other) => other.invoice.supplier === item.invoice.supplier && other.invoice.invoice_number === item.invoice.invoice_number)).length);
        } catch { setLegacyCount(0); }
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : "Memoria online non disponibile.");
      }
    }
    void load();
    return () => { cancelled = true; };
  }, [companyId, reload]);

  useEffect(() => {
    if (!ready || saving || error) return;
    const changes = memoryChanges(state.records, state.invoices, state.ledger, companyId).slice(0, 25);
    if (!changes.length) return;
    const generation = activeRef.current;
    const timer = window.setTimeout(async () => {
      setSaving(true);
      const pending = pendingRef.current ?? { event: { version: 1 as const, operationId: crypto.randomUUID(), changes }, submitted: snapshot(state) };
      pendingRef.current = pending;
      const key = outboxKey(companyId, state.accountId);
      try {
        try { localStorage.setItem(key, JSON.stringify(pending.event)); } catch { /* Best-effort outbox; the actual record is saved online. */ }
        const result = await request(companyId, pending.event);
        if (activeRef.current !== generation) return;
        try { localStorage.removeItem(key); } catch { /* An acknowledged operation is idempotent on the next login. */ }
        pendingRef.current = null;
        setState((current) => {
          // Retain edits made while saving; also import unrelated changes from another browser.
          const merged = { ...result.records };
          for (const change of memoryChanges(pending.submitted, current.invoices, current.ledger, companyId)) {
            merged[change.id] = { value: change.value, revision: result.records[change.id]?.revision ?? "" };
          }
          // Batches after the first 25 must remain pending rather than vanish on reconciliation.
          const submittedIds = new Set(pending.event.changes.map((change) => change.id));
          for (const change of memoryChanges(current.records, current.invoices, current.ledger, companyId)) {
            if (!submittedIds.has(change.id)) merged[change.id] = { value: change.value, revision: result.records[change.id]?.revision ?? "" };
          }
          return { ...current, records: result.records, invoices: values<T>(merged), ledger: memoryLedger(merged, companyId) };
        });
      } catch (e) {
        if (activeRef.current === generation) setError(e instanceof Error ? e.message : "Salvataggio online non riuscito.");
      } finally { if (activeRef.current === generation) setSaving(false); }
    }, 400);
    return () => window.clearTimeout(timer);
  }, [state, companyId, ready, saving, error, retry]);

  useEffect(() => {
    if (!dirty && !saving) return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ""; };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty, saving]);

  const setInvoices: Dispatch<SetStateAction<T[]>> = useCallback((update) => {
    setState((current) => ({ ...current, invoices: typeof update === "function" ? update(current.invoices) : update }));
  }, []);
  const setLedger: Dispatch<SetStateAction<ProcessingLedger>> = useCallback((update) => {
    setState((current) => ({ ...current, ledger: typeof update === "function" ? update(current.ledger) : update }));
  }, []);

  function migrateLegacy() {
    if (!ready) return;
    if (!window.confirm("Associare il lavoro precedente di questo browser all'azienda FIC selezionata e salvarlo online?")) return;
    try {
      const old = readInvoiceHistory(localStorage.getItem(HISTORY_KEY));
      const oldLedger = readProcessingLedger(localStorage.getItem(PROCESSING_STORAGE_KEY));
      setState((current) => {
        const invoices = [...current.invoices];
        for (const item of old) {
          // Server tombstones and remote invoice identities win over an old browser copy.
          if (current.records[item.id] || invoices.some((existing) => existing.invoice.supplier === item.invoice.supplier && existing.invoice.invoice_number === item.invoice.invoice_number)) continue;
          invoices.push({ ...item, ...(item.id.startsWith("drive-") ? { driveId: item.id.slice(6) } : {}) } as T);
        }
        return { ...current, invoices, ledger: { ...oldLedger, ...current.ledger } };
      });
      setLegacyCount(0);
    } catch { setError("Recupero del lavoro precedente non riuscito."); }
  }

  function refresh() {
    let recovery = false;
    try { recovery = Boolean(recoveryKeyRef.current && localStorage.getItem(recoveryKeyRef.current)); } catch { /* No browser outbox. */ }
    if ((dirty || saving || recovery) && !window.confirm("Ricaricare la memoria online? Le modifiche non salvate saranno scartate. I documenti FIC e i PDF su Drive restano intatti.")) return;
    if (recovery) { try { localStorage.removeItem(recoveryKeyRef.current); } catch { setError("Impossibile scartare le modifiche non salvate."); return; } }
    pendingRef.current = null;
    setReload((value) => value + 1);
  }
  return { invoices: ready ? state.invoices : [], setInvoices, ledger: ready ? state.ledger : {}, setLedger, ready,
    saving, pending: dirty || saving, error, legacyCount, migrateLegacy, refresh,
    retrySave: () => { setError(""); setRetry((value) => value + 1); } };
}
