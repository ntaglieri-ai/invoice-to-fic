import { beforeEach, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
vi.mock("./fatture-in-cloud", () => ({ ficFetch: vi.fn() }));
import { ficFetch } from "./fatture-in-cloud";
import { resolveTd17TaxIdentity } from "./fic-tax-identity";
import type { InvoiceFields } from "./types";
const invoice: InvoiceFields = { supplier: "Supabase", invoice_number: "RZWLOS-00009", invoice_date: "2026-10-18", currency: "EUR", net_amount: 49.37, tax_amount: 0, total_amount: 49.37, supplier_vat: "" };
const suppliers = [{ id: 8, name: "Supabase Pte. Ltd.", vat_number: "202005760H" }, { id: 9, name: "Supabase Pte. Ltd.", vat_number: "OTHER" }];
const expense = { id: 123, type: "expense", invoice_number: "RZWLOS-00009", date: "2026-10-18", entity: { id: 8 } };
beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(ficFetch).mockImplementation(async (_token, path) => ({ data: path.includes("received_documents") ? expense : { ...suppliers[0], country: "Singapore" } }));
});
it("fills missing Tax ID from the exact linked FIC supplier, not from similar names", async () => {
  expect(await resolveTd17TaxIdentity("mock", 1, invoice, suppliers, 123)).toEqual({ supplierId: 8, taxId: "202005760H", source: "fic" });
  expect(vi.mocked(ficFetch).mock.calls.map(([, path]) => path)).toEqual(["/c/1/received_documents/123?fieldset=detailed", "/c/1/entities/suppliers/8?fieldset=detailed"]);
  expect(vi.mocked(ficFetch).mock.calls.every(([, , init]) => !init?.method)).toBe(true);
});
it("prefers the printed identifier without silently replacing it with FIC data", async () => {
  expect(await resolveTd17TaxIdentity("mock", 1, { ...invoice, supplier_vat: "PRINTED" }, suppliers, 123)).toEqual({ supplierId: 8, taxId: "PRINTED", source: "invoice" });
  expect(ficFetch).toHaveBeenCalledTimes(1);
});
it("never infers a supplier by name without a matching expense or unique VAT", async () => {
  expect(await resolveTd17TaxIdentity("mock", 1, invoice, suppliers)).toBeNull();
  expect(ficFetch).not.toHaveBeenCalled();
});
it("rejects wrong expense numbers, dates and document types", async () => {
  for (const change of [{ invoice_number: "RZWLOS-00008" }, { date: "2026-09-18" }, { type: "self_supplier_invoice" }, { id: 999 }, { entity: { id: 500 } }]) {
    vi.mocked(ficFetch).mockResolvedValueOnce({ data: { ...expense, ...change } });
    await expect(resolveTd17TaxIdentity("mock", 1, invoice, suppliers, 123)).rejects.toThrow();
  }
});
it("does not invent a missing identifier or use an Italian supplier", async () => {
  for (const change of [{ vat_number: "" }, { vat_number: "IT02071070664" }, { country: "Italia" }, { id: 999 }]) {
    vi.mocked(ficFetch).mockResolvedValueOnce({ data: expense }).mockResolvedValueOnce({ data: { ...suppliers[0], country: "Singapore", ...change } });
    await expect(resolveTd17TaxIdentity("mock", 1, invoice, suppliers, 123)).rejects.toThrow();
  }
});
