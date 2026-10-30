"use client";

import { useEffect, useState } from "react";
import { ArrowRight, Check } from "lucide-react";
import { AppDrawer } from "./app-drawer";
import { invoiceForFic } from "@/lib/invoice-conversion";
import type { EurConversion, InvoiceFields } from "@/lib/types";

export function CurrencyConversionDialog({ invoice, onClose, onConfirm }: { invoice: InvoiceFields; onClose: () => void; onConfirm: (conversion: EurConversion) => void }) {
  const [date, setDate] = useState(invoice.eur_conversion?.date ?? invoice.invoice_date);
  const [source, setSource] = useState<"ECB" | "manual">(invoice.eur_conversion?.source ?? "ECB");
  const [rate, setRate] = useState("");
  const [quoteDate, setQuoteDate] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  useEffect(() => {
    if (source !== "ECB") return;
    let cancelled = false;
    const controller = new AbortController();
    async function quote() {
      setBusy(true); setRate(""); setError(""); setConfirmed(false);
      try {
        const response = await fetch(`/api/exchange-rate?${new URLSearchParams({ currency: invoice.currency, date })}`, { signal: controller.signal });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || "Cambio non disponibile.");
        if (!cancelled) { setRate(String(data.rate)); setQuoteDate(data.date); }
      } catch (e) { if (!cancelled) setError(e instanceof Error ? e.message : "Cambio non disponibile."); }
      finally { if (!cancelled) setBusy(false); }
    }
    void quote();
    return () => { cancelled = true; controller.abort(); };
  }, [invoice.currency, date, source]);
  const conversion: EurConversion = { rate: Number(rate.replace(",", ".")), date: source === "ECB" ? quoteDate : date, source, confirmed_at: new Date().toISOString() };
  let converted: InvoiceFields | undefined;
  try { converted = invoiceForFic({ ...invoice, eur_conversion: conversion }); } catch { /* No valid preview until the quote is complete. */ }
  return <AppDrawer title="Conferma cambio" onClose={onClose} footer={<button className="sf-button sf-primary" disabled={busy || !confirmed || !converted} onClick={() => onConfirm(conversion)}><Check size={16}/>Conferma cambio e continua</button>}>
    <div className="invoice-identity"><div><span className="detail-supplier">{invoice.supplier}</span><h3>{invoice.invoice_number}</h3></div><strong>{invoice.total_amount?.toFixed(2)} {invoice.currency}</strong></div>
    <section className="detail-section"><div className="detail-fields">
      <label>Data cambio (da confermare)<input type="date" value={date} onChange={(e) => { setDate(e.target.value); setConfirmed(false); }}/></label>
      <label>Fonte<select value={source} onChange={(e) => { setSource(e.target.value as "ECB" | "manual"); setRate(""); setError(""); setBusy(false); setConfirmed(false); }}><option value="ECB">Banca centrale europea</option><option value="manual">Cambio manuale</option></select></label>
      <label>1 {invoice.currency} in EUR<input inputMode="decimal" readOnly={source === "ECB"} value={rate} onChange={(e) => { setRate(e.target.value); setConfirmed(false); }}/></label>
    </div></section>
    {busy && <p role="status" className="sf-notice">Recupero cambio BCE...</p>}
    {error && <p role="alert" className="sf-alert alert-warning">{error}</p>}
    {converted && <section className="detail-section"><div className="invoice-identity"><strong>{invoice.total_amount?.toFixed(2)} {invoice.currency}</strong><ArrowRight size={20}/><strong>{converted.total_amount?.toFixed(2)} EUR</strong></div><p className="sf-notice">Cambio {conversion.date.split("-").reverse().join("/")} · {source === "ECB" ? "BCE" : "Manuale"}</p></section>}
    <label className="flex items-start gap-3 text-sm"><input className="mt-1 size-4" type="checkbox" checked={confirmed} disabled={busy || !converted} onChange={(e) => setConfirmed(e.target.checked)}/><span>Confermo data, cambio e importo in euro per la registrazione in FIC. Il documento originale resta in {invoice.currency}.</span></label>
  </AppDrawer>;
}
