import { beforeEach, expect, it, vi } from "vitest";
vi.mock("@/lib/google-session", () => ({ googleFetch: vi.fn() }));
vi.mock("@/lib/invoice-link-download", () => ({ MAX_PDF_BYTES: 10 * 1024 * 1024, downloadOpenaiInvoice: vi.fn() }));
vi.mock("@/lib/invoice-parser", () => ({ parseInvoicePdf: vi.fn() }));
import { googleFetch } from "./google-session";
import { parseInvoicePdf } from "./invoice-parser";
import { importGoogleInvoice, scanGoogleInvoices } from "./google-invoices";
import type { MailMessage } from "./mail-invoices";

const session = { access: "a", refresh: "r", scope: "", expires: 0 };
let message: MailMessage;
let stored: { id: string; name: string; appProperties?: Record<string, string> } | undefined;
let uploaded: Record<string, unknown> | undefined;
beforeEach(() => {
  vi.resetAllMocks(); stored = undefined; uploaded = undefined;
  message = { id: "abc", labelIds: ["saas"], internalDate: String(Date.parse("2026-09-18")), payload: { headers: [{ name: "From", value: "billing@hetzner.com" }], parts: [
    { partId: "1", filename: "Hetzner_invoice.pdf", body: { attachmentId: "pdf", size: 20 } },
    { partId: "2", filename: "Receipt.pdf", body: { attachmentId: "receipt" } },
  ] } };
  vi.mocked(parseInvoicePdf).mockResolvedValue({ index: 0, file_name: "Hetzner_invoice.pdf", invoice: { supplier: "Hetzner", invoice_number: "001", invoice_date: "2026-09-18", currency: "EUR", net_amount: 20, tax_amount: 0, total_amount: 20, supplier_vat: "DE123" }, status: "extracted", confidence: 1, warnings: [], extracted_text_preview: "" });
  vi.mocked(googleFetch).mockImplementation(async (_session, path, init) => {
    if (path.endsWith("/labels")) return Response.json({ labels: [{ id: "saas", name: "Fatture SaaS" }] });
    if (path.includes("/messages?")) return Response.json({ messages: [{ id: "abc" }], nextPageToken: "next" });
    if (path.includes("format=full")) return Response.json(message);
    if (path.includes("/attachments/")) return Response.json({ data: Buffer.from("%PDF-test").toString("base64url") });
    if (path.includes("alt=media")) return new Response("%PDF-test");
    if (path.startsWith("/drive/v3/files?")) {
      if (init?.method === "POST") return Response.json({ id: "folder" });
      const q = new URLSearchParams(path.split("?")[1]).get("q")!;
      return Response.json({ files: stored && q.includes("ficSource") ? [stored] : [] });
    }
    if (path.startsWith("/upload/")) {
      const multipart = Buffer.from(init!.body as Buffer).toString();
      uploaded = JSON.parse(multipart.split("\r\n\r\n")[1].split("\r\n--")[0]);
      stored = { id: "saved", name: "Hetzner_invoice.pdf" };
      return Response.json(stored);
    }
    throw new Error(`Unexpected mock API path`);
  });
});
it("scans only the label and retains pagination without Drive writes", async () => {
  const result = await scanGoogleInvoices(session, "2026-09");
  expect(result.items).toHaveLength(1); expect(result.nextPageToken).toBe("next");
  const list = vi.mocked(googleFetch).mock.calls.find((c) => c[1].includes("/messages?"))!;
  expect(list[1]).toContain("labelIds=saas"); expect(uploaded).toBeUndefined();
});
it("archives a PDF with persistent metadata and restores it on a second import", async () => {
  const first = await importGoogleInvoice(session, "abc", "1");
  expect(first).toMatchObject({ driveId: "saved", duplicate: false });
  expect(uploaded).toMatchObject({ name: "Hetzner_invoice.pdf", mimeType: "application/pdf", parents: ["folder"], appProperties: { ficSource: expect.any(String), ficContent: expect.any(String), ficInvoice: expect.any(String) } });
  const second = await importGoogleInvoice(session, "abc", "1");
  expect(second).toMatchObject({ driveId: "saved", duplicate: true });
  expect(vi.mocked(googleFetch).mock.calls.filter((c) => c[1].startsWith("/upload/"))).toHaveLength(1);
});
it("rejects messages outside the label, receipts and untrusted senders", async () => {
  message.labelIds = ["inbox"];
  await expect(importGoogleInvoice(session, "abc", "1")).rejects.toThrow("non appartiene");
  message.labelIds = ["saas"];
  await expect(importGoogleInvoice(session, "abc", "2")).rejects.toThrow("non riconosciuto");
  message.payload.headers = [{ name: "From", value: "unknown@example.com" }];
  await expect(importGoogleInvoice(session, "abc", "1")).rejects.toThrow("Mittente");
  expect(uploaded).toBeUndefined();
});
it("rejects mismatching supplier and oversized PDF before archiving", async () => {
  const parsed = await parseInvoicePdf(Buffer.from(""), "");
  vi.mocked(parseInvoicePdf).mockResolvedValue({ ...parsed, invoice: { ...parsed.invoice, supplier: "OpenAI" } });
  await expect(importGoogleInvoice(session, "abc", "1")).rejects.toThrow("non corrisponde");
  message.payload.parts![0].body!.size = 11 * 1024 * 1024;
  await expect(importGoogleInvoice(session, "abc", "1")).rejects.toThrow("10 MB");
  expect(uploaded).toBeUndefined();
});
it("rejects path injection", async () => {
  await expect(importGoogleInvoice(session, "../other", "1")).rejects.toThrow("non valido");
  expect(googleFetch).not.toHaveBeenCalled();
});
