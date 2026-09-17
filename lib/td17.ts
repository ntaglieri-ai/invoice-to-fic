import type { InvoiceFields } from "@/lib/types";
import { EXPENSE_COST_CENTER, invoiceErrors, isValidInvoiceDate, normalizeIdentifier, type FicSupplier } from "@/lib/expense-validation";

export type Td17Options = { supplierId: number; documentDate: string; vatId: number; numeration: string; paymentMethod: string };
export type Td17Supplier = FicSupplier & { vat_number: string; country: string; address_street: string; address_city: string; address_postal_code: string; address_province?: string; address_extra?: string };
export type Td17Vat = { id: number; value: number; description?: string; e_invoice?: boolean; is_disabled?: boolean; ei_type?: string };
export type Td17Result = { id: number; number?: number; numeration?: string; alreadyExists: boolean; eiStatus: string; xmlValid: boolean | null; warning?: string };
export type Td17Preview = {
  ticket: string; companyName: string; expenseId: number; supplier: Td17Supplier;
  options: Td17Options; vat: Td17Vat; net: number; tax: number; total: number;
};

export function validateTd17(invoice: InvoiceFields, options: Td17Options) {
  const errors = invoiceErrors(invoice);
  if (invoice.currency !== "EUR") errors.push("TD17 disponibile solo per fatture in EUR.");
  if (invoice.tax_amount !== 0 || !invoice.net_amount || invoice.net_amount <= 0) errors.push("TD17 automatico disponibile solo per servizi con imponibile positivo e senza IVA addebitata.");
  if (!invoice.supplier_vat?.trim() || normalizeIdentifier(invoice.supplier_vat).startsWith("IT")) errors.push("Serve il VAT/Tax ID estero del fornitore.");
  if (invoice.invoice_number?.trim().length > 20) errors.push("Il riferimento XML ammette al massimo 20 caratteri: verifica la fattura in FIC senza troncare il numero.");
  if (!options || !Number.isSafeInteger(options.supplierId) || options.supplierId <= 0) errors.push("Seleziona un fornitore.");
  if (!isValidInvoiceDate(options?.documentDate)) errors.push("Data TD17 non valida.");
  if (!Number.isSafeInteger(options?.vatId) || options.vatId < 0) errors.push("Seleziona l'aliquota IVA.");
  if (typeof options?.numeration !== "string" || !/^\/[A-Za-z0-9-]{1,10}$/.test(options.numeration)) errors.push("Sezionale non valido (esempio /TD17).");
  if (!/^MP(0[1-9]|1[0-9]|2[0-3])$/.test(options?.paymentMethod ?? "")) errors.push("Metodo di pagamento non valido.");
  if (errors.length) throw new Error(errors.join(" "));
}

export function eligibleTd17Vat(vat: Td17Vat) {
  return Number.isSafeInteger(vat.id) && vat.id >= 0 && Number.isFinite(vat.value) && vat.value > 0 && vat.value <= 100 && vat.e_invoice === true && vat.is_disabled !== true && (!vat.ei_type || vat.ei_type === "0");
}

export function td17Amounts(net: number, rate: number) {
  const cents = Math.round(net * 100);
  const taxCents = Math.round(cents * rate / 100);
  return { net: cents / 100, tax: taxCents / 100, total: (cents + taxCents) / 100 };
}

export function validateTd17Supplier(invoice: InvoiceFields, supplier: Td17Supplier) {
  if (!supplier || !supplier.name?.trim() || !supplier.country?.trim() || ["ITALIA", "ITALY", "IT"].includes(normalizeIdentifier(supplier.country)) ||
    !supplier.vat_number?.trim() || normalizeIdentifier(supplier.vat_number).startsWith("IT") || normalizeIdentifier(supplier.vat_number) !== normalizeIdentifier(invoice.supplier_vat) ||
    !supplier.address_street?.trim() || !supplier.address_city?.trim()) {
    throw new Error("Completa in FIC l'anagrafica estera del fornitore (VAT/Tax ID coincidente, paese, indirizzo e citta), poi riprova.");
  }
}

export function buildTd17Payload(invoice: InvoiceFields, options: Td17Options, supplier: Td17Supplier, vat: Td17Vat, reference: string) {
  validateTd17(invoice, options);
  validateTd17Supplier(invoice, supplier);
  if (vat.id !== options.vatId || !eligibleTd17Vat(vat)) throw new Error("Aliquota IVA non utilizzabile per il TD17.");
  const amounts = td17Amounts(invoice.net_amount!, vat.value);
  return {
    type: "self_supplier_invoice" as const,
    entity: supplier,
    date: options.documentDate,
    year: Number(options.documentDate.slice(0, 4)),
    numeration: options.numeration,
    currency: { id: "EUR", exchange_rate: "1.00000" },
    subject: reference,
    visible_subject: `TD17 - ${invoice.supplier} - ${invoice.invoice_number}`,
    rc_center: EXPENSE_COST_CENTER,
    e_invoice: true,
    use_gross_prices: false,
    use_split_payment: false,
    rivalsa: 0, cassa: 0, cassa2: 0, withholding_tax: 0, other_withholding_tax: 0, stamp_duty: 0, amount_due_discount: 0,
    ei_data: { vat_kind: "I", payment_method: options.paymentMethod },
    items_list: [{ name: `Servizi SaaS ${invoice.supplier}`, description: `Fattura ${invoice.invoice_number} del ${invoice.invoice_date}`, qty: 1, net_price: amounts.net, vat: { id: vat.id } }],
    payments_list: [{ amount: amounts.total, due_date: options.documentDate, status: "reversed" }],
    ei_raw: {
      FatturaElettronicaHeader: { CedentePrestatore: { DatiAnagrafici: { RegimeFiscale: "RF01" } } },
      FatturaElettronicaBody: { DatiGenerali: {
        DatiGeneraliDocumento: { TipoDocumento: "TD17" },
        DatiFattureCollegate: [{ IdDocumento: invoice.invoice_number.trim(), Data: invoice.invoice_date }],
      } },
    },
  };
}
