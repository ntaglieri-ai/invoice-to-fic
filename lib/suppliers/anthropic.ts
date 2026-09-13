import type { SupplierParser } from "@/lib/types";
import { completeResult, firstAmount, firstMatch, includesAny, parseDate } from "./common";

export const anthropicParser: SupplierParser = {
  supplier: "Anthropic",
  detect(text) {
    return includesAny(text, ["Anthropic", "anthropic.com", "Claude"]);
  },
  parse(text) {
    return completeResult("Anthropic", text, {
      invoice_number: firstMatch(text, [
        /Invoice\s+(?:number|#)\s*[:#]?\s*([A-Z0-9-]+)/i,
        /Number\s*[:#]?\s*([A-Z0-9-]{5,})/i,
      ]),
      invoice_date: parseDate(text, [
        /Invoice\s+date\s*[:#]?\s*([A-Za-z]+\s+\d{1,2},?\s+\d{4})/i,
        /Date\s*[:#]?\s*(\d{1,2}[-/.]\d{1,2}[-/.]\d{2,4})/i,
      ]),
      net_amount: firstAmount(text, [
        /Subtotal\s*[:#]?\s*([€$£]?\s?-?[\d,.]+)/i,
        /Net\s+amount\s*[:#]?\s*([€$£]?\s?-?[\d,.]+)/i,
      ]),
      tax_amount: firstAmount(text, [
        /Tax\s*[:#]?\s*([€$£]?\s?-?[\d,.]+)/i,
        /VAT\s*[:#]?\s*([€$£]?\s?-?[\d,.]+)/i,
      ]),
      total_amount: firstAmount(text, [
        /Total\s*[:#]?\s*([€$£]?\s?-?[\d,.]+)/i,
        /Amount\s+paid\s*[:#]?\s*([€$£]?\s?-?[\d,.]+)/i,
      ]),
    });
  },
};
