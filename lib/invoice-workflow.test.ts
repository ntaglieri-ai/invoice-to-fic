import assert from "node:assert/strict";
import { test } from "vitest";
import { matchesWorkflow, newestInvoicesFirst, nextInvoiceAction, workflowStage, displayInvoiceDate, invoiceAmount, type WorkflowInvoice } from "./invoice-workflow";
const invoice: WorkflowInvoice = { id: "test", index: 0, file_name: "Invoice-0095.pdf", status: "extracted", confidence: 1, extracted_text_preview: "", warnings: [], invoice: { supplier: "OpenAI", invoice_number: "IA8NO7NL-0095", invoice_date: "2026-08-31", currency: "EUR", net_amount: 13.21, tax_amount: 0, total_amount: 13.21, supplier_vat: "IE4143435AH" } };
test("sorts filtered invoices newest first before pagination without changing stored order", () => {
  const make = (id: string, date: string, number = id): WorkflowInvoice => ({ ...invoice, id, invoice: { ...invoice.invoice, invoice_date: date, invoice_number: number } });
  const items = [make("old", "2026-09-15"), make("new", "2026-09-17"), make("old2", "2026-09-15"), make("unknown", ""), make("middle", "2026-09-16")];
  const sorted = newestInvoicesFirst(items.filter((item) => matchesWorkflow(item, "all", "OpenAI")));
  assert.deepEqual(sorted.map((item) => item.invoice.invoice_date), ["2026-09-17", "2026-09-16", "2026-09-15", "2026-09-15", ""]);
  assert.deepEqual(sorted.slice(0, 2).map((item) => item.id), ["new", "middle"]);
  assert.equal(items[0].id, "old");
  assert.deepEqual(newestInvoicesFirst([make("a", "2026-09-15", "INV-9"), make("b", "2026-09-15", "INV-10")]).map((item) => item.id), ["b", "a"]);
});
test("workflow requires approval then expense before TD17", () => {
  assert.equal(nextInvoiceAction(invoice), "review");
  assert.equal(nextInvoiceAction({ ...invoice, status: "approved" }), "expense");
  assert.equal(nextInvoiceAction({ ...invoice, status: "approved", ficId: 12 }), "td17");
});
test("created TD17 is not completed until FIC reports sent", () => {
  const item: WorkflowInvoice = { ...invoice, status: "approved", ficId: 12, td17: { companyId: 1, id: 14, state: "not_sent" } };
  assert.equal(workflowStage(item), "send");
  assert.equal(workflowStage({ ...item, td17: { ...item.td17!, state: "sent" } }), "done");
  assert.equal(workflowStage({ ...item, status: "needs_review" }), "work");
  assert.equal(workflowStage({ ...item, status: "duplicate" }), "work");
  assert.equal(nextInvoiceAction(item), "fic");
});
test("register search retains entire invoice number and combines workflow filters", () => {
  assert.equal(matchesWorkflow(invoice, "work", "ia8no7nl-0095"), true);
  assert.equal(matchesWorkflow(invoice, "done", "OpenAI"), false);
  assert.equal(matchesWorkflow(invoice, "all", "0094"), false);
  assert.equal(displayInvoiceDate(invoice.invoice.invoice_date), "31/08/2026");
  assert.match(invoiceAmount(invoice), /13,21/);
});
