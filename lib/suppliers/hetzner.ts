import type { SupplierParser } from "@/lib/types";
import { completeResult, firstAmount, firstMatch, includesAny, parseDate } from "./common";

export const hetznerParser: SupplierParser = {
  supplier: "Hetzner",
  detect(text) {
    return includesAny(text, ["Hetzner", "Hetzner Online", "hetzner.com"]);
  },
  parse(text) {
    return completeResult("Hetzner", text, {
      invoice_number: firstMatch(text, [
        /Invoice\s+(?:No\.?|number|#)\s*[:#]?\s*([A-Z0-9-]+)/i,
        /Rechnung\s+(?:Nr\.?|number)?\s*[:#]?\s*([A-Z0-9-]+)/i,
      ]),
      invoice_date: parseDate(text, [
        /Invoice\s+date\s*[:#]?\s*(\d{1,2}[-/.]\d{1,2}[-/.]\d{2,4})/i,
        /Rechnungsdatum\s*[:#]?\s*(\d{1,2}[-/.]\d{1,2}[-/.]\d{2,4})/i,
        /Date\s*[:#]?\s*(\d{4}[-/.]\d{1,2}[-/.]\d{1,2})/i,
      ]),
      net_amount: firstAmount(text, [
        /Net(?:\s+amount)?\s*[:#]?\s*([€$£]?\s?-?[\d,.]+)/i,
        /Zwischensumme\s*[:#]?\s*([€$£]?\s?-?[\d,.]+)/i,
        /Subtotal\s*[:#]?\s*([€$£]?\s?-?[\d,.]+)/i,
      ]),
      tax_amount: firstAmount(text, [
        /VAT\s*[:#]?\s*([€$£]?\s?-?[\d,.]+)/i,
        /MwSt\.?\s*[:#]?\s*([€$£]?\s?-?[\d,.]+)/i,
        /Tax\s*[:#]?\s*([€$£]?\s?-?[\d,.]+)/i,
      ]),
      total_amount: firstAmount(text, [
        /Total\s*[:#]?\s*([€$£]?\s?-?[\d,.]+)/i,
        /Gesamtbetrag\s*[:#]?\s*([€$£]?\s?-?[\d,.]+)/i,
      ]),
    });
  },
};
