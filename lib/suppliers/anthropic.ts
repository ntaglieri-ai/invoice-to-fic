import type { SupplierParser } from "@/lib/types";
import { completeResult, firstAmount, firstMatch, includesAny, parseDate } from "./common";

export const anthropicParser: SupplierParser = {
  supplier: "Anthropic",
  detect(text) {
    return includesAny(text, ["Anthropic", "anthropic.com", "Claude"]);
  },
  parse(text) {
    text = text.replace(/\u0000/g, "-");
    return completeResult("Anthropic", text, {
      supplier_vat: firstMatch(text.split(/\bBill\s+to\b/i)[0], [
        /\bVAT\s*(?:Registration\s*EU\s*VAT)?\s*[-:]?\s*(IE\d{7}[A-Z]{1,2})\b/i,
      ]),
      invoice_number: firstMatch(text, [
        /Invoice\s+(?:number|#)\s*[:#]?\s*([A-Z0-9-]+)/i,
        /Number\s*[:#]?\s*([A-Z0-9-]{5,})/i,
      ]),
      invoice_date: parseDate(text, [
        /Date\s+of\s+issue\s*[:#]?\s*([A-Za-z]+\s+\d{1,2},?\s+\d{4})/i,
        /Invoice\s+date\s*[:#]?\s*([A-Za-z]+\s+\d{1,2},?\s+\d{4})/i,
        /Date\s*[:#]?\s*(\d{1,2}[-/.]\d{1,2}[-/.]\d{2,4})/i,
      ]),
      net_amount: firstAmount(text, [
        /Subtotal\s*[:#]?\s*((?:€|\$|£|EUR|USD|GBP)?\s?-?[\d,.]+)/i,
        /Net\s+amount\s*[:#]?\s*((?:€|\$|£|EUR|USD|GBP)?\s?-?[\d,.]+)/i,
      ]),
      tax_amount: firstAmount(text, [
        /Tax\s*[:#]?\s*((?:€|\$|£|EUR|USD|GBP)?\s?-?[\d,.]+)/i,
        /VAT\s*[:#]?\s*((?:€|\$|£|EUR|USD|GBP)?\s?-?[\d,.]+)/i,
      ]),
      total_amount: firstAmount(text, [
        /Total\s*[:#]?\s*((?:€|\$|£|EUR|USD|GBP)?\s?-?[\d,.]+)/i,
        /Amount\s+paid\s*[:#]?\s*((?:€|\$|£|EUR|USD|GBP)?\s?-?[\d,.]+)/i,
      ]),
    });
  },
};
