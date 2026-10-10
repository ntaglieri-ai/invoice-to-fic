import { describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
vi.mock("@/lib/fic-expenses", () => ({ listAll: vi.fn() }));
import { listAll } from "@/lib/fic-expenses";
import { loadFicMonth, recoverMonth, type MonthlyExpense } from "@/lib/fic-month";
const expense: MonthlyExpense = { id: 44, invoice_number: "IA8NO7NL-0175", date: "2026-09-15", entity: { id: 8, name: "OpenAI Ireland Limited", vat_number: "IE4143435AH" }, currency: { id: "EUR" }, amount_net: 12.36, amount_vat: 0, amount_gross: 12.36 };
const td17 = { id: 900, entity: { id: 8 }, ei_status: "sent", ei_raw: { FatturaElettronicaBody: { DatiGenerali: { DatiGeneraliDocumento: { TipoDocumento: "TD17" }, DatiFattureCollegate: [{ IdDocumento: "IA8NO7NL-0175", Data: "2026-09-15" }] } } } };
describe("FIC monthly recovery", () => {
  it("recovers September with full invoice number, amounts, expense and sent TD17", () => {
    const [item] = recoverMonth([expense], [td17], 123, "2026-09");
    expect(item.invoice).toMatchObject({ invoice_number: "IA8NO7NL-0175", invoice_date: "2026-09-15", total_amount: 12.36 });
    expect(item.processing).toMatchObject({ expenseId: 44, td17Id: 900, td17State: "sent" });
    expect(item.id).toBe("fic-123-44");
  });
  it("excludes other months and non-SaaS suppliers", () => {
    expect(recoverMonth([expense], [], 123, "2026-08")).toEqual([]);
    expect(recoverMonth([{ ...expense, entity: { name: "Local shop" } }], [], 123, "2026-09")).toEqual([]);
  });
  it("does not link another supplier or invoice TD17", () => {
    expect(recoverMonth([expense], [{ ...td17, entity: { id: 9 } }], 123, "2026-09")[0].processing?.td17Id).toBeUndefined();
    expect(recoverMonth([{ ...expense, invoice_number: "OTHER" }], [td17], 123, "2026-09")[0].processing?.td17Id).toBeUndefined();
  });
  it("does not invent missing amounts or currency", () => {
    expect(recoverMonth([{ ...expense, currency: undefined, amount_net: undefined }], [], 123, "2026-09")[0].invoice).toMatchObject({ currency: "", net_amount: null });
  });
  it("reads lists only with a bounded month query including December rollover", async () => {
    vi.mocked(listAll).mockResolvedValue([]);
    await loadFicMonth("test", 123, "2026-12");
    expect(decodeURIComponent(vi.mocked(listAll).mock.calls.at(-2)![1])).toContain("date >= '2026-12-01' and date < '2027-01-01'");
  });
  it("fails closed on partial or failed FIC reads", async () => {
    vi.mocked(listAll).mockRejectedValueOnce(new Error("incomplete"));
    await expect(loadFicMonth("test", 123, "2026-09")).rejects.toThrow("incomplete");
    await expect(loadFicMonth("test", 123, "2026-99")).rejects.toThrow("Mese non valido");
  });
});
