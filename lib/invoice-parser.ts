import { PDFParse } from "pdf-parse";
import { EMPTY_INVOICE, completeResult, firstAmount, firstMatch, parseCurrency, parseDate, parseVat } from "@/lib/suppliers/common";
import { supplierParsers } from "@/lib/suppliers";
import type { ParsedInvoice, SupplierParserResult } from "@/lib/types";

let parseIndex = 0;

export async function extractTextFromPdf(buffer: Buffer) {
  const parser = new PDFParse({ data: new Uint8Array(buffer) });
  try {
    const result = await parser.getText();
    return result.text.replace(/\u00a0/g, " ").trim();
  } finally {
    await parser.destroy();
  }
}

export async function parseInvoicePdf(buffer: Buffer, fileName: string): Promise<ParsedInvoice> {
  const text = await extractTextFromPdf(buffer);
  return parseInvoiceText(text, fileName);
}

export function parseInvoiceText(text: string, fileName = "invoice.pdf"): ParsedInvoice {
  const index = parseIndex++;
  const parser = supplierParsers.find((candidate) => candidate.detect(text));
  const parsed = parser ? parser.parse(text) : parseGenericInvoice(text);
  const invoice = {
    ...EMPTY_INVOICE,
    ...parsed.fields,
    supplier: parsed.supplier,
    currency: parsed.fields.currency || parseCurrency(text),
  };

  const warnings = [...(parsed.warnings ?? [])];
  if (invoice.total_amount !== null && invoice.net_amount !== null && invoice.tax_amount === null) {
    invoice.tax_amount = Math.round((invoice.total_amount - invoice.net_amount) * 100) / 100;
  }

  if (invoice.total_amount === null && invoice.net_amount !== null && invoice.tax_amount !== null) {
    invoice.total_amount = Math.round((invoice.net_amount + invoice.tax_amount) * 100) / 100;
  }

  if (invoice.supplier === "Sconosciuto") warnings.push("Fornitore non riconosciuto automaticamente.");
  if (!invoice.invoice_number) warnings.push("Numero fattura mancante o incerto.");
  if (!invoice.invoice_date) warnings.push("Data fattura mancante o incerta.");
  if (invoice.total_amount === null) warnings.push("Totale fattura mancante o incerto.");

  return {
    index,
    file_name: fileName,
    invoice,
    status: warnings.length ? "needs_review" : "extracted",
    confidence: parsed.confidence,
    extracted_text_preview: text.slice(0, 900),
    warnings: [...new Set(warnings)],
  };
}

function parseGenericInvoice(text: string): SupplierParserResult {
  return completeResult("Sconosciuto", text, {
    invoice_number: firstMatch(text, [
      /Invoice\s+(?:number|No\.?|#)\s*[:#]?\s*([A-Z0-9-]+)/i,
      /Receipt\s+(?:number|#)\s*[:#]?\s*([A-Z0-9-]+)/i,
    ]),
    invoice_date: parseDate(text, [
      /Invoice\s+date\s*[:#]?\s*([A-Za-z]+\s+\d{1,2},?\s+\d{4})/i,
      /Invoice\s+date\s*[:#]?\s*(\d{1,2}[-/.]\d{1,2}[-/.]\d{2,4})/i,
      /Date\s*[:#]?\s*(\d{4}[-/.]\d{1,2}[-/.]\d{1,2})/i,
    ]),
    currency: parseCurrency(text),
    net_amount: firstAmount(text, [
      /Subtotal\s*[:#]?\s*([€$£]?\s?-?[\d,.]+)/i,
      /Net\s+amount\s*[:#]?\s*([€$£]?\s?-?[\d,.]+)/i,
      /Amount\s+excluding\s+tax\s*[:#]?\s*([€$£]?\s?-?[\d,.]+)/i,
    ]),
    tax_amount: firstAmount(text, [
      /VAT\s*[:#]?\s*([€$£]?\s?-?[\d,.]+)/i,
      /Tax\s*[:#]?\s*([€$£]?\s?-?[\d,.]+)/i,
    ]),
    total_amount: firstAmount(text, [
      /Total\s*[:#]?\s*([€$£]?\s?-?[\d,.]+)/i,
      /Amount\s+paid\s*[:#]?\s*([€$£]?\s?-?[\d,.]+)/i,
      /Amount\s+due\s*[:#]?\s*([€$£]?\s?-?[\d,.]+)/i,
    ]),
    supplier_vat: parseVat(text),
  }, 0.45);
}
