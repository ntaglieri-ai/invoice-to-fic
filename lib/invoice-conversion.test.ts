import { describe, expect, it } from "vitest";
import { cleanEurConversion, invoiceForFic } from "./invoice-conversion";
import { parseEcbRate } from "./ecb-exchange-rate";
import type { InvoiceFields } from "./types";

const invoice: InvoiceFields = { supplier: "Anthropic", invoice_number: "GN9T4V6Z-0018", invoice_date: "2026-09-28", currency: "USD", net_amount: 10.1, tax_amount: 0, total_amount: 10.1, supplier_vat: "" };
const conversion = { rate: 0.9, date: "2026-09-28", source: "manual" as const, confirmed_at: "2026-10-10T12:00:00Z" };

describe("confirmed foreign currency conversion", () => {
  it("preserves the original and converts consistently for FIC", () => {
    const result = invoiceForFic({ ...invoice, eur_conversion: conversion });
    expect(result).toMatchObject({ currency: "EUR", net_amount: 9.09, tax_amount: 0, total_amount: 9.09 });
    expect(result.foreign_reference).toContain("10.10 USD");
    expect(invoice.currency).toBe("USD");
    expect(invoice.total_amount).toBe(10.1);
  });
  it("requires explicit valid conversion metadata", () => {
    expect(() => invoiceForFic(invoice)).toThrow();
    for (const rate of [0, -1, NaN, Infinity]) expect(() => cleanEurConversion({ ...conversion, rate })).toThrow();
    expect(() => cleanEurConversion({ ...conversion, date: "2026-02-30" })).toThrow();
  });
  it("leaves EUR invoices unchanged", () => {
    const euro = { ...invoice, currency: "EUR" };
    expect(invoiceForFic(euro)).toBe(euro);
  });
  it("rejects inconsistent original totals", () => {
    expect(() => invoiceForFic({ ...invoice, total_amount: 20, eur_conversion: conversion })).toThrow();
  });
});

describe("historical ECB proposal", () => {
  const xml = '<Envelope><Cube><Cube time="2026-09-28"><Cube currency="USD" rate="1.25"/></Cube><Cube time="2026-09-25"><Cube currency="USD" rate="1.2"/></Cube></Cube></Envelope>';
  it("inverts EUR reference rates", () => {
    expect(parseEcbRate(xml, "USD", "2026-09-28").rate).toBe(0.8);
  });
  it("uses the previous published day, never a future quote", () => {
    expect(parseEcbRate(xml, "USD", "2026-09-27").date).toBe("2026-09-25");
  });
  it("rejects absent currencies and stale or unavailable dates", () => {
    expect(() => parseEcbRate(xml, "GBP", "2026-09-28")).toThrow();
    expect(() => parseEcbRate(xml, "USD", "2026-10-10")).toThrow();
    expect(() => parseEcbRate(xml, "USD", "2026-09-24")).toThrow();
  });
});
