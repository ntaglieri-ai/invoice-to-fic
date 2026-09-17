import { beforeEach, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
vi.mock("next/headers", () => ({ cookies: vi.fn() }));
vi.mock("@/lib/simple-auth", () => ({ APP_AUTH_COOKIE: "auth", verifyAppSessionCookieValue: vi.fn() }));
vi.mock("@/lib/fatture-in-cloud", () => ({ FIC_SESSION_COOKIE: "fic", unsealFattureInCloudSession: vi.fn(), shouldRefreshSession: vi.fn(), refreshFattureInCloudSession: vi.fn(), sealFattureInCloudSession: vi.fn() }));
vi.mock("@/lib/fic-expenses", () => ({ listExpenseSuppliers: vi.fn(), requireCompany: vi.fn(), ticketOwner: () => "owner" }));
vi.mock("@/lib/fic-td17", () => ({ createTd17: vi.fn(), previewTd17: vi.fn(), readTd17Ticket: vi.fn(), td17Settings: vi.fn() }));
import { cookies } from "next/headers";
import { verifyAppSessionCookieValue } from "@/lib/simple-auth";
import { refreshFattureInCloudSession, sealFattureInCloudSession, shouldRefreshSession, unsealFattureInCloudSession } from "@/lib/fatture-in-cloud";
import { createTd17, previewTd17, readTd17Ticket } from "@/lib/fic-td17";
import { requireCompany } from "@/lib/fic-expenses";
import { POST } from "./route";

const session = { accessToken: "test-token", refreshToken: "test-refresh", expiresAt: "2099-01-01", scope: "entity.suppliers:r received_documents:a issued_documents.self_invoices:a" };
function request(body: unknown, origin = "https://invoice.example") {
  return new Request("https://invoice.example/api/fatture-in-cloud/td17", { method: "POST", headers: { Origin: origin, "Content-Type": "application/json" }, body: JSON.stringify(body) });
}
beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(cookies).mockResolvedValue({ get: () => ({ value: "test" }) } as unknown as Awaited<ReturnType<typeof cookies>>);
  vi.mocked(verifyAppSessionCookieValue).mockResolvedValue(true);
  vi.mocked(unsealFattureInCloudSession).mockReturnValue(session);
  vi.mocked(requireCompany).mockResolvedValue({ id: 123, name: "Test", type: "company" });
});
it("requires same origin and JSON", async () => {
  expect((await POST(request({ action: "create", confirmed: true }, "https://other.example"))).status).toBe(403);
  const value = request({}); value.headers.set("Content-Type", "text/plain");
  expect((await POST(value)).status).toBe(403);
  expect(createTd17).not.toHaveBeenCalled();
});
it("requires login and OAuth", async () => {
  vi.mocked(verifyAppSessionCookieValue).mockResolvedValue(false);
  expect((await POST(request({}))).status).toBe(401);
  vi.mocked(verifyAppSessionCookieValue).mockResolvedValue(true);
  vi.mocked(unsealFattureInCloudSession).mockReturnValue(null);
  expect((await POST(request({}))).status).toBe(401);
  expect(createTd17).not.toHaveBeenCalled();
});
it("does not allow expense-only tokens to create TD17", async () => {
  vi.mocked(unsealFattureInCloudSession).mockReturnValue({ ...session, scope: "entity.suppliers:r received_documents:a" });
  expect((await POST(request({ action: "create", confirmed: true }))).status).toBe(403);
  expect(createTd17).not.toHaveBeenCalled();
});
it("requires explicit true confirmation and valid signed ticket", async () => {
  expect((await POST(request({ action: "create", confirmed: "true" }))).status).toBe(400);
  vi.mocked(readTd17Ticket).mockImplementation(() => { throw new Error("invalid ticket"); });
  expect((await POST(request({ action: "create", confirmed: true, ticket: "tampered" }))).status).toBe(400);
  expect(createTd17).not.toHaveBeenCalled();
});
it("passes only signed data to creation, ignoring injected fields", async () => {
  const signed = { companyId: 123 } as ReturnType<typeof readTd17Ticket>;
  vi.mocked(readTd17Ticket).mockReturnValue(signed);
  vi.mocked(createTd17).mockResolvedValue({ id: 7, alreadyExists: false, eiStatus: "not_sent", xmlValid: true });
  const response = await POST(request({ action: "create", confirmed: true, ticket: "signed", companyId: 999, send: true, invoice: { net_amount: 999 } }));
  expect(await response.json()).toMatchObject({ id: 7, eiStatus: "not_sent" });
  expect(createTd17).toHaveBeenCalledExactlyOnceWith("test-token", signed);
  expect(response.headers.get("cache-control")).toBe("no-store");
});
it("does not accept a send action or an unapproved invoice", async () => {
  expect((await POST(request({ action: "send", companyId: 123, confirmed: true }))).status).toBe(400);
  expect((await POST(request({ action: "preview", companyId: 123, approved: false }))).status).toBe(400);
  expect(createTd17).not.toHaveBeenCalled();
  expect(previewTd17).not.toHaveBeenCalled();
});
it("checks company access before preparing", async () => {
  vi.mocked(requireCompany).mockRejectedValue(new Error("not accessible"));
  expect((await POST(request({ action: "preview", companyId: 999, approved: true }))).status).toBe(400);
  expect(previewTd17).not.toHaveBeenCalled();
});
it("prepares without calling document creation", async () => {
  vi.mocked(previewTd17).mockResolvedValue({ existing: { id: 7, alreadyExists: true, eiStatus: "sent", xmlValid: null } });
  expect((await POST(request({ action: "preview", companyId: 123, approved: true, invoice: {}, options: {} }))).status).toBe(200);
  expect(previewTd17).toHaveBeenCalledWith("test-token", 123, {}, {}, "owner");
  expect(createTd17).not.toHaveBeenCalled();
});
it("preserves a rotated refresh token even if the operation fails", async () => {
  vi.mocked(shouldRefreshSession).mockReturnValue(true);
  vi.mocked(refreshFattureInCloudSession).mockResolvedValue({ ...session, accessToken: "new", refreshToken: "rotated" });
  vi.mocked(sealFattureInCloudSession).mockReturnValue("sealed-rotated");
  vi.mocked(requireCompany).mockRejectedValue(new Error("not accessible"));
  const response = await POST(request({ action: "preview", companyId: 123, approved: true }));
  expect(response.headers.get("set-cookie")).toContain("fic=sealed-rotated");
  expect(response.status).toBe(400);
});
it("rejects oversized and malformed input", async () => {
  expect((await POST(request({ huge: "x".repeat(16000) }))).status).toBe(413);
  expect((await POST(request(null))).status).toBe(400);
  expect(createTd17).not.toHaveBeenCalled();
});
