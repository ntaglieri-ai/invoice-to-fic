import "server-only";
import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { ficFetch, listUserCompanies, type FattureInCloudCompany } from "@/lib/fatture-in-cloud";
import { buildExpensePayload, normalizeIdentifier, validateExpense, type ExpenseOptions, type FicSupplier } from "@/lib/expense-validation";
import type { InvoiceFields } from "@/lib/types";

type Page<T> = { data?: T[]; current_page?: number; last_page?: number };
type ExistingExpense = { id: number; invoice_number?: string; entity?: { id?: number; name?: string; vat_number?: string } };
export type ExpenseTicket = { companyId: number; invoice: InvoiceFields; options: ExpenseOptions; expiresAt: number; owner: string };

export { canWriteExpenses } from "@/lib/fic-permissions";

export async function requireCompany(token: string, companyId: number) {
  if (!Number.isSafeInteger(companyId) || companyId <= 0) throw new Error("Azienda non valida.");
  const flatten = (companies: FattureInCloudCompany[]): FattureInCloudCompany[] => companies.flatMap((company) => [company, ...flatten(company.controlled_companies ?? [])]);
  const company = flatten(await listUserCompanies(token)).find((company) => company.id === companyId && company.type !== "accountant");
  if (!company) throw new Error("Azienda non accessibile con questa connessione.");
  return company;
}

export async function listAll<T>(token: string, path: string): Promise<T[]> {
  const all: T[] = [];
  // Fail closed if pagination cannot be completed; a partial list cannot rule out duplicates.
  for (let page = 1; page <= 100; page++) {
    const separator = path.includes("?") ? "&" : "?";
    const result = await ficFetch<Page<T>>(token, `${path}${separator}per_page=100&page=${page}`);
    if (!Array.isArray(result.data) || !Number.isInteger(result.last_page) || result.last_page! < 1) throw new Error("Elenco FIC incompleto: impossibile verificare i duplicati.");
    all.push(...result.data);
    if (page >= result.last_page!) return all;
  }
  throw new Error("Troppi risultati FIC: controllo duplicati non completato.");
}

export function listExpenseSuppliers(token: string, companyId: number) {
  return listAll<FicSupplier>(token, `/c/${companyId}/entities/suppliers?fields=id,name,vat_number`);
}

export async function requireSupplier(token: string, companyId: number, invoice: InvoiceFields, options: Pick<ExpenseOptions, "supplierId">) {
  const suppliers = await listExpenseSuppliers(token, companyId);
  const supplier = suppliers.find((item) => item.id === options.supplierId);
  if (!supplier) throw new Error("Fornitore non presente nell'azienda selezionata.");
  if (invoice.supplier_vat && supplier.vat_number && normalizeIdentifier(invoice.supplier_vat) !== normalizeIdentifier(supplier.vat_number)) {
    throw new Error("Il VAT del fornitore selezionato non coincide con la fattura.");
  }
  return supplier;
}

export async function findExistingExpense(token: string, companyId: number, invoice: InvoiceFields, supplier: FicSupplier) {
  const documents = await listAll<ExistingExpense>(token, `/c/${companyId}/received_documents?type=expense&fields=id,invoice_number,entity`);
  return documents.find((document) => {
    const sameNumber = normalizeIdentifier(document.invoice_number ?? "") === normalizeIdentifier(invoice.invoice_number);
    const entity = document.entity;
    const sameSupplier = entity?.id === supplier.id ||
      Boolean(entity?.vat_number && supplier.vat_number && normalizeIdentifier(entity.vat_number) === normalizeIdentifier(supplier.vat_number)) ||
      Boolean(entity?.name && normalizeIdentifier(entity.name) === normalizeIdentifier(supplier.name));
    return sameNumber && sameSupplier;
  });
}

function signature(payload: string) {
  const key = process.env.FIC_SESSION_SECRET;
  if (!key) throw new Error("Configurazione FIC incompleta.");
  return createHmac("sha256", key).update(`expense-preview:${payload}`).digest();
}

export function ticketOwner(authCookie: string) {
  return createHash("sha256").update(authCookie).digest("hex");
}

export function signExpenseTicket(ticket: ExpenseTicket) {
  const payload = Buffer.from(JSON.stringify(ticket)).toString("base64url");
  return `${payload}.${signature(payload).toString("base64url")}`;
}

export function readExpenseTicket(value: unknown, owner: string): ExpenseTicket {
  if (typeof value !== "string" || value.length > 12000) throw new Error("Anteprima non valida.");
  const [payload, signed, extra] = value.split(".");
  if (!payload || !signed || extra) throw new Error("Anteprima non valida.");
  const actual = Buffer.from(signed, "base64url");
  const expected = signature(payload);
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) throw new Error("Anteprima modificata: rigenerala.");
  const ticket = JSON.parse(Buffer.from(payload, "base64url").toString()) as ExpenseTicket;
  if (ticket.owner !== owner || !Number.isFinite(ticket.expiresAt) || ticket.expiresAt <= Date.now()) throw new Error("Anteprima scaduta: rigenerala.");
  validateExpense(ticket.invoice, ticket.options);
  return ticket;
}

const activeWrites = new Map<string, number>();

export async function createReviewedExpense(token: string, ticket: ExpenseTicket) {
  const { companyId, invoice, options } = ticket;
  const key = `${companyId}:${options.supplierId}:${normalizeIdentifier(invoice.invoice_number)}`;
  const now = Date.now();
  for (const [id, expiry] of activeWrites) if (expiry < now) activeWrites.delete(id);
  if (activeWrites.has(key)) throw new Error("Invio gia avviato. Verifica la spesa in FIC prima di riprovare.");
  activeWrites.set(key, now + 24 * 60 * 60 * 1000);
  let writeStarted = false;
  try {
    await requireCompany(token, companyId);
    const supplier = await requireSupplier(token, companyId, invoice, options);
    const duplicate = await findExistingExpense(token, companyId, invoice, supplier);
    if (duplicate) return { id: duplicate.id, alreadyExists: true };
    writeStarted = true;
    const response = await ficFetch<{ data?: { id?: number } }>(token, `/c/${companyId}/received_documents`, {
      method: "POST",
      body: JSON.stringify({ data: buildExpensePayload(invoice, options, supplier) }),
    });
    if (!Number.isSafeInteger(response.data?.id)) throw new Error("Identificativo della spesa non ricevuto.");
    return { id: response.data!.id!, alreadyExists: false };
  } catch (error) {
    if (!writeStarted) activeWrites.delete(key);
    if (writeStarted) throw new Error("Esito invio non confermato. Controlla le Spese in Fatture in Cloud prima di riprovare; nessun reinvio automatico.");
    throw error;
  }
}
