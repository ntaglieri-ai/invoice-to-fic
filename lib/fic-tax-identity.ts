import "server-only";
import { ficFetch } from "./fatture-in-cloud";
import { normalizeIdentifier, type FicSupplier } from "./expense-validation";
import { matchExpenseSupplier } from "./expense-preferences";
import type { InvoiceFields } from "./types";

export type TaxIdentity = { supplierId: number; taxId: string; source: "invoice" | "fic" };
export async function resolveTd17TaxIdentity(token: string, companyId: number, invoice: InvoiceFields, suppliers: FicSupplier[], expenseId?: number): Promise<TaxIdentity | null> {
  const printed = invoice.supplier_vat.trim();
  if (expenseId === undefined) return printed ? { supplierId: matchExpenseSupplier(suppliers, printed)?.id ?? 0, taxId: printed, source: "invoice" } : null;
  if (!Number.isSafeInteger(expenseId) || expenseId <= 0) throw new Error("Riferimento spesa FIC non valido.");
  const response = await ficFetch<{ data?: { id?: number; type?: string; invoice_number?: string; date?: string; entity?: { id?: number } } }>(token, `/c/${companyId}/received_documents/${expenseId}?fieldset=detailed`);
  const expense = response.data;
  if (expense?.id !== expenseId || expense.type !== "expense" || normalizeIdentifier(expense.invoice_number ?? "") !== normalizeIdentifier(invoice.invoice_number) || expense.date !== invoice.invoice_date) throw new Error("La spesa FIC non coincide con numero e data della fattura. Identificativo non recuperato.");
  const linked = suppliers.find((supplier) => supplier.id === expense.entity?.id);
  if (!linked) throw new Error("Fornitore della spesa non presente nell'azienda FIC selezionata.");
  // Prefer the document's identifier; a mismatch is still checked by TD17 preview.
  if (printed) return { supplierId: linked.id, taxId: printed, source: "invoice" };
  const supplierResponse = await ficFetch<{ data?: FicSupplier & { country?: string } }>(token, `/c/${companyId}/entities/suppliers/${linked.id}?fieldset=detailed`);
  const supplier = supplierResponse.data;
  const taxId = supplier?.vat_number?.trim();
  if (supplier?.id !== linked.id || !taxId || normalizeIdentifier(taxId).startsWith("IT") || !supplier.country?.trim() || ["IT", "ITALIA", "ITALY"].includes(normalizeIdentifier(supplier.country))) throw new Error("VAT/Tax ID estero assente o non valido anche nell'anagrafica FIC del fornitore collegato alla spesa.");
  return { supplierId: linked.id, taxId, source: "fic" };
}
