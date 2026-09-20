import "server-only";
import { requireCustomerVat } from "@/lib/customer-vat";
import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { ficFetch } from "@/lib/fatture-in-cloud";
import { findExistingExpense, listAll, requireCompany } from "@/lib/fic-expenses";
import { normalizeIdentifier } from "@/lib/expense-validation";
import { buildTd17Payload, eligibleTd17Vat, td17Amounts, validateTd17, validateTd17Supplier, type Td17Options, type Td17Result, type Td17Supplier, type Td17Vat } from "@/lib/td17";
import type { InvoiceFields } from "@/lib/types";

type PreInfo = { vat_types_list?: Td17Vat[]; default_values?: { payment_method?: { ei_payment_method?: string } } };
type ExistingTd17 = {
  id: number; number?: number; numeration?: string; subject?: string; ei_status?: string;
  entity?: { id?: number; vat_number?: string };
  ei_data?: { invoice_number?: string; invoice_date?: string };
  ei_raw?: { FatturaElettronicaBody?: { DatiGenerali?: {
    DatiGeneraliDocumento?: { TipoDocumento?: string };
    DatiFattureCollegate?: { IdDocumento?: string; Data?: string }[];
  } } };
};
export type Td17Ticket = {
  companyId: number; expenseId: number; invoice: InvoiceFields; options: Td17Options;
  fingerprint: string; expiresAt: number; owner: string;
};

export async function td17Settings(token: string, companyId: number) {
  const response = await ficFetch<{ data?: PreInfo }>(token, `/c/${companyId}/issued_documents/info?type=self_supplier_invoice`);
  if (!Array.isArray(response.data?.vat_types_list)) throw new Error("Aliquote FIC non disponibili.");
  const vatTypes = response.data.vat_types_list.filter((vat) => vat && eligibleTd17Vat(vat));
  const warning = vatTypes.length ? undefined : "FIC non ha restituito aliquote IVA positive utilizzabili per il TD17. Verifica le aliquote in FIC; nessun documento creato.";
  if (warning) console.warn("[td17:vat-settings] No eligible VAT rates", {
    received: response.data.vat_types_list.length,
    positive: response.data.vat_types_list.filter((vat) => vat && Number.isFinite(vat.value) && vat.value > 0).length,
    explicitlyExcluded: response.data.vat_types_list.filter((vat) => vat && (vat.e_invoice === false || vat.is_disabled === true)).length,
  });
  return { vatTypes, warning, paymentMethod: response.data.default_values?.payment_method?.ei_payment_method ?? "MP08" };
}

async function td17Supplier(token: string, companyId: number, invoice: InvoiceFields, id: number): Promise<Td17Supplier> {
  const response = await ficFetch<{ data?: Td17Supplier }>(token, `/c/${companyId}/entities/suppliers/${id}?fieldset=detailed`);
  const data = response.data;
  if (!data || data.id !== id) throw new Error("Fornitore non disponibile nell'azienda.");
  validateTd17Supplier(invoice, data);
  // Copy only invoice entity fields, not supplier defaults or unrelated personal data.
  return { id, name: data.name, vat_number: data.vat_number, country: data.country,
    address_street: data.address_street, address_city: data.address_city,
    address_postal_code: "00000", address_province: "EE", address_extra: data.address_extra ?? "" };
}

function reference(companyId: number, invoice: InvoiceFields, supplier: Td17Supplier) {
  const identity = [companyId, normalizeIdentifier(supplier.vat_number), normalizeIdentifier(invoice.invoice_number), invoice.invoice_date];
  return `Invoice to FIC TD17 ${createHash("sha256").update(JSON.stringify(identity)).digest("hex")}`;
}

export async function findExistingTd17(token: string, companyId: number, invoice: InvoiceFields, supplier: Td17Supplier) {
  const documents = await listAll<ExistingTd17>(token, `/c/${companyId}/issued_documents?type=self_supplier_invoice&fields=id,number,numeration,subject,entity,ei_raw,ei_data,ei_status`);
  const marker = reference(companyId, invoice, supplier);
  return documents.find((doc) => {
    if (doc.subject === marker) return true;
    const sameSupplier = doc.entity?.id === supplier.id || Boolean(doc.entity?.vat_number && normalizeIdentifier(doc.entity.vat_number) === normalizeIdentifier(supplier.vat_number));
    const general = doc.ei_raw?.FatturaElettronicaBody?.DatiGenerali;
    if (!sameSupplier || general?.DatiGeneraliDocumento?.TipoDocumento !== "TD17") return false;
    const links = general.DatiFattureCollegate;
    const references = Array.isArray(links) ? links : [];
    return references.some((link) => normalizeIdentifier(link.IdDocumento ?? "") === normalizeIdentifier(invoice.invoice_number) && (!link.Data || link.Data === invoice.invoice_date)) ||
      (normalizeIdentifier(doc.ei_data?.invoice_number ?? "") === normalizeIdentifier(invoice.invoice_number) && (!doc.ei_data?.invoice_date || doc.ei_data.invoice_date === invoice.invoice_date));
  });
}

async function context(token: string, companyId: number, invoice: InvoiceFields, options: Td17Options) {
  validateTd17(invoice, options);
  const company = await requireCompany(token, companyId);
  requireCustomerVat(invoice, company.vat_number);
  const supplier = await td17Supplier(token, companyId, invoice, options.supplierId);
  const existingExpense = await findExistingExpense(token, companyId, invoice, supplier);
  if (!existingExpense) throw new Error("Registra prima la spesa in FIC. Il TD17 non crea una seconda spesa.");
  const expense = await ficFetch<{ data?: { id?: number; type?: string; invoice_number?: string; entity?: { id?: number; vat_number?: string }; date?: string; amount_net?: number; amount_vat?: number; currency?: { id?: string } } }>(token, `/c/${companyId}/received_documents/${existingExpense.id}?fieldset=detailed`);
  const sameSupplier = expense.data?.entity?.id === supplier.id || Boolean(expense.data?.entity?.vat_number && normalizeIdentifier(expense.data.entity.vat_number) === normalizeIdentifier(supplier.vat_number));
  if (!sameSupplier || expense.data?.id !== existingExpense.id || expense.data?.type !== "expense" || normalizeIdentifier(expense.data?.invoice_number ?? "") !== normalizeIdentifier(invoice.invoice_number) || expense.data?.date !== invoice.invoice_date || expense.data?.currency?.id !== "EUR" || expense.data?.amount_net !== invoice.net_amount || expense.data?.amount_vat !== 0) {
    throw new Error("La spesa in FIC non coincide con data, valuta o importi della fattura: verifica prima di preparare il TD17.");
  }
  const settings = await td17Settings(token, companyId);
  const vat = settings.vatTypes.find((item) => item.id === options.vatId);
  if (!vat) throw new Error("Aliquota non piu disponibile. Rigenera l'anteprima.");
  const payload = buildTd17Payload(invoice, options, supplier, vat, reference(companyId, invoice, supplier));
  const fingerprint = createHash("sha256").update(JSON.stringify({ payload, rate: vat.value, expenseId: existingExpense.id })).digest("hex");
  return { company, supplier, vat, payload, fingerprint, expenseId: existingExpense.id, ...td17Amounts(invoice.net_amount!, vat.value) };
}

function signature(payload: string) {
  if (!process.env.FIC_SESSION_SECRET) throw new Error("Configurazione FIC incompleta.");
  return createHmac("sha256", process.env.FIC_SESSION_SECRET).update(`td17-preview:${payload}`).digest();
}

export function signTd17Ticket(ticket: Td17Ticket) {
  const payload = Buffer.from(JSON.stringify(ticket)).toString("base64url");
  return `${payload}.${signature(payload).toString("base64url")}`;
}

export function readTd17Ticket(value: unknown, owner: string): Td17Ticket {
  if (typeof value !== "string" || value.length > 12000) throw new Error("Anteprima TD17 non valida.");
  const [payload, signed, extra] = value.split(".");
  if (!payload || !signed || extra) throw new Error("Anteprima TD17 non valida.");
  const expected = signature(payload), actual = Buffer.from(signed, "base64url");
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) throw new Error("Anteprima TD17 modificata.");
  const ticket = JSON.parse(Buffer.from(payload, "base64url").toString()) as Td17Ticket;
  if (ticket.owner !== owner || !Number.isFinite(ticket.expiresAt) || ticket.expiresAt <= Date.now()) throw new Error("Anteprima TD17 scaduta: rigenerala.");
  validateTd17(ticket.invoice, ticket.options);
  return ticket;
}

function existingResult(doc: ExistingTd17): Td17Result {
  return { id: doc.id, number: doc.number, numeration: doc.numeration, alreadyExists: true, eiStatus: doc.ei_status ?? "unknown", xmlValid: null };
}

export async function previewTd17(token: string, companyId: number, invoice: InvoiceFields, options: Td17Options, owner: string) {
  const data = await context(token, companyId, invoice, options);
  const duplicate = await findExistingTd17(token, companyId, invoice, data.supplier);
  if (duplicate) return { existing: existingResult(duplicate) };
  // This endpoint only calculates totals; it does not persist or transmit a document.
  const totals = await ficFetch<{ data?: { amount_net?: number; amount_vat?: number; amount_gross?: number } }>(token, `/c/${companyId}/issued_documents/totals`, { method: "POST", body: JSON.stringify({ data: data.payload }) });
  if (totals.data?.amount_net !== data.net || totals.data?.amount_vat !== data.tax || totals.data?.amount_gross !== data.total) throw new Error("Totali FIC non coincidenti: nessun TD17 creato.");
  const ticket = signTd17Ticket({ companyId, expenseId: data.expenseId, invoice, options, fingerprint: data.fingerprint, owner, expiresAt: Date.now() + 600000 });
  return { ticket, companyName: data.company.name, expenseId: data.expenseId, supplier: data.supplier, options, vat: data.vat, net: data.net, tax: data.tax, total: data.total };
}

const writes = new Map<string, number>();

export async function createTd17(token: string, ticket: Td17Ticket): Promise<Td17Result> {
  const { companyId, invoice, options } = ticket;
  const key = `${companyId}:${normalizeIdentifier(invoice.supplier_vat)}:${normalizeIdentifier(invoice.invoice_number)}:${invoice.invoice_date}`;
  for (const [id, expiry] of writes) if (expiry < Date.now()) writes.delete(id);
  if (writes.has(key)) throw new Error("Creazione TD17 gia avviata. Controlla le Autofatture in FIC; non ripetere la creazione.");
  writes.set(key, Date.now() + 86400000);
  let writeStarted = false;
  try {
    const data = await context(token, companyId, invoice, options);
    const duplicate = await findExistingTd17(token, companyId, invoice, data.supplier);
    if (duplicate) return existingResult(duplicate);
    if (data.expenseId !== ticket.expenseId || data.fingerprint !== ticket.fingerprint) throw new Error("Dati FIC cambiati dopo l'anteprima. Rigenera e conferma i nuovi dati.");
    writeStarted = true;
    const response = await ficFetch<{ data?: ExistingTd17 }>(token, `/c/${companyId}/issued_documents`, { method: "POST", body: JSON.stringify({ data: data.payload }) });
    if (!Number.isSafeInteger(response.data?.id) || response.data!.id <= 0) throw new Error("Identificativo TD17 non ricevuto.");
    const doc = response.data!;
    const result: Td17Result = { id: doc.id, number: doc.number, numeration: doc.numeration, alreadyExists: false, eiStatus: doc.ei_status ?? "unknown", xmlValid: null };
    try {
      const verification = await ficFetch<{ data?: { success?: boolean } }>(token, `/c/${companyId}/issued_documents/${doc.id}/e_invoice/xml_verify`);
      result.xmlValid = verification.data?.success === true;
      if (!result.xmlValid) result.warning = "TD17 salvato. Verifica formale non superata: correggilo in FIC prima dell'invio, senza ricrearlo.";
    } catch {
      result.warning = "TD17 salvato. Verifica XML non disponibile o non superata: esegui la Verifica formale in FIC prima dell'invio, senza ricrearlo.";
    }
    return result;
  } catch (error) {
    if (!writeStarted) { writes.delete(key); throw error; }
    throw new Error("Esito creazione TD17 non confermato. Controlla le Autofatture in FIC prima di riprovare. Nessun reinvio automatico e nessun invio SDI dall'app.");
  }
}
