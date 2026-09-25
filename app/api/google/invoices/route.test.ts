import { beforeEach, expect, it, vi } from "vitest";
vi.mock("next/headers", () => ({ cookies: vi.fn() }));
vi.mock("@/lib/simple-auth", () => ({ APP_AUTH_COOKIE: "auth", verifyAppSessionCookieValue: vi.fn() }));
vi.mock("@/lib/google-session", async (importOriginal) => ({ ...await importOriginal<typeof import("@/lib/google-session")>(), GOOGLE_COOKIE: "google", GOOGLE_STATE: "state", freshGoogle: vi.fn(), openGoogle: vi.fn(), sealGoogle: () => "sealed", googleConfig: () => ({ configured: true }), googleCookieOptions: () => ({ httpOnly: true }) }));
vi.mock("@/lib/google-invoices", () => ({ importGoogleInvoice: vi.fn(), scanGoogleInvoices: vi.fn() }));
import { cookies } from "next/headers";
import { verifyAppSessionCookieValue } from "@/lib/simple-auth";
import { freshGoogle, openGoogle, GoogleApiError } from "@/lib/google-session";
import { importGoogleInvoice, scanGoogleInvoices } from "@/lib/google-invoices";
import { GET, POST } from "./route";
const session = { access: "a", refresh: "r", expires: 0, scope: "" };
const request = (body: unknown, origin = "https://app.test") => new Request("https://app.test/api/google/invoices", { method: "POST", headers: { Origin: origin, "Content-Type": "application/json" }, body: JSON.stringify(body) });
beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(cookies).mockResolvedValue({ get: () => ({ value: "test" }) } as unknown as Awaited<ReturnType<typeof cookies>>);
  vi.mocked(verifyAppSessionCookieValue).mockResolvedValue(true);
  vi.mocked(openGoogle).mockReturnValue(session); vi.mocked(freshGoogle).mockResolvedValue(session);
});
it("requires app authentication for status and import", async () => {
  vi.mocked(verifyAppSessionCookieValue).mockResolvedValue(false);
  expect((await GET()).status).toBe(401); expect((await POST(request({}))).status).toBe(401);
  expect(importGoogleInvoice).not.toHaveBeenCalled();
});
it("rejects CSRF, non-JSON and oversized input", async () => {
  expect((await POST(request({}, "https://evil.test"))).status).toBe(403);
  const r = request({}); r.headers.set("Content-Type", "text/plain");
  expect((await POST(r)).status).toBe(403);
  expect((await POST(request({ content: "a".repeat(5000) }))).status).toBe(413);
});
it("requires OAuth and refuses unknown actions", async () => {
  expect((await POST(request({ action: "send" }))).status).toBe(400);
  vi.mocked(openGoogle).mockReturnValue(null);
  expect((await POST(request({ action: "scan", month: "2026-09" }))).status).toBe(401);
});
it("refreshes cookie on error and does not leak URLs", async () => {
  vi.mocked(importGoogleInvoice).mockRejectedValue(new Error("Failed https://example.com/private-token"));
  const response = await POST(request({ action: "import", messageId: "abc", partId: "1" }));
  expect(response.headers.get("set-cookie")).toContain("google=sealed");
  expect(JSON.stringify(await response.json())).not.toContain("private-token");
});
it("tells the client to stop the batch on a Google quota error", async () => {
  vi.mocked(importGoogleInvoice).mockRejectedValue(new GoogleApiError("Drive (403): Spazio esaurito.", true));
  const response = await POST(request({ action: "import", messageId: "abc", partId: "1" }));
  expect(await response.json()).toMatchObject({ stopBatch: true });
});
it("scans without archiving anything", async () => {
  vi.mocked(scanGoogleInvoices).mockResolvedValue({ items: [], nextPageToken: null });
  const r = await POST(request({ action: "scan", month: "2026-09" }));
  expect(r.status).toBe(200); expect(importGoogleInvoice).not.toHaveBeenCalled();
});
it("passes the selected supplier and cursor to Gmail search", async () => {
  vi.mocked(scanGoogleInvoices).mockResolvedValue({ items: [], nextPageToken: null });
  const r = await POST(request({ action: "scan", month: "2026-09", supplier: "Anthropic", pageToken: "next" }));
  expect(r.status).toBe(200);
  expect(scanGoogleInvoices).toHaveBeenCalledWith(session, "2026-09", "next", "Anthropic");
  expect(importGoogleInvoice).not.toHaveBeenCalled();
});
it("disconnect clears cookies without deleting Drive files", async () => {
  const r = await POST(request({ action: "disconnect" }));
  expect(r.headers.get("set-cookie")).toContain("google=;");
  expect(importGoogleInvoice).not.toHaveBeenCalled();
});
