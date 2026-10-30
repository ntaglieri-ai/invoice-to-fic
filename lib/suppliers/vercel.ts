import type { SupplierParser } from "@/lib/types";
import { completeResult, firstAmount, firstMatch, includesAny, parseDate } from "./common";

export const vercelParser: SupplierParser = {
  supplier: "Vercel",
  detect(text) {
    return includesAny(text, ["Vercel", "vercel.com", "Vercel Inc"]);
  },
  parse(text) {
    text = text.replace(/(Invoice\s+number\s*[:#]?\s*[A-Z0-9]+)\u0000(?=\d+\b)/i, "$1-").replace(/\u0000/g, " ");
    return completeResult("Vercel", text, {
      invoice_number: firstMatch(text, [
        /Invoice\s+(?:number|#)\s*[:#]?\s*([A-Z0-9-]+)/i,
        /Invoice\s*([A-Z0-9-]{6,})/i,
      ]),
      invoice_date: parseDate(text, [
        /Date\s+of\s+issue\s*[:#]?\s*([A-Za-z]+\s+\d{1,2},?\s+\d{4})/i,
        /Invoice\s+date\s*[:#]?\s*([A-Za-z]+\s+\d{1,2},?\s+\d{4})/i,
        /Date\s*[:#]?\s*(\d{4}[-/.]\d{1,2}[-/.]\d{1,2})/i,
      ]),
      supplier_vat: firstMatch(text, [/Vercel\s+VAT\s+ID\s*[:#]?\s*([A-Z]{2}[A-Z0-9]{7,14})\b/i]),
      net_amount: firstAmount(text, [
        /Subtotal\s*[:#]?\s*((?:€|\$|£|EUR|USD|GBP)?\s?-?[\d,.]+)/i,
        /Amount\s+due\s+before\s+tax\s*[:#]?\s*((?:€|\$|£|EUR|USD|GBP)?\s?-?[\d,.]+)/i,
      ]),
      tax_amount: firstAmount(text, [
        /^\s*Standard\s+Rate[^\n]*?%\s+on\s*(?:€|\$|£|EUR|USD|GBP)?\s*[\d,.]+\s+((?:€|\$|£|EUR|USD|GBP)?\s?[\d,.]+)\s*$/im,
        /^\s*(?:Tax|VAT)(?:\s*\([\d.,]+\s*%\))?\s*[:#]?\s*((?:€|\$|£|EUR|USD|GBP)?\s?-?[\d,.]+)/im,
      ]),
      total_amount: firstAmount(text, [
        /^\s*Total\s*[:#]?\s*((?:€|\$|£|EUR|USD|GBP)?\s?-?[\d,.]+)/im,
        /^\s*Amount\s+due\s*[:#]?\s*((?:€|\$|£|EUR|USD|GBP)?\s?-?[\d,.]+)/im,
      ]),
    });
  },
};
