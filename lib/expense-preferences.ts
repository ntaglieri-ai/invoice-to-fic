import { normalizeIdentifier, type FicSupplier } from "@/lib/expense-validation";
import type { InvoiceFields } from "@/lib/types";

export type ExpenseTaxPreferences = { taxDeductibility: number; vatDeductibility: number };

// User-requested proposal for this app's SaaS suppliers; final review remains mandatory.
export function suggestedSaasPreferences(invoice: InvoiceFields): ExpenseTaxPreferences | null {
  return ["OpenAI", "Anthropic", "Vercel", "Supabase", "Hetzner"].includes(invoice.supplier)
    ? { taxDeductibility: 100, vatDeductibility: 100 }
    : null;
}

export function suggestedForeignDocument(invoice: InvoiceFields): "TD17" | null {
  return suggestedSaasPreferences(invoice) && invoice.tax_amount === 0 && !normalizeIdentifier(invoice.supplier_vat).startsWith("IT") ? "TD17" : null;
}

export function expensePreferencesKey(companyId: number, supplierId: number) {
  return `invoice-to-fic:tax-settings:v1:${companyId}:${supplierId}`;
}

export function parseExpensePreferences(raw: string | null): ExpenseTaxPreferences | null {
  if (!raw) return null;
  try {
    const value = JSON.parse(raw);
    if (value?.version !== 1) return null;
    const fields = [value.taxDeductibility, value.vatDeductibility];
    if (fields.some((field) => typeof field !== "number" || !Number.isFinite(field) || field < 0 || field > 100)) return null;
    return { taxDeductibility: value.taxDeductibility, vatDeductibility: value.vatDeductibility };
  } catch { return null; }
}

export function matchExpenseSupplier(suppliers: FicSupplier[], vat: string) {
  if (!vat.trim()) return null;
  const matches = suppliers.filter((supplier) => supplier.vat_number && normalizeIdentifier(supplier.vat_number) === normalizeIdentifier(vat));
  return matches.length === 1 ? matches[0] : null;
}
