import { parseInvoicePdf } from "@/lib/invoice-parser";
import type { ParsedInvoice } from "@/lib/types";

export const maxDuration = 60;

let failedParseIndex = -1;

export async function POST(request: Request) {
  const formData = await request.formData();
  const files = formData
    .getAll("files")
    .filter((value): value is File => value instanceof File && value.type === "application/pdf");

  if (files.length === 0) {
    return Response.json({ error: "Carica almeno un PDF valido." }, { status: 400 });
  }

  const invoices = await Promise.all(
    files.map(async (file) => {
      const buffer = Buffer.from(await file.arrayBuffer());
      try {
        return await parseInvoicePdf(buffer, file.name);
      } catch (error) {
        return buildFailedInvoice(file.name, error);
      }
    }),
  );

  const seen = new Map<string, number>();
  const enriched = invoices.map((invoice) => {
    const duplicateKey = invoice.invoice.supplier && invoice.invoice.invoice_number
      ? `${invoice.invoice.supplier.toLowerCase()}::${invoice.invoice.invoice_number.toLowerCase()}`
      : "";

    const duplicateIndex = duplicateKey ? seen.get(duplicateKey) : undefined;
    if (duplicateKey) {
      seen.set(duplicateKey, invoice.index);
    }

    return {
      ...invoice,
      duplicate_of: duplicateIndex,
      status: duplicateIndex !== undefined ? "duplicate" : invoice.status,
    };
  });

  return Response.json({ invoices: enriched });
}

function buildFailedInvoice(fileName: string, error: unknown): ParsedInvoice {
  failedParseIndex -= 1;
  const message = error instanceof Error ? error.message : "Errore sconosciuto durante la lettura del PDF.";

  return {
    index: failedParseIndex,
    file_name: fileName,
    invoice: {
      supplier: "Sconosciuto",
      invoice_number: "",
      invoice_date: "",
      currency: "EUR",
      net_amount: null,
      tax_amount: null,
      total_amount: null,
      supplier_vat: "",
    },
    status: "needs_review",
    confidence: 0,
    extracted_text_preview: "",
    warnings: [`PDF non leggibile automaticamente: ${message}`],
  };
}
