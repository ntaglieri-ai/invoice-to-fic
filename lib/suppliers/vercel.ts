import type { SupplierParser } from "@/lib/types";
import { completeResult, firstAmount, firstMatch, includesAny, parseDate } from "./common";

export const vercelParser: SupplierParser = {
  supplier: "Vercel",
  detect(text) {
    return includesAny(text, ["Vercel", "vercel.com", "Vercel Inc"]);
  },
  parse(text) {
    return completeResult("Vercel", text, {
      invoice_number: firstMatch(text, [
        /Invoice\s+(?:number|#)\s*[:#]?\s*([A-Z0-9-]+)/i,
        /Invoice\s*([A-Z0-9-]{6,})/i,
      ]),
      invoice_date: parseDate(text, [
        /Invoice\s+date\s*[:#]?\s*([A-Za-z]+\s+\d{1,2},?\s+\d{4})/i,
        /Date\s*[:#]?\s*(\d{4}[-/.]\d{1,2}[-/.]\d{1,2})/i,
      ]),
      net_amount: firstAmount(text, [
        /Subtotal\s*[:#]?\s*((?:€|\$|£|EUR|USD|GBP)?\s?-?[\d,.]+)/i,
        /Amount\s+due\s+before\s+tax\s*[:#]?\s*((?:€|\$|£|EUR|USD|GBP)?\s?-?[\d,.]+)/i,
      ]),
      tax_amount: firstAmount(text, [
        /Tax\s*[:#]?\s*((?:€|\$|£|EUR|USD|GBP)?\s?-?[\d,.]+)/i,
        /VAT\s*[:#]?\s*((?:€|\$|£|EUR|USD|GBP)?\s?-?[\d,.]+)/i,
      ]),
      total_amount: firstAmount(text, [
        /Total\s*[:#]?\s*((?:€|\$|£|EUR|USD|GBP)?\s?-?[\d,.]+)/i,
        /Amount\s+due\s*[:#]?\s*((?:€|\$|£|EUR|USD|GBP)?\s?-?[\d,.]+)/i,
      ]),
    });
  },
};
