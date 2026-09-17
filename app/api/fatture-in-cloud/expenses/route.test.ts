import { beforeEach, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("next/headers", () => ({ cookies: vi.fn() }));
vi.mock("@/lib/simple-auth", () => ({ APP_AUTH_COOKIE: "auth", verifyAppSessionCookieValue: vi.fn() }));
vi.mock("@/lib/fatture-in-cloud", () => ({
  FIC_SESSION_COOKIE: "fic", unsealFattureInCloudSession: vi.fn(), shouldRefreshSession: () => false,
  refreshFattureInCloudSession: vi.fn(), sealFattureInCloudSession: vi.fn(),
}));
vi.mock("@/lib/fic-expenses", () => ({
  canWriteExpenses: (scope: string) => scope === "received_documents:rw",
  createReviewedExpense: vi.fn(), readExpenseTicket: vi.fn(), ticketOwner: () => "owner",
  requireCompany: vi.fn(), requireSupplier: vi.fn(), listExpenseSuppliers: vi.fn(), findExistingExpense: vi.fn(), signExpenseTicket: vi.fn(),
}));

import { cookies } from "next/headers";
import { verifyAppSessionCookieValue } from "@/lib/simple-auth";
import { unsealFattureInCloudSession } from "@/lib/fatture-in-cloud";
import { createReviewedExpense, readExpenseTicket } from "@/lib/fic-expenses";
import { POST } from "./route";

const request = (body: unknown, origin = "https://invoice-to-fic.vercel.app") => new Request("https://invoice-to-fic.vercel.app/api/fatture-in-cloud/expenses", {
  method: "POST", headers: { Origin: origin, "Content-Type": "application/json" }, body: JSON.stringify(body),
});

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(cookies).mockResolvedValue({ get: () => ({ value: "test-cookie" }) } as unknown as Awaited<ReturnType<typeof cookies>>);
  vi.mocked(verifyAppSessionCookieValue).mockResolvedValue(true);
  vi.mocked(unsealFattureInCloudSession).mockReturnValue({ accessToken: "mock-token", refreshToken: "mock-refresh", expiresAt: "2099-01-01", scope: "received_documents:rw" });
});

it("rejects cross-origin requests before any write", async () => {
  expect((await POST(request({ action: "create", confirmed: true }, "https://other.example"))).status).toBe(403);
  expect(createReviewedExpense).not.toHaveBeenCalled();
});
it("requires application login", async () => {
  vi.mocked(verifyAppSessionCookieValue).mockResolvedValue(false);
  expect((await POST(request({ action: "create", confirmed: true }))).status).toBe(401);
  expect(createReviewedExpense).not.toHaveBeenCalled();
});
it("requires OAuth connection", async () => {
  vi.mocked(unsealFattureInCloudSession).mockReturnValue(null);
  expect((await POST(request({ action: "create", confirmed: true }))).status).toBe(401);
  expect(createReviewedExpense).not.toHaveBeenCalled();
});
it("requires write permission even with a valid application login", async () => {
  vi.mocked(unsealFattureInCloudSession).mockReturnValue({ accessToken: "mock-token", refreshToken: "mock-refresh", expiresAt: "2099-01-01", scope: "received_documents:r" });
  expect((await POST(request({ action: "create", confirmed: true }))).status).toBe(403);
  expect(createReviewedExpense).not.toHaveBeenCalled();
});
it("requires explicit confirmation and does not accept truthy strings", async () => {
  expect((await POST(request({ action: "create", confirmed: "true" }))).status).toBe(400);
  expect(createReviewedExpense).not.toHaveBeenCalled();
});
it("requires a valid preview ticket before a write", async () => {
  vi.mocked(readExpenseTicket).mockImplementation(() => { throw new Error("Anteprima non valida."); });
  expect((await POST(request({ action: "create", confirmed: true, ticket: "tampered" }))).status).toBe(400);
  expect(createReviewedExpense).not.toHaveBeenCalled();
});
