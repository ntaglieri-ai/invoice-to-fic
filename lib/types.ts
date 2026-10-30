export type SupportedSupplier =
  | "OpenAI"
  | "Anthropic"
  | "Vercel"
  | "Hetzner"
  | "Supabase"
  | "Sconosciuto";

export type InvoiceStatus = "extracted" | "needs_review" | "duplicate" | "approved";

export type InvoiceFields = {
  supplier: SupportedSupplier;
  invoice_number: string;
  invoice_date: string;
  currency: string;
  net_amount: number | null;
  tax_amount: number | null;
  total_amount: number | null;
  supplier_vat: string;
  customer_vat?: string;
  eur_conversion?: EurConversion;
  foreign_reference?: string;
};

export type EurConversion = { rate: number; date: string; source: "ECB" | "manual"; confirmed_at: string };

export type ParsedInvoice = {
  expense_acceptance?: { id: number; at: string };
  not_applicable?: boolean;
  checked_at?: string;
  index: number;
  file_name: string;
  invoice: InvoiceFields;
  status: InvoiceStatus;
  duplicate_of?: number;
  confidence: number;
  extracted_text_preview: string;
  warnings: string[];
};

export type SupplierParserResult = {
  supplier: SupportedSupplier;
  confidence: number;
  fields: Partial<InvoiceFields>;
  warnings?: string[];
};

export type SupplierParser = {
  supplier: Exclude<SupportedSupplier, "Sconosciuto">;
  detect: (text: string) => boolean;
  parse: (text: string) => SupplierParserResult;
};
