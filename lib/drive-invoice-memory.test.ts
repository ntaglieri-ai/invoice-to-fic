import { afterEach, beforeEach, expect, it, vi } from "vitest";
vi.mock("./google-session", () => ({ googleFetch: vi.fn() }));
import { googleFetch, type GoogleSession } from "./google-session";
import { loadInvoiceMemory, saveInvoiceMemory } from "./drive-invoice-memory";
import { cleanMemoryEvent, type MemoryEvent } from "./invoice-memory";
const session: GoogleSession = { access: "mock", refresh: "mock", expires: 9999999999999, scope: "" };
const event: MemoryEvent = cleanMemoryEvent({ version: 1, operationId: "00000000-0000-4000-8000-000000000001", changes: [{ id: "one", expectedRevision: null, value: { id: "one", index: 0, file_name: "one.pdf", invoice: { supplier: "OpenAI", invoice_number: "INV-001", invoice_date: "2026-08-31", currency: "EUR", net_amount: 1, tax_amount: 0, total_amount: 1, supplier_vat: "IE4143435AH" }, status: "approved", confidence: 1, warnings: [] } }] });
beforeEach(() => vi.resetAllMocks());
afterEach(() => vi.restoreAllMocks());
it("reads every Drive page scoped to owner and company, never treating a failed read as empty", async () => {
  const fetch = vi.mocked(googleFetch);
  fetch.mockResolvedValueOnce(Response.json({ files: [], nextPageToken: "page2" })).mockResolvedValueOnce(Response.json({ files: [{ id: "event1", createdTime: "2026-10-04T00:00:00Z" }] })).mockResolvedValueOnce(Response.json(event));
  const result = await loadInvoiceMemory(session, 17);
  expect(result.records.one.value?.invoice.invoice_number).toBe("INV-001");
  const query = new URLSearchParams(fetch.mock.calls[0][1].split("?")[1]);
  expect(query.get("q")).toContain("'me' in owners");
  expect(query.get("q")).toContain("value='17'");
  expect(fetch.mock.calls[1][1]).toContain("pageToken=page2");
  fetch.mockRejectedValueOnce(new Error("Drive unavailable"));
  await expect(loadInvoiceMemory(session, 17)).rejects.toThrow("unavailable");
});
it("confirms a repeated write without creating another registry or touching PDFs/FIC", async () => {
  vi.mocked(googleFetch).mockResolvedValueOnce(Response.json({ files: [{ id: "event1", createdTime: "2026-10-04T00:00:00Z" }] })).mockResolvedValueOnce(Response.json(event));
  await saveInvoiceMemory(session, 17, event);
  expect(vi.mocked(googleFetch).mock.calls.every(([, , init]) => !init?.method)).toBe(true);
});
it("writes JSON only and waits for read-back confirmation", async () => {
  const fetch = vi.mocked(googleFetch);
  fetch.mockResolvedValueOnce(Response.json({ files: [] })).mockResolvedValueOnce(Response.json({ files: [{ id: "folder" }] })).mockResolvedValueOnce(Response.json({ id: "event1" })).mockResolvedValueOnce(Response.json({ files: [{ id: "event1", createdTime: "2026-10-04T00:00:00Z" }] })).mockResolvedValueOnce(Response.json(event));
  const result = await saveInvoiceMemory(session, 17, event);
  expect(result.one.revision).toBe(event.operationId);
  const write = fetch.mock.calls.find(([, , init]) => init?.method === "POST")!;
  expect(write[1]).toContain("/upload/drive/");
  expect(write[2]?.body).toContain('"mimeType":"application/json"');
  expect(write[2]?.body).not.toContain("application/pdf");
});
it("rejects an incomplete search and stale edits without writing anything", async () => {
  const fetch = vi.mocked(googleFetch);
  fetch.mockResolvedValueOnce(Response.json({ files: [], incompleteSearch: true }));
  await expect(loadInvoiceMemory(session, 17)).rejects.toThrow("incompleta");
  fetch.mockResolvedValueOnce(Response.json({ files: [{ id: "event1", createdTime: "2026-10-04T00:00:00Z" }] })).mockResolvedValueOnce(Response.json(event));
  await expect(saveInvoiceMemory(session, 17, { ...event, operationId: "00000000-0000-4000-8000-000000000002" })).rejects.toThrow("altra sessione");
  expect(fetch.mock.calls.every(([, , init]) => !init?.method)).toBe(true);
});
it("loads checkpoints without downloading folded event files again", async () => {
  const fetch = vi.mocked(googleFetch);
  const checkpoint = { records: { one: { value: event.changes[0].value, revision: event.operationId } }, files: ["event1"], accepted: [event.operationId], seen: [event.operationId] };
  fetch.mockResolvedValueOnce(Response.json({ files: [{ id: "event1", createdTime: "2026-10-04T00:00:00Z" }, { id: "snapshot1", createdTime: "2026-10-04T00:00:01Z", appProperties: { ficMemoryKind: "checkpoint" } }] })).mockResolvedValueOnce(Response.json(checkpoint));
  const result = await loadInvoiceMemory(session, 17);
  expect(result.records.one.revision).toBe(event.operationId);
  expect(fetch.mock.calls).toHaveLength(2);
  expect(fetch.mock.calls[1][1]).toContain("snapshot1");
});
