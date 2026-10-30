import { expect, it } from "vitest";
import { repairUndatedVercel, recoverVercelDriveInvoice } from "./vercel-register-repair";
import { invoiceMonth } from "./invoice-history";
import { parseInvoiceText } from "./invoice-parser";
import type { WorkflowInvoice } from "./invoice-workflow";

const parsed = parseInvoiceText(`Vercel Inc.
Invoice number7R20H5XD-0091
Date of issueOctober 13, 2026
Vercel VAT ID EU056329113
Subtotal$30.00 USD
Tax$6.60
Total$36.60`, "Invoice-7R20H5XD-0091.pdf");
const old: WorkflowInvoice = { ...parsed, id: "original", driveId: "pdf", checked_at: "2026-10-14", invoice: { ...parsed.invoice, invoice_number: "7R20H5XD", invoice_date: "", tax_amount: 30, total_amount: 30 } };

it("repairs the existing row into October without adding a new invoice", () => {
  const result = repairUndatedVercel([old], old.id, "pdf", parsed, "1");
  expect(result).toHaveLength(1);
  expect(result[0]).toMatchObject({ id: old.id, driveId: "pdf", status: "needs_review", invoice: parsed.invoice });
  expect(invoiceMonth(result[0])).toBe("2026-10");
  expect(result[0].checked_at).toBeUndefined();
  expect(old.invoice.invoice_date).toBe("");
});
it("preserves exclusion and does not create expense or TD17 references", () => {
  const result = repairUndatedVercel([{ ...old, not_applicable: true }], old.id, "pdf", parsed, "1");
  expect(result[0].not_applicable).toBe(true);
  expect(result[0].ficId).toBeUndefined();
  expect(result[0].td17).toBeUndefined();
});
it("does not overwrite a date corrected by the user while the PDF was being read", () => {
  const items = [{ ...old, invoice: { ...old.invoice, invoice_date: "2026-10-12" } }];
  expect(repairUndatedVercel(items, old.id, "pdf", parsed, "1")).toBe(items);
});
it("rejects mismatched Drive references, suppliers, invoice numbers and missing dates", () => {
  const items = [old];
  expect(repairUndatedVercel(items, old.id, "other-file", parsed, "1")).toBe(items);
  for (const invoice of [{ ...parsed.invoice, supplier: "OpenAI" as const }, { ...parsed.invoice, invoice_number: "OTHER-01" }, { ...parsed.invoice, invoice_date: "" }]) {
    expect(repairUndatedVercel(items, old.id, "pdf", { ...parsed, invoice }, "1")).toBe(items);
  }
});
it("does not reparse financial data of an already processed source row", () => {
  const items = [{ ...old, ficId: 123 }];
  expect(repairUndatedVercel(items, old.id, "pdf", parsed, "1")).toBe(items);
});
it("joins a recovered FIC row without duplicates or changing its currency, amounts and references", () => {
  const peer = { ...parsed, id: "fic-123", ficId: 123, td17: { companyId: 1, id: 456 }, invoice: { ...parsed.invoice, currency: "EUR", net_amount: 27, tax_amount: 5.94, total_amount: 32.94 } };
  const result = repairUndatedVercel([old, peer], old.id, "pdf", parsed, "1");
  expect(result).toEqual([{ ...peer, driveId: "pdf" }]);
});
it("recovers separately archived invoice numbers that the old truncated prefix had collapsed", () => {
  const other = { ...parsed, invoice: { ...parsed.invoice, invoice_number: "7R20H5XD-0092" } };
  const rows = recoverVercelDriveInvoice(repairUndatedVercel([old], old.id, "pdf", parsed, "1"), "second-pdf", other, "1");
  expect(rows.map((item) => item.invoice.invoice_number)).toEqual(["7R20H5XD-0091", "7R20H5XD-0092"]);
  expect(rows[1].id).toBe("drive-second-pdf");
  expect(invoiceMonth(rows[1])).toBe("2026-10");
  expect(recoverVercelDriveInvoice(rows, "second-pdf", other, "1")).toBe(rows);
});
it("only attaches a source PDF to an already registered FIC invoice", () => {
  const peer = { ...parsed, id: "fic", ficId: 123, td17: { companyId: 1, id: 456 } };
  expect(recoverVercelDriveInvoice([peer], "pdf", parsed, "1")).toEqual([{ ...peer, driveId: "pdf" }]);
});
