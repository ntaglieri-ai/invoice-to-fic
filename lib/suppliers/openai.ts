import type { SupplierParser } from "@/lib/types";
import { cleanToken, completeResult, firstAmount, firstMatch, includesAny, parseDate } from "./common";

export const openAiParser: SupplierParser = {
  supplier: "OpenAI",
  detect(text) {
    return includesAny(text, ["OpenAI", "OpenAI, L.L.C.", "openai.com"]);
  },
  parse(text) {
    return completeResult("OpenAI", text, {
      invoice_number: parseOpenAiInvoiceNumber(text),
      invoice_date: parseDate(text, [
        /Date\s+of\s+issue\s*[:#]?\s*([A-Za-z]+\s+\d{1,2},?\s+\d{4})/i,
        /Invoice\s+date\s*[:#]?\s*([A-Za-z]+\s+\d{1,2},?\s+\d{4})/i,
        /Date\s+paid\s*[:#]?\s*([A-Za-z]+\s+\d{1,2},?\s+\d{4})/i,
        /Date\s*[:#]?\s*(\d{4}[-/.]\d{1,2}[-/.]\d{1,2})/i,
      ]),
      net_amount: firstAmount(text, [
        /Subtotal\s*[:#]?\s*((?:€|\$|£|EUR|USD|GBP)?\s?-?[\d,.]+)/i,
        /Amount\s+excluding\s+tax\s*[:#]?\s*((?:€|\$|£|EUR|USD|GBP)?\s?-?[\d,.]+)/i,
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

function parseOpenAiInvoiceNumber(text: string) {
  const invoiceNumber = firstMatch(text, [
    /Invoice\s+number\s*[:#]?\s*([A-Z0-9]+(?:\s*(?:-|\u0000)\s*[A-Z0-9]+)*)/i,
    /Invoice\s+#\s*([A-Z0-9]+(?:\s*(?:-|\u0000)\s*[A-Z0-9]+)*)/i,
    /Receipt\s+(?:number|#)\s*[:#]?\s*([A-Z0-9]+(?:\s*(?:-|\u0000)\s*[A-Z0-9]+)*)/i,
  ]);

  return cleanToken(invoiceNumber).replace(/\s*(?:-|\u0000)\s*/g, "-");
}
