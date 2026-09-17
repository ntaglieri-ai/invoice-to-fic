import type { InvoiceFields } from "@/lib/types";

export type ExpenseOptions = {
  supplierId: number;
  taxDeductibility: number;
  vatDeductibility: number;
  dueDate: string;
};

export type ExpensePreparationOptions = Omit<ExpenseOptions, "taxDeductibility" | "vatDeductibility"> & {
  taxDeductibility: number | null;
  vatDeductibility: number | null;
};

export type PreparedExpense = {
  companyId: number;
  options: ExpensePreparationOptions;
  status: "ready" | "needs_configuration";
};

export type FicSupplier = { id: number; name: string; vat_number?: string };

export type ExpensePreview = {
  ticket: string | null;
  status: "ready" | "needs_configuration";
  companyName: string;
  supplier: FicSupplier;
  invoice: InvoiceFields;
  options: ExpensePreparationOptions;
  expiresAt: number;
};

export function isValidInvoiceDate(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

export function invoiceErrors(value: unknown): string[] {
  if (!value || typeof value !== "object") return ["Fattura non valida."];
  const invoice = value as InvoiceFields;
  const errors: string[] = [];
  if (!["OpenAI", "Anthropic", "Vercel", "Hetzner", "Supabase"].includes(invoice.supplier)) errors.push("Fornitore non riconosciuto.");
  if (typeof invoice.invoice_number !== "string" || !invoice.invoice_number.trim() || invoice.invoice_number.length > 100 || /[\x00-\x1f]/.test(invoice.invoice_number)) errors.push("Numero fattura non valido.");
  if (!isValidInvoiceDate(invoice.invoice_date)) errors.push("Data fattura non valida.");
  if (typeof invoice.currency !== "string" || !/^[A-Z]{3}$/.test(invoice.currency)) errors.push("Valuta non valida.");
  if (typeof invoice.supplier_vat !== "string" || invoice.supplier_vat.length > 50) errors.push("VAT fornitore non valido.");
  const amounts = [invoice.net_amount, invoice.tax_amount, invoice.total_amount];
  if (amounts.some((amount) => typeof amount !== "number" || !Number.isFinite(amount) || amount < 0 || amount > 1e9 || Math.abs(amount * 100 - Math.round(amount * 100)) > 0.0001)) {
    errors.push("Importi non validi: usa valori positivi con al massimo due decimali.");
  } else if (Math.round(invoice.net_amount! * 100) + Math.round(invoice.tax_amount! * 100) !== Math.round(invoice.total_amount! * 100)) {
    errors.push("Imponibile e IVA non corrispondono al totale.");
  }
  return errors;
}

export function validateExpensePreparation(invoice: unknown, options: unknown): asserts invoice is InvoiceFields {
  const errors = invoiceErrors(invoice);
  const fields = invoice as InvoiceFields | null;
  if (fields?.currency !== "EUR") errors.push("La creazione spese supporta per ora solo EUR.");
  const settings = options as ExpensePreparationOptions | null;
  if (!settings || !Number.isSafeInteger(settings.supplierId) || settings.supplierId <= 0) errors.push("Seleziona un fornitore FIC.");
  for (const value of [settings?.taxDeductibility, settings?.vatDeductibility]) {
    if (value !== null && (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > 100)) errors.push("Indica deducibilita e detraibilita tra 0 e 100, oppure lascia i dati da confermare.");
  }
  if (!isValidInvoiceDate(settings?.dueDate)) errors.push("Scadenza non valida.");
  if (errors.length) throw new Error(errors.join(" "));
}

export function hasExpenseTaxSettings(options: ExpensePreparationOptions): options is ExpenseOptions {
  return [options.taxDeductibility, options.vatDeductibility].every((value) => typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 100);
}

export function validateExpense(invoice: unknown, options: unknown): asserts invoice is InvoiceFields {
  validateExpensePreparation(invoice, options);
  if (!hasExpenseTaxSettings(options as ExpensePreparationOptions)) {
    throw new Error("Impostazioni fiscali da confermare prima della registrazione in FIC.");
  }
}

export function normalizeIdentifier(value: string) {
  return value.trim().toUpperCase().replace(/\s+/g, "");
}

export function buildExpensePayload(invoice: InvoiceFields, options: ExpenseOptions, supplier: FicSupplier) {
  validateExpense(invoice, options);
  return {
    type: "expense" as const,
    entity: { id: supplier.id, name: supplier.name },
    invoice_number: invoice.invoice_number.trim(),
    date: invoice.invoice_date,
    description: `${invoice.supplier} - ${invoice.invoice_number.trim()}`,
    currency: { id: "EUR", exchange_rate: "1.00000" },
    amount_net: invoice.net_amount,
    amount_vat: invoice.tax_amount,
    is_detailed: false,
    is_marked: true,
    tax_deductibility: options.taxDeductibility,
    vat_deductibility: options.vatDeductibility,
    payments_list: [{ amount: invoice.total_amount, due_date: options.dueDate, status: "not_paid" }],
  };
}
