"use client";

import {
  AlertTriangle,
  Check,
  CheckCircle2,
  Cloud,
  FileText,
  Link2,
  LogOut,
  Pencil,
  RotateCcw,
  UploadCloud,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import type { InvoiceFields, InvoiceStatus, ParsedInvoice, SupportedSupplier } from "@/lib/types";

const SUPPLIERS: SupportedSupplier[] = ["OpenAI", "Anthropic", "Vercel", "Hetzner", "Supabase", "Sconosciuto"];

type UiInvoice = ParsedInvoice & {
  id: string;
};

type UploadState = "idle" | "dragging" | "uploading" | "error";

type FicCompany = {
  id: number | null;
  name: string | null;
  type: string | null;
  controlled_companies?: FicCompany[] | null;
};

type FicStatus = {
  connected: boolean;
  config: {
    configured: boolean;
    missing: string[];
    redirectUri: string;
    scopes: string[];
  };
  companies: FicCompany[];
  expiresAt?: string;
  scope?: string;
  error?: string;
};

const moneyFormatter = new Intl.NumberFormat("it-IT", {
  style: "currency",
  currency: "EUR",
  currencyDisplay: "narrowSymbol",
});

export function InvoiceDashboard() {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [invoices, setInvoices] = useState<UiInvoice[]>([]);
  const [uploadState, setUploadState] = useState<UploadState>("idle");
  const [error, setError] = useState("");
  const [ficStatus, setFicStatus] = useState<FicStatus | null>(null);
  const [ficBusy, setFicBusy] = useState(false);

  const enrichedInvoices = useMemo(() => markDuplicates(invoices), [invoices]);
  const groups = useMemo(() => groupInvoices(enrichedInvoices), [enrichedInvoices]);
  const globalTotal = useMemo(
    () => enrichedInvoices.reduce((sum, item) => sum + (item.invoice.total_amount ?? 0), 0),
    [enrichedInvoices],
  );
  const approvedCount = enrichedInvoices.filter((item) => item.status === "approved").length;

  useEffect(() => {
    refreshFicStatus();
  }, []);

  async function refreshFicStatus() {
    const response = await fetch("/api/fatture-in-cloud/status", { cache: "no-store" });
    const payload = (await response.json()) as FicStatus;
    setFicStatus(payload);
  }

  async function disconnectFic() {
    setFicBusy(true);
    await fetch("/api/fatture-in-cloud/disconnect", { method: "POST" });
    await refreshFicStatus();
    setFicBusy(false);
  }

  async function uploadFiles(files: FileList | File[]) {
    const pdfs = Array.from(files).filter((file) => file.type === "application/pdf" || file.name.endsWith(".pdf"));
    if (pdfs.length === 0) {
      setError("Seleziona almeno un file PDF.");
      setUploadState("error");
      return;
    }

    setUploadState("uploading");
    setError("");

    const data = new FormData();
    pdfs.forEach((file) => data.append("files", file));

    const response = await fetch("/api/invoices/upload", {
      method: "POST",
      body: data,
    });

    if (!response.ok) {
      const payload = (await response.json().catch(() => null)) as { error?: string } | null;
      setError(payload?.error ?? "Errore durante l'elaborazione dei PDF.");
      setUploadState("error");
      return;
    }

    const payload = (await response.json()) as { invoices: ParsedInvoice[] };
    setInvoices((current) => [
      ...current,
      ...payload.invoices.map((invoice) => ({
        ...invoice,
        id: `${invoice.file_name}-${invoice.index}-${crypto.randomUUID()}`,
      })),
    ]);
    setUploadState("idle");
  }

  function updateInvoice(id: string, field: keyof InvoiceFields, rawValue: string) {
    setInvoices((current) =>
      current.map((item) => {
        if (item.id !== id) return item;
        const value = field.endsWith("_amount") ? parseEditableNumber(rawValue) : rawValue;
        return {
          ...item,
          status: item.status === "approved" ? "approved" : "needs_review",
          invoice: {
            ...item.invoice,
            [field]: value,
          },
        };
      }),
    );
  }

  function approveInvoice(id: string) {
    setInvoices((current) =>
      current.map((item) => (item.id === id ? { ...item, status: "approved" as InvoiceStatus } : item)),
    );
  }

  function approveAll() {
    setInvoices((current) =>
      current.map((item) => (item.status === "duplicate" ? item : { ...item, status: "approved" as InvoiceStatus })),
    );
  }

  return (
    <main className="min-h-screen px-6 py-8">
      <div className="mx-auto flex w-full max-w-7xl flex-col gap-6">
        <header className="flex flex-col gap-4 border-b border-line pb-6 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <div className="mb-3 inline-flex items-center gap-2 rounded-md border border-line bg-white px-3 py-1.5 text-sm text-slate-600">
              <FileText size={16} />
              MVP Fase 1
            </div>
            <h1 className="text-3xl font-semibold tracking-normal text-ink">Invoice to FIC</h1>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-600">
              Preparazione temporanea delle fatture PDF SaaS estere: estrazione, revisione manuale e approvazione prima
              dell&apos;integrazione Fatture in Cloud.
            </p>
          </div>
          <div className="grid grid-cols-3 gap-3 text-sm">
            <Metric label="Fatture" value={String(enrichedInvoices.length)} />
            <Metric label="Approvate" value={`${approvedCount}/${enrichedInvoices.length}`} />
            <Metric label="Totale" value={formatMoney(globalTotal)} />
          </div>
        </header>

        <FattureInCloudPanel
          busy={ficBusy}
          status={ficStatus}
          onDisconnect={disconnectFic}
          onRefresh={refreshFicStatus}
        />

        <section className="grid gap-5 lg:grid-cols-[minmax(340px,420px),1fr]">
          <div className="flex flex-col gap-4">
            <div
              className={`flex min-h-[260px] cursor-pointer flex-col items-center justify-center rounded-lg border-2 border-dashed bg-white p-8 text-center shadow-panel transition ${
                uploadState === "dragging" ? "border-mint bg-emerald-50" : "border-line hover:border-slate-400"
              }`}
              onClick={() => fileInputRef.current?.click()}
              onDragEnter={(event) => {
                event.preventDefault();
                setUploadState("dragging");
              }}
              onDragOver={(event) => event.preventDefault()}
              onDragLeave={(event) => {
                event.preventDefault();
                setUploadState("idle");
              }}
              onDrop={(event) => {
                event.preventDefault();
                uploadFiles(event.dataTransfer.files);
              }}
            >
              <UploadCloud className="mb-4 text-slate-500" size={42} />
              <h2 className="text-lg font-semibold">Carica PDF fatture</h2>
              <p className="mt-2 max-w-xs text-sm leading-6 text-slate-600">
                Trascina più PDF insieme o selezionali dal computer. I file vengono letti in memoria e non salvati.
              </p>
              <input
                ref={fileInputRef}
                className="sr-only"
                type="file"
                accept="application/pdf,.pdf"
                multiple
                onChange={(event) => {
                  if (event.target.files) uploadFiles(event.target.files);
                  event.currentTarget.value = "";
                }}
              />
              <button
                className="mt-6 inline-flex h-10 items-center gap-2 rounded-md bg-ink px-4 text-sm font-medium text-white disabled:cursor-wait disabled:bg-slate-400"
                disabled={uploadState === "uploading"}
                type="button"
              >
                {uploadState === "uploading" ? <RotateCcw className="animate-spin" size={16} /> : <UploadCloud size={16} />}
                {uploadState === "uploading" ? "Elaborazione..." : "Seleziona PDF"}
              </button>
            </div>

            {error ? (
              <div className="flex items-start gap-3 rounded-md border border-red-200 bg-red-50 p-4 text-sm text-red-700">
                <AlertTriangle className="mt-0.5 shrink-0" size={18} />
                <span>{error}</span>
              </div>
            ) : null}

            <div className="rounded-lg border border-line bg-white p-4 shadow-panel">
              <h2 className="text-sm font-semibold uppercase tracking-normal text-slate-500">Totali per fornitore</h2>
              <div className="mt-4 space-y-3">
                {groups.length ? (
                  groups.map((group) => (
                    <div key={group.supplier} className="flex items-center justify-between border-b border-slate-100 pb-3 last:border-0 last:pb-0">
                      <div>
                        <p className="font-medium">{group.supplier}</p>
                        <p className="text-xs text-slate-500">{group.count} fatture</p>
                      </div>
                      <p className="font-semibold">{formatMoney(group.total)}</p>
                    </div>
                  ))
                ) : (
                  <p className="text-sm text-slate-500">Nessuna fattura caricata.</p>
                )}
              </div>
            </div>
          </div>

          <div className="rounded-lg border border-line bg-white shadow-panel">
            <div className="flex flex-col gap-3 border-b border-line p-4 md:flex-row md:items-center md:justify-between">
              <div>
                <h2 className="text-lg font-semibold">Revisione fatture</h2>
                <p className="text-sm text-slate-500">Modifica i campi incerti, controlla duplicati e approva.</p>
              </div>
              <button
                className="inline-flex h-10 items-center justify-center gap-2 rounded-md bg-mint px-4 text-sm font-semibold text-white disabled:bg-slate-300"
                disabled={!enrichedInvoices.length}
                onClick={approveAll}
                type="button"
              >
                <CheckCircle2 size={17} />
                Approva tutte
              </button>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full min-w-[980px] border-collapse text-left text-sm">
                <thead className="bg-slate-50 text-xs uppercase tracking-normal text-slate-500">
                  <tr>
                    <th className="px-4 py-3">Fornitore</th>
                    <th className="px-4 py-3">Numero</th>
                    <th className="px-4 py-3">Data</th>
                    <th className="px-4 py-3">Imponibile</th>
                    <th className="px-4 py-3">IVA</th>
                    <th className="px-4 py-3">Totale</th>
                    <th className="px-4 py-3">Stato</th>
                    <th className="px-4 py-3">Azioni</th>
                  </tr>
                </thead>
                <tbody>
                  {enrichedInvoices.length ? (
                    enrichedInvoices.map((item, index) => (
                      <InvoiceRow
                        key={item.id}
                        invoice={item}
                        isGroupStart={
                          index === 0 || enrichedInvoices[index - 1].invoice.supplier !== item.invoice.supplier
                        }
                        onApprove={approveInvoice}
                        onChange={updateInvoice}
                      />
                    ))
                  ) : (
                    <tr>
                      <td className="px-4 py-12 text-center text-slate-500" colSpan={8}>
                        Carica le fatture PDF per iniziare la revisione.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </section>
      </div>
    </main>
  );
}

function FattureInCloudPanel({
  busy,
  status,
  onDisconnect,
  onRefresh,
}: {
  busy: boolean;
  status: FicStatus | null;
  onDisconnect: () => void;
  onRefresh: () => void;
}) {
  const companies = status ? flattenCompanies(status.companies) : [];

  return (
    <section className="rounded-lg border border-line bg-white p-4 shadow-panel">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex items-start gap-3">
          <div className="flex size-10 shrink-0 items-center justify-center rounded-md bg-slate-100 text-ink">
            <Cloud size={20} />
          </div>
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-base font-semibold">Fatture in Cloud</h2>
              <span className="rounded-md border border-amber-200 bg-amber-50 px-2 py-1 text-xs font-semibold text-amber-700">
                Invio disattivato
              </span>
              <FicConnectionBadge status={status} />
            </div>
            <p className="mt-1 text-sm text-slate-600">
              Connessione OAuth pronta per leggere aziende e preparare la fase spese, reverse charge e TD17/TD18.
            </p>
            {status?.config.configured ? (
              <p className="mt-2 text-xs text-slate-500">Scope: {status.config.scopes.join(", ")}</p>
            ) : null}
            {status?.config.configured === false ? (
              <p className="mt-2 text-xs text-red-600">Mancano: {status.config.missing.join(", ")}</p>
            ) : null}
            {status?.error ? <p className="mt-2 text-xs text-red-600">{status.error}</p> : null}
          </div>
        </div>

        <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
          {status?.connected && companies.length ? (
            <select className="h-10 min-w-56 rounded-md border border-line bg-white px-3 text-sm">
              {companies.map((company) => (
                <option key={`${company.id}-${company.name}`} value={company.id ?? ""}>
                  {company.name ?? `Azienda ${company.id ?? ""}`}
                </option>
              ))}
            </select>
          ) : null}
          <div className="flex gap-2">
            <button
              className="inline-flex h-10 items-center justify-center gap-2 rounded-md border border-line px-3 text-sm font-medium hover:bg-slate-50"
              onClick={onRefresh}
              type="button"
            >
              <RotateCcw size={16} />
              Aggiorna
            </button>
            {status?.connected ? (
              <button
                className="inline-flex h-10 items-center justify-center gap-2 rounded-md border border-line px-3 text-sm font-medium hover:bg-slate-50 disabled:cursor-wait"
                disabled={busy}
                onClick={onDisconnect}
                type="button"
              >
                <LogOut size={16} />
                Scollega
              </button>
            ) : (
              <a
                className={`inline-flex h-10 items-center justify-center gap-2 rounded-md px-3 text-sm font-semibold ${
                  status?.config.configured
                    ? "bg-ink text-white"
                    : "cursor-not-allowed bg-slate-200 text-slate-500"
                }`}
                href={status?.config.configured ? "/api/fatture-in-cloud/connect" : undefined}
                aria-disabled={!status?.config.configured}
              >
                <Link2 size={16} />
                Collega FIC
              </a>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}

function FicConnectionBadge({ status }: { status: FicStatus | null }) {
  if (!status) {
    return (
      <span className="rounded-md border border-slate-200 bg-slate-50 px-2 py-1 text-xs font-semibold text-slate-600">
        Controllo...
      </span>
    );
  }

  if (status.connected) {
    return (
      <span className="rounded-md border border-emerald-200 bg-emerald-50 px-2 py-1 text-xs font-semibold text-emerald-700">
        Connesso
      </span>
    );
  }

  return (
    <span className="rounded-md border border-slate-200 bg-slate-50 px-2 py-1 text-xs font-semibold text-slate-600">
      Non collegato
    </span>
  );
}

function InvoiceRow({
  invoice,
  isGroupStart,
  onApprove,
  onChange,
}: {
  invoice: UiInvoice;
  isGroupStart: boolean;
  onApprove: (id: string) => void;
  onChange: (id: string, field: keyof InvoiceFields, rawValue: string) => void;
}) {
  const duplicate = invoice.status === "duplicate";

  return (
    <>
      {isGroupStart ? (
        <tr className="border-t border-line bg-slate-100/70">
          <td className="px-4 py-2 text-xs font-semibold uppercase tracking-normal text-slate-600" colSpan={8}>
            {invoice.invoice.supplier}
          </td>
        </tr>
      ) : null}
      <tr className={duplicate ? "bg-amber-50" : "border-t border-slate-100"}>
        <td className="px-4 py-3">
          <select
            className="h-9 w-36 rounded-md border border-line bg-white px-2"
            value={invoice.invoice.supplier}
            onChange={(event) => onChange(invoice.id, "supplier", event.target.value)}
          >
            {SUPPLIERS.map((supplier) => (
              <option key={supplier}>{supplier}</option>
            ))}
          </select>
        </td>
        <td className="px-4 py-3">
          <Editable value={invoice.invoice.invoice_number} onChange={(value) => onChange(invoice.id, "invoice_number", value)} />
        </td>
        <td className="px-4 py-3">
          <input
            className="h-9 w-36 rounded-md border border-line px-2"
            type="date"
            value={invoice.invoice.invoice_date}
            onChange={(event) => onChange(invoice.id, "invoice_date", event.target.value)}
          />
        </td>
        <td className="px-4 py-3">
          <Editable value={invoice.invoice.net_amount ?? ""} onChange={(value) => onChange(invoice.id, "net_amount", value)} />
        </td>
        <td className="px-4 py-3">
          <Editable value={invoice.invoice.tax_amount ?? ""} onChange={(value) => onChange(invoice.id, "tax_amount", value)} />
        </td>
        <td className="px-4 py-3">
          <Editable value={invoice.invoice.total_amount ?? ""} onChange={(value) => onChange(invoice.id, "total_amount", value)} />
        </td>
        <td className="px-4 py-3">
          <StatusBadge status={invoice.status} />
          {invoice.warnings.length ? <p className="mt-1 text-xs text-slate-500">{invoice.warnings[0]}</p> : null}
        </td>
        <td className="px-4 py-3">
          <button
            className="inline-flex h-9 items-center gap-2 rounded-md border border-line px-3 text-sm font-medium hover:bg-slate-50 disabled:cursor-not-allowed disabled:text-slate-400"
            disabled={duplicate}
            onClick={() => onApprove(invoice.id)}
            type="button"
            title={duplicate ? "Risolvi il duplicato prima di approvare" : "Approva fattura"}
          >
            <Check size={16} />
            Approva
          </button>
        </td>
      </tr>
      <tr className={duplicate ? "bg-amber-50/70" : "border-b border-slate-100 bg-white"}>
        <td className="px-4 pb-4 pt-0 text-xs text-slate-500" colSpan={8}>
          <div className="flex flex-wrap items-center gap-4">
            <span className="font-medium text-slate-600">{invoice.file_name}</span>
            <label className="flex items-center gap-2">
              <span>Valuta</span>
              <input
                className="h-8 w-20 rounded-md border border-line px-2 uppercase"
                maxLength={3}
                value={invoice.invoice.currency}
                onChange={(event) => onChange(invoice.id, "currency", event.target.value.toUpperCase())}
              />
            </label>
            <label className="flex items-center gap-2">
              <span>VAT fornitore</span>
              <input
                className="h-8 w-44 rounded-md border border-line px-2 uppercase"
                value={invoice.invoice.supplier_vat}
                onChange={(event) => onChange(invoice.id, "supplier_vat", event.target.value.toUpperCase())}
              />
            </label>
            <span>Confidenza {Math.round(invoice.confidence * 100)}%</span>
            {invoice.warnings.length ? <span>{invoice.warnings.join(" | ")}</span> : null}
          </div>
        </td>
      </tr>
    </>
  );
}

function Editable({ value, onChange }: { value: string | number; onChange: (value: string) => void }) {
  return (
    <label className="relative block">
      <Pencil className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-slate-400" size={14} />
      <input
        className="h-9 w-32 rounded-md border border-line pl-8 pr-2"
        value={value}
        onChange={(event) => onChange(event.target.value)}
      />
    </label>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-28 rounded-lg border border-line bg-white p-3 shadow-panel">
      <p className="text-xs uppercase tracking-normal text-slate-500">{label}</p>
      <p className="mt-1 text-lg font-semibold">{value}</p>
    </div>
  );
}

function StatusBadge({ status }: { status: InvoiceStatus }) {
  const styles: Record<InvoiceStatus, string> = {
    extracted: "bg-blue-50 text-blue-700 border-blue-200",
    needs_review: "bg-amber-50 text-amber-700 border-amber-200",
    duplicate: "bg-red-50 text-red-700 border-red-200",
    approved: "bg-emerald-50 text-emerald-700 border-emerald-200",
  };

  const labels: Record<InvoiceStatus, string> = {
    extracted: "Estratta",
    needs_review: "Da verificare",
    duplicate: "Duplicato",
    approved: "Approvata",
  };

  return (
    <span className={`inline-flex rounded-md border px-2 py-1 text-xs font-semibold ${styles[status]}`}>
      {labels[status]}
    </span>
  );
}

function flattenCompanies(companies: FicCompany[]): FicCompany[] {
  return companies.flatMap((company) => [
    company,
    ...(company.controlled_companies ? flattenCompanies(company.controlled_companies) : []),
  ]);
}

function groupInvoices(invoices: UiInvoice[]) {
  const bySupplier = new Map<SupportedSupplier, { supplier: SupportedSupplier; total: number; count: number }>();
  invoices.forEach((item) => {
    const current = bySupplier.get(item.invoice.supplier) ?? {
      supplier: item.invoice.supplier,
      total: 0,
      count: 0,
    };
    current.total += item.invoice.total_amount ?? 0;
    current.count += 1;
    bySupplier.set(item.invoice.supplier, current);
  });

  return Array.from(bySupplier.values()).sort((a, b) => a.supplier.localeCompare(b.supplier));
}

function markDuplicates(invoices: UiInvoice[]) {
  const seen = new Set<string>();
  return [...invoices]
    .sort((a, b) => a.invoice.supplier.localeCompare(b.invoice.supplier))
    .map((item) => {
      const key = item.invoice.supplier && item.invoice.invoice_number
        ? `${item.invoice.supplier.toLowerCase()}::${item.invoice.invoice_number.toLowerCase()}`
        : "";
      const duplicate = Boolean(key && seen.has(key));
      if (key) seen.add(key);
      return duplicate && item.status !== "approved"
        ? { ...item, status: "duplicate" as InvoiceStatus }
        : item;
    });
}

function parseEditableNumber(value: string) {
  const normalized = value.replace(/\./g, "").replace(",", ".");
  const parsed = Number.parseFloat(normalized);
  return Number.isFinite(parsed) ? Math.round(parsed * 100) / 100 : null;
}

function formatMoney(value: number) {
  return moneyFormatter.format(value);
}
