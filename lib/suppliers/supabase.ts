import type { SupplierParser } from "@/lib/types";
import { completeResult, firstAmount, firstMatch, includesAny, parseDate } from "./common";

export const supabaseParser: SupplierParser = {
  supplier: "Supabase",
  detect(text) {
    return includesAny(text, ["Supabase", "supabase.com", "Supabase Inc"]);
  },
  parse(text) {
    return completeResult("Supabase", text, {
      invoice_number: firstMatch(text, [
        /Invoice\s+(?:number|#)\s*[:#]?\s*([A-Z0-9-]+)/i,
        /Receipt\s+(?:number|#)\s*[:#]?\s*([A-Z0-9-]+)/i,
      ]),
      invoice_date: parseDate(text, [
        /Invoice\s+date\s*[:#]?\s*([A-Za-z]+\s+\d{1,2},?\s+\d{4})/i,
        /Date\s*[:#]?\s*(\d{4}[-/.]\d{1,2}[-/.]\d{1,2})/i,
      ]),
      supplier_vat: firstMatch(text, [
        /Singapore\s+GST\s+(?:No\.?|Number)\s*[:#]?\s*((?:SG)?\d{9}[A-Z])\b/i,
      ]),
      net_amount: firstAmount(text, [
        /Subtotal\s*[:#]?\s*((?:€|\$|£|EUR|USD|GBP)?\s?-?[\d,.]+)/i,
        /Net\s+amount\s*[:#]?\s*((?:€|\$|£|EUR|USD|GBP)?\s?-?[\d,.]+)/i,
      ]),
      tax_amount: firstAmount(text, [
        /^\s*(?:Tax|VAT|GST)(?:\s*\([\d.,]+\s*%\))?\s*[:#]?\s*((?:€|\$|£|EUR|USD|GBP)?\s?-?[\d,.]+)/im,
      ]),
      total_amount: firstAmount(text, [
        /^\s*Total(?:\s+due)?\s*[:#]?\s*((?:€|\$|£|EUR|USD|GBP)?\s?-?[\d,.]+)/im,
        /^\s*Amount\s+(?:due|paid)\s*[:#]?\s*((?:€|\$|£|EUR|USD|GBP)?\s?-?[\d,.]+)/im,
      ]),
    });
  },
};
