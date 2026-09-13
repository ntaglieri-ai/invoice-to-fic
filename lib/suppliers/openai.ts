import type { SupplierParser } from "@/lib/types";
import { completeResult, firstAmount, firstMatch, includesAny, parseDate } from "./common";

export const openAiParser: SupplierParser = {
  supplier: "OpenAI",
  detect(text) {
    return includesAny(text, ["OpenAI", "OpenAI, L.L.C.", "openai.com"]);
  },
  parse(text) {
    return completeResult("OpenAI", text, {
      invoice_number: firstMatch(text, [
        /Invoice\s+(?:number|#)\s*[:#]?\s*([A-Z0-9-]+)/i,
        /Receipt\s+(?:number|#)\s*[:#]?\s*([A-Z0-9-]+)/i,
      ]),
      invoice_date: parseDate(text, [
        /Invoice\s+date\s*[:#]?\s*([A-Za-z]+\s+\d{1,2},?\s+\d{4})/i,
        /Date\s+paid\s*[:#]?\s*([A-Za-z]+\s+\d{1,2},?\s+\d{4})/i,
        /Date\s*[:#]?\s*(\d{4}[-/.]\d{1,2}[-/.]\d{1,2})/i,
      ]),
      net_amount: firstAmount(text, [
        /Subtotal\s*[:#]?\s*([€$£]?\s?-?[\d,.]+)/i,
        /Amount\s+excluding\s+tax\s*[:#]?\s*([€$£]?\s?-?[\d,.]+)/i,
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
