import "server-only";
import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { ficFetch } from "./fatture-in-cloud";
import { requireCompany } from "./fic-expenses";
import { expensePaymentState } from "./expense-payment-state";

export type ExpenseForReversal = { id: number; type: string; date: string; invoice_number: string; entity?: { id?: number; name?: string; vat_number?: string }; amount_net?: number; amount_vat?: number; amount_gross?: number; currency?: { id?: string }; payments_list: { id?: number; amount: number; due_date?: string; status: string; [key: string]: unknown }[] };
type Ticket = { companyId: number; owner: string; month: "2026-09"; expires: number; entries: { id: number; fingerprint: string }[] };
function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => [key, canonical(item)]));
  return value;
}
function fingerprint(doc: ExpenseForReversal) {
  return createHash("sha256").update(JSON.stringify(canonical({ id: doc.id, type: doc.type, date: doc.date, invoice_number: doc.invoice_number, entity: doc.entity, amount_net: doc.amount_net, amount_vat: doc.amount_vat, amount_gross: doc.amount_gross, currency: doc.currency, payments_list: doc.payments_list }))).digest("hex");
}
function signature(value: string) {
  if (!process.env.FIC_SESSION_SECRET) throw new Error("Configurazione FIC incompleta.");
  return createHmac("sha256", process.env.FIC_SESSION_SECRET).update(`expense-reversal-v1:${value}`).digest();
}
export function signReversalTicket(ticket: Ticket) {
  const payload = Buffer.from(JSON.stringify(ticket)).toString("base64url");
  return `${payload}.${signature(payload).toString("base64url")}`;
}
export function readReversalTicket(value: unknown, owner: string): Ticket {
  if (typeof value !== "string" || value.length > 60000) throw new Error("Anteprima non valida.");
  const [payload, signed, extra] = value.split(".");
  if (!payload || !signed || extra) throw new Error("Anteprima non valida.");
  const actual = Buffer.from(signed, "base64url"), expected = signature(payload);
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) throw new Error("Anteprima alterata.");
  const ticket = JSON.parse(Buffer.from(payload, "base64url").toString()) as Ticket;
  if (ticket.owner !== owner || ticket.month !== "2026-09" || !Number.isSafeInteger(ticket.companyId) || ticket.companyId <= 0 || !Number.isFinite(ticket.expires) || ticket.expires < Date.now() || !Array.isArray(ticket.entries) || ticket.entries.length > 200 || ticket.entries.some((item) => !Number.isSafeInteger(item.id) || item.id <= 0 || !/^[a-f0-9]{64}$/.test(item.fingerprint))) throw new Error("Anteprima scaduta o non valida. Ripeti il controllo.");
  return ticket;
}
export function reversedPayments(doc: ExpenseForReversal) {
  if (doc.type !== "expense" || !/^2026-09-(0[1-9]|[12]\d|30)$/.test(doc.date) || !doc.invoice_number?.trim() || !Array.isArray(doc.payments_list) || !doc.payments_list.length || doc.payments_list.some((payment) => !Number.isFinite(payment.amount) || payment.amount < 0 || !["paid", "not_paid", "reversed"].includes(payment.status))) throw new Error("Spesa o rate non valide per lo storno di settembre 2026.");
  return doc.payments_list.map((payment) => payment.status === "not_paid" ? { ...payment, status: "reversed" } : payment);
}
async function readExpense(token: string, companyId: number, id: number) {
  const response = await ficFetch<{ data?: ExpenseForReversal }>(token, `/c/${companyId}/received_documents/${id}?fieldset=detailed`);
  if (!response.data || response.data.id !== id) throw new Error("Risposta FIC incompleta. Operazione interrotta.");
  reversedPayments(response.data);
  return response.data;
}
export async function previewExpenseReversals(token: string, companyId: number, ids: number[], owner: string) {
  const company = await requireCompany(token, companyId);
  if (!Array.isArray(ids) || !ids.length || ids.length > 200 || ids.some((id) => !Number.isSafeInteger(id) || id <= 0) || new Set(ids).size !== ids.length) throw new Error("Selezione spese non valida.");
  const documents: ExpenseForReversal[] = [];
  for (let offset = 0; offset < ids.length; offset += 4) documents.push(...await Promise.all(ids.slice(offset, offset + 4).map((id) => readExpense(token, companyId, id))));
  const pending = documents.filter((doc) => doc.payments_list.some((payment) => payment.status === "not_paid"));
  const ticket = signReversalTicket({ companyId, owner, month: "2026-09", expires: Date.now() + 15 * 60000, entries: pending.map((doc) => ({ id: doc.id, fingerprint: fingerprint(doc) })) });
  return { companyId, companyName: company.name, ticket, documents: pending.map((doc) => ({ id: doc.id, invoice_number: doc.invoice_number, date: doc.date, supplier: doc.entity?.name, amount: doc.payments_list.filter((payment) => payment.status === "not_paid").reduce((total, payment) => total + payment.amount, 0), currency: doc.currency?.id })), skipped: documents.length - pending.length };
}
export async function reverseExpensePayments(token: string, ticket: Ticket, id: number) {
  const entry = ticket.entries.find((entry) => entry.id === id);
  if (!entry) throw new Error("Spesa non inclusa nell'anteprima.");
  await requireCompany(token, ticket.companyId);
  const doc = await readExpense(token, ticket.companyId, id);
  if (!doc.payments_list.some((payment) => payment.status === "not_paid")) return { id, paymentState: expensePaymentState(doc.payments_list), alreadySettled: true };
  if (fingerprint(doc) !== entry.fingerprint) throw new Error(`Spesa #${id} modificata. Ripeti il controllo prima di stornarla.`);
  const payments = reversedPayments(doc);
  // This is a payment-state update, not a credit note or a new expense.
  let uncertain = false;
  try { await ficFetch(token, `/c/${ticket.companyId}/received_documents/${id}`, { method: "PUT", body: JSON.stringify({ data: { payments_list: payments } }) }); }
  catch { uncertain = true; }
  const saved = await readExpense(token, ticket.companyId, id);
  if (fingerprint({ ...saved, payments_list: doc.payments_list }) !== fingerprint(doc) || JSON.stringify(canonical(saved.payments_list)) !== JSON.stringify(canonical(payments))) throw new Error(`Storno #${id} non confermato${uncertain ? " dopo un errore di connessione" : ""}. Controlla FIC; nessun nuovo tentativo automatico.`);
  return { id, paymentState: expensePaymentState(saved.payments_list), alreadySettled: false };
}
