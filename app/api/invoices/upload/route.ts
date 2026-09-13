import { parseInvoicePdf } from "@/lib/invoice-parser";

export const maxDuration = 60;

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
      return parseInvoicePdf(buffer, file.name);
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
