import { beforeEach, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
vi.mock("next/headers", () => ({ cookies: vi.fn() }));
vi.mock("@/lib/simple-auth", () => ({ APP_AUTH_COOKIE: "auth", verifyAppSessionCookieValue: vi.fn() }));
vi.mock("@/lib/fatture-in-cloud", () => ({ FIC_SESSION_COOKIE: "fic", unsealFattureInCloudSession: vi.fn(), shouldRefreshSession: () => false, refreshFattureInCloudSession: vi.fn(), sealFattureInCloudSession: vi.fn() }));
vi.mock("@/lib/fic-expenses", () => ({ ticketOwner: () => "owner" }));
vi.mock("@/lib/fic-expense-payments", () => ({ previewExpenseReversals: vi.fn(), readReversalTicket: vi.fn(), reverseExpensePayments: vi.fn() }));
import { cookies } from "next/headers";
import { verifyAppSessionCookieValue } from "@/lib/simple-auth";
import { unsealFattureInCloudSession } from "@/lib/fatture-in-cloud";
import { previewExpenseReversals, readReversalTicket, reverseExpensePayments } from "@/lib/fic-expense-payments";
import { POST } from "./route";
const session = { accessToken: "mock", refreshToken: "mock", expiresAt: "2099-01-01", scope: "received_documents:a" };
const request = (body: unknown, origin = "https://app.example") => new Request("https://app.example/api/fatture-in-cloud/expense-payments", { method: "POST", headers: { Origin: origin, "Content-Type": "application/json" }, body: JSON.stringify(body) });
beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(cookies).mockResolvedValue({ get: () => ({ value: "mock" }) } as unknown as Awaited<ReturnType<typeof cookies>>);
  vi.mocked(verifyAppSessionCookieValue).mockResolvedValue(true);
  vi.mocked(unsealFattureInCloudSession).mockReturnValue(session);
});
it("requires same-origin, authentication and expense write permission", async () => {
  expect((await POST(request({}, "https://other.example"))).status).toBe(403);
  vi.mocked(verifyAppSessionCookieValue).mockResolvedValue(false);
  expect((await POST(request({}))).status).toBe(401);
  vi.mocked(verifyAppSessionCookieValue).mockResolvedValue(true);
  vi.mocked(unsealFattureInCloudSession).mockReturnValue({ ...session, scope: "received_documents:r" });
  expect((await POST(request({ action: "reverse", confirmed: true, id: 12 }))).status).toBe(403);
  expect(reverseExpensePayments).not.toHaveBeenCalled();
});
it("previews September only and never writes on preview", async () => {
  expect((await POST(request({ action: "preview", month: "2026-10", companyId: 1, expenseIds: [12] }))).status).toBe(400);
  vi.mocked(previewExpenseReversals).mockResolvedValue({ ticket: "mock", documents: [] } as unknown as Awaited<ReturnType<typeof previewExpenseReversals>>);
  expect((await POST(request({ action: "preview", month: "2026-09", companyId: 1, expenseIds: [12] }))).status).toBe(200);
  expect(previewExpenseReversals).toHaveBeenCalledWith("mock", 1, [12], "owner");
  expect(reverseExpensePayments).not.toHaveBeenCalled();
});
it("requires a boolean confirmation and rejects unsigned writes", async () => {
  expect((await POST(request({ action: "reverse", confirmed: "true", id: 12 }))).status).toBe(400);
  vi.mocked(readReversalTicket).mockImplementation(() => { throw new Error("altered"); });
  expect((await POST(request({ action: "reverse", confirmed: true, id: 12, ticket: "bad" }))).status).toBe(400);
  expect(reverseExpensePayments).not.toHaveBeenCalled();
});
