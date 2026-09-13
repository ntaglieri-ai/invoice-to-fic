import type { InvoiceFields } from "@/lib/types";

export type ReverseChargeMode = "none" | "td17" | "td18";

export type FattureInCloudDraftExpense = {
  supplierName: string;
  supplierVat: string;
  invoiceNumber: string;
  invoiceDate: string;
  currency: string;
  netAmount: number;
  taxAmount: number;
  totalAmount: number;
  reverseChargeMode: ReverseChargeMode;
  source: "manual_review";
};

export type FattureInCloudOAuthSession = {
  accessToken: string;
  refreshToken: string;
  expiresAt: string;
};

export function buildDraftExpense(invoice: InvoiceFields): FattureInCloudDraftExpense {
  if (invoice.net_amount === null || invoice.tax_amount === null || invoice.total_amount === null) {
    throw new Error("La fattura deve avere imponibile, IVA e totale prima della fase FIC.");
  }

  return {
    supplierName: invoice.supplier,
    supplierVat: invoice.supplier_vat,
    invoiceNumber: invoice.invoice_number,
    invoiceDate: invoice.invoice_date,
    currency: invoice.currency,
    netAmount: invoice.net_amount,
    taxAmount: invoice.tax_amount,
    totalAmount: invoice.total_amount,
    reverseChargeMode: "none",
    source: "manual_review",
  };
}

export async function createExpenseDraft() {
  throw new Error("Fase 2 non implementata: integrazione Fatture in Cloud disabilitata nell'MVP.");
}
