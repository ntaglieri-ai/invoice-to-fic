import { describe, expect, it } from "vitest";
import { cleanManagedInvoice, cleanMemoryEvent, memoryChanges, memoryLedger, replayMemory, type ManagedInvoice, type MemoryEvent } from "./invoice-memory";
const invoice: ManagedInvoice = { id: "drive-pdf1", driveId: "pdf1", index: 0, file_name: "invoice.pdf", invoice: { supplier: "OpenAI", invoice_number: "IA8NO7NL-0095", invoice_date: "2026-08-31", currency: "EUR", net_amount: 13.21, tax_amount: 0, total_amount: 13.21, supplier_vat: "IE4143435AH" }, status: "approved", confidence: 0.75, warnings: [], extracted_text_preview: "private PDF preview", processing: { expenseId: 123, td17Id: 456, td17EiStatus: "sent", td17State: "sent", updatedAt: "2026-10-04T09:00:00Z" } };
const operation = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const event = (n: number, value: ManagedInvoice | null, revision: string | null = null): MemoryEvent => ({ version: 1, operationId: operation(n), changes: [{ id: invoice.id, expectedRevision: revision, value }] });

describe("online managed invoices", () => {
  it("stores only fields, approval, Drive reference and FIC states, never PDF or drafts", () => {
    const clean = cleanManagedInvoice({ ...invoice, expenseDraft: { secret: true }, pdf: "base64" });
    expect(clean.extracted_text_preview).toBe("");
    expect(clean).not.toHaveProperty("expenseDraft");
    expect(clean).not.toHaveProperty("pdf");
    expect(clean.driveId).toBe("pdf1");
    expect(clean.processing?.td17State).toBe("sent");
  });
  it("restores references in the selected company only", () => {
    const { records } = replayMemory([event(1, cleanManagedInvoice(invoice))]);
    const ledger = memoryLedger(records, "17");
    expect(ledger[JSON.stringify(["17", "OpenAI", "IA8NO7NL-0095"])].td17Id).toBe(456);
    expect(ledger[JSON.stringify(["18", "OpenAI", "IA8NO7NL-0095"])]).toBeUndefined();
  });
  it("rejects stale edits and resurrection by an old browser", () => {
    const state = replayMemory([event(1, invoice), event(2, null, operation(1)), event(3, invoice, operation(1))]);
    expect(state.records[invoice.id].value).toBeNull();
    expect(state.accepted.has(operation(3))).toBe(false);
  });
  it("makes retries idempotent and preserves unrelated concurrent invoices", () => {
    const other = { ...invoice, id: "other" };
    const second: MemoryEvent = { version: 1, operationId: operation(2), changes: [{ id: other.id, expectedRevision: null, value: other }] };
    const { records, accepted } = replayMemory([event(1, invoice), event(1, invoice), second]);
    expect(Object.keys(records)).toHaveLength(2);
    expect(accepted.size).toBe(2);
  });
  it("resets TD17 without deleting the expense, invoice or Drive reference", () => {
    const changed = { ...invoice, processing: { expenseId: 123, updatedAt: "2026-10-04T10:00:00Z" } };
    const { records } = replayMemory([event(1, invoice), event(2, changed, operation(1))]);
    expect(records[invoice.id].value?.processing?.td17Id).toBeUndefined();
    expect(records[invoice.id].value?.processing?.expenseId).toBe(123);
    expect(records[invoice.id].value?.driveId).toBe("pdf1");
  });
  it("checkpoint replay retains revisions, tombstones and idempotency", () => {
    const initial = replayMemory([event(1, invoice)]);
    const next = replayMemory([event(1, invoice), event(2, null, operation(1))], { records: initial.records, accepted: [...initial.accepted], seen: [...initial.seen] });
    expect(next.records[invoice.id].value).toBeNull();
    expect(next.accepted.size).toBe(2);
  });
  it("detects approval and field changes and explicit removals without rewriting other records", () => {
    const clean = cleanManagedInvoice(invoice);
    const { records } = replayMemory([event(1, clean)]);
    expect(memoryChanges(records, [clean], memoryLedger(records, "17"), "17")).toEqual([]);
    expect(memoryChanges(records, [], {}, "17")).toEqual([{ id: invoice.id, value: null, expectedRevision: operation(1) }]);
  });
  it("rejects malformed payloads, unsafe IDs, duplicates and forged delivery state", () => {
    expect(() => cleanManagedInvoice({ ...invoice, invoice: { ...invoice.invoice, total_amount: "13" } })).toThrow();
    expect(() => cleanManagedInvoice({ ...invoice, id: "__proto__" })).toThrow();
    expect(() => cleanMemoryEvent({ ...event(1, invoice), changes: [...event(1, invoice).changes, ...event(1, invoice).changes] })).toThrow();
    expect(cleanManagedInvoice({ ...invoice, processing: { ...invoice.processing, td17EiStatus: "not_sent", td17State: "sent" } }).processing?.td17State).toBe("not_sent");
  });
});
