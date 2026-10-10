import "server-only";
import { listAll } from "@/lib/fic-expenses";
import { matchExistingTd17, type ExistingTd17 } from "@/lib/fic-td17";
import { td17DeliveryState } from "@/lib/processing-state";
import type { ManagedInvoice } from "@/lib/invoice-memory";
import type { SupportedSupplier } from "@/lib/types";

export type MonthlyExpense = {
  id: number; invoice_number?: string; date?: string;
  entity?: { id?: number; name?: string; vat_number?: string };
  currency?: { id?: string }; amount_net?: number; amount_vat?: number; amount_gross?: number;
};

export function recoverMonth(expenses: MonthlyExpense[], td17s: ExistingTd17[], companyId: number, month: string): ManagedInvoice[] {
  return expenses.flatMap((expense, index) => {
    const name = expense.entity?.name ?? "";
    const supplier = (["OpenAI", "Anthropic", "Vercel", "Hetzner", "Supabase"] as SupportedSupplier[]).find((supplier) => name.toLowerCase().includes(supplier.toLowerCase()));
    if (!supplier || !expense.invoice_number?.trim() || !expense.date?.startsWith(`${month}-`) || !Number.isSafeInteger(expense.id) || expense.id <= 0) return [];
    const invoice = { supplier, invoice_number: expense.invoice_number.trim(), invoice_date: expense.date,
      supplier_vat: expense.entity?.vat_number ?? "", currency: expense.currency?.id ?? "",
      net_amount: Number.isFinite(expense.amount_net) ? expense.amount_net! : null,
      tax_amount: Number.isFinite(expense.amount_vat) ? expense.amount_vat! : null,
      total_amount: Number.isFinite(expense.amount_gross) ? expense.amount_gross! : null };
    const td17 = matchExistingTd17(td17s, companyId, invoice, { id: expense.entity?.id ?? -1, vat_number: invoice.supplier_vat });
    return [{ id: `fic-${companyId}-${expense.id}`, index, file_name: `${supplier} - ${invoice.invoice_number}`, invoice,
      status: "approved" as const, confidence: 1, extracted_text_preview: "", warnings: [],
      processing: { expenseId: expense.id, ...(td17 ? { td17Id: td17.id, td17State: td17DeliveryState(td17.ei_status), td17EiStatus: td17.ei_status ?? "unknown" } : {}), updatedAt: new Date().toISOString() } }];
  });
}

export async function loadFicMonth(token: string, companyId: number, month: string) {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) throw new Error("Mese non valido.");
  const start = `${month}-01`;
  const end = new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 1)).toISOString().slice(0, 10);
  const query = encodeURIComponent(`date >= '${start}' and date < '${end}'`);
  const [expenses, td17s] = await Promise.all([
    listAll<MonthlyExpense>(token, `/c/${companyId}/received_documents?type=expense&fields=id,invoice_number,date,entity,currency,amount_net,amount_vat,amount_gross&q=${query}`),
    listAll<ExistingTd17>(token, `/c/${companyId}/issued_documents?type=self_supplier_invoice&fields=id,subject,entity,ei_raw,ei_data,ei_status`),
  ]);
  return recoverMonth(expenses, td17s, companyId, month);
}
