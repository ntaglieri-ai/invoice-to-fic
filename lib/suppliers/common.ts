import type { InvoiceFields, SupportedSupplier } from "@/lib/types";

export const EMPTY_INVOICE: InvoiceFields = {
  supplier: "Sconosciuto",
  invoice_number: "",
  invoice_date: "",
  currency: "EUR",
  net_amount: null,
  tax_amount: null,
  total_amount: null,
  supplier_vat: "",
};

export function includesAny(text: string, needles: string[]) {
  const lower = text.toLowerCase();
  return needles.some((needle) => lower.includes(needle.toLowerCase()));
}

export function firstMatch(text: string, patterns: RegExp[]) {
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match?.[1]) {
      return cleanToken(match[1]);
    }
  }

  return "";
}

export function cleanToken(value: string) {
  return value.replace(/\s+/g, " ").replace(/[#:;]+$/g, "").trim();
}

export function parseCurrency(text: string) {
  if (/\bUSD\b|\$\s?\d/.test(text)) return "USD";
  if (/\bEUR\b|€/.test(text)) return "EUR";
  if (/\bGBP\b|£/.test(text)) return "GBP";
  return "EUR";
}

export function parseAmount(value?: string | null) {
  if (!value) return null;

  const compact = value
    .replace(/[^\d,.-]/g, "")
    .replace(/(?!^)-/g, "")
    .trim();

  if (!compact) return null;

  const comma = compact.lastIndexOf(",");
  const dot = compact.lastIndexOf(".");
  const decimalSeparator = comma > dot ? "," : ".";
  const normalized =
    decimalSeparator === ","
      ? compact.replace(/\./g, "").replace(",", ".")
      : compact.replace(/,/g, "");

  const parsed = Number.parseFloat(normalized);
  return Number.isFinite(parsed) ? Math.round(parsed * 100) / 100 : null;
}

export function firstAmount(text: string, patterns: RegExp[]) {
  const value = firstMatch(text, patterns);
  return parseAmount(value);
}

export function normalizeDate(value: string) {
  const trimmed = cleanToken(value);
  const monthNames: Record<string, string> = {
    jan: "01",
    january: "01",
    feb: "02",
    february: "02",
    mar: "03",
    march: "03",
    apr: "04",
    april: "04",
    may: "05",
    jun: "06",
    june: "06",
    jul: "07",
    july: "07",
    aug: "08",
    august: "08",
    sep: "09",
    sept: "09",
    september: "09",
    oct: "10",
    october: "10",
    nov: "11",
    november: "11",
    dec: "12",
    december: "12",
  };

  const iso = trimmed.match(/(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/);
  if (iso) {
    return [iso[1], iso[2].padStart(2, "0"), iso[3].padStart(2, "0")].join("-");
  }

  const european = trimmed.match(/(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})/);
  if (european) {
    const year = european[3].length === 2 ? `20${european[3]}` : european[3];
    return [year, european[2].padStart(2, "0"), european[1].padStart(2, "0")].join("-");
  }

  const monthDayYear = trimmed.match(/([A-Za-z]+)\s+(\d{1,2}),?\s+(\d{4})/);
  if (monthDayYear) {
    const month = monthNames[monthDayYear[1].toLowerCase()];
    if (month) {
      return [monthDayYear[3], month, monthDayYear[2].padStart(2, "0")].join("-");
    }
  }

  const dayMonthYear = trimmed.match(/(\d{1,2})\s+([A-Za-z]+)\s+(\d{4})/);
  if (dayMonthYear) {
    const month = monthNames[dayMonthYear[2].toLowerCase()];
    if (month) {
      return [dayMonthYear[3], month, dayMonthYear[1].padStart(2, "0")].join("-");
    }
  }

  const date = new Date(trimmed);
  if (!Number.isNaN(date.valueOf())) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");
    return [year, month, day].join("-");
  }

  return trimmed;
}

export function parseDate(text: string, patterns: RegExp[]) {
  const value = firstMatch(text, patterns);
  if (!value) return "";

  const normalized = normalizeDate(value);
  return isValidIsoDate(normalized) ? normalized : "";
}

function isValidIsoDate(value: string) {
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return false;

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));

  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

export function parseVat(text: string, fallbackPatterns: RegExp[] = []) {
  return firstMatch(text, [
    /VAT(?:\s*(?:ID|No\.?|Number))?\s*[:#]?\s*([A-Z]{2}[A-Z0-9]{7,14})/i,
    /Tax\s+ID\s*[:#]?\s*([A-Z]{2}[A-Z0-9]{7,14})/i,
    /USt-IdNr\.?\s*[:#]?\s*([A-Z]{2}[A-Z0-9]{7,14})/i,
    ...fallbackPatterns,
  ]);
}

export function completeResult(
  supplier: SupportedSupplier,
  text: string,
  fields: Partial<InvoiceFields>,
  confidence = 0.75,
) {
  const invoice = {
    supplier,
    currency: fields.currency || parseCurrency(text),
    invoice_number: fields.invoice_number || "",
    invoice_date: fields.invoice_date || "",
    net_amount: fields.net_amount ?? null,
    tax_amount: fields.tax_amount ?? null,
    total_amount: fields.total_amount ?? null,
    supplier_vat: fields.supplier_vat || parseVat(text),
  };

  const missing = Object.entries(invoice)
    .filter(([key, value]) => key !== "supplier" && key !== "tax_amount" && (value === "" || value === null))
    .map(([key]) => key);

  return {
    supplier,
    confidence: missing.length ? Math.max(0.4, confidence - missing.length * 0.08) : confidence,
    fields: invoice,
    warnings: missing.map((key) => `Campo da verificare: ${key}`),
  };
}
