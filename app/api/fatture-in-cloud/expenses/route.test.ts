import { beforeEach, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("next/headers", () => ({ cookies: vi.fn() }));
vi.mock("@/lib/simple-auth", () => ({ APP_AUTH_COOKIE: "auth", verifyAppSessionCookieValue: vi.fn() }));
vi.mock("@/lib/fatture-in-cloud", () => ({
  FIC_SESSION_COOKIE: "fic", unsealFattureInCloudSession: vi.fn(), shouldRefreshSession: () => false,
  refreshFattureInCloudSession: vi.fn(), sealFattureInCloudSession: vi.fn(),
}));
vi.mock("@/lib/fic-expenses", () => ({
  canWriteExpenses: (scope: string) => scope === "received_documents:a",
  createReviewedExpense: vi.fn(), readExpenseTicket: vi.fn(), ticketOwner: () => "owner",
  requireCompany: vi.fn(), requireSupplier: vi.fn(), listExpenseSuppliers: vi.fn(), findExistingExpense: vi.fn(), signExpenseTicket: vi.fn(),
}));

import { cookies } from "next/headers";
import { verifyAppSessionCookieValue } from "@/lib/simple-auth";
import { unsealFattureInCloudSession } from "@/lib/fatture-in-cloud";
import { createReviewedExpense, readExpenseTicket, requireCompany, requireSupplier, findExistingExpense, signExpenseTicket } from "@/lib/fic-expenses";
import { POST } from "./route";

const request = (body: unknown, origin = "https://invoice-to-fic.vercel.app") => new Request("https://invoice-to-fic.vercel.app/api/fatture-in-cloud/expenses", {
  method: "POST", headers: { Origin: origin, "Content-Type": "application/json" }, body: JSON.stringify(body),
});

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(cookies).mockResolvedValue({ get: () => ({ value: "test-cookie" }) } as unknown as Awaited<ReturnType<typeof cookies>>);
  vi.mocked(verifyAppSessionCookieValue).mockResolvedValue(true);
  vi.mocked(unsealFattureInCloudSession).mockReturnValue({ accessToken: "mock-token", refreshToken: "mock-refresh", expiresAt: "2099-01-01", scope: "received_documents:a" });
  vi.mocked(requireCompany).mockResolvedValue({ id: 123, name: "Test", type: "company" });
  vi.mocked(requireSupplier).mockResolvedValue({ id: 8, name: "OpenAI", vat_number: "IE4143435AH" });
  vi.mocked(findExistingExpense).mockResolvedValue(undefined);
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

const draftRequest = {
  action: "preview", companyId: 123, approved: true,
  invoice: { supplier: "OpenAI", invoice_number: "IA8NO7NL-0095", invoice_date: "2026-08-31", currency: "EUR", net_amount: 13.21, tax_amount: 0, total_amount: 13.21, supplier_vat: "IE4143435AH" },
  options: { supplierId: 8, dueDate: "2026-08-31", taxDeductibility: null, vatDeductibility: null },
};
it("returns an incomplete preview without a write ticket or any write", async () => {
  const response = await POST(request(draftRequest));
  expect(response.status).toBe(200);
  expect(await response.json()).toMatchObject({ status: "needs_configuration", ticket: null, options: { taxDeductibility: null, vatDeductibility: null } });
  expect(signExpenseTicket).not.toHaveBeenCalled();
  expect(createReviewedExpense).not.toHaveBeenCalled();
  expect(findExistingExpense).toHaveBeenCalled();
});
it("issues a ticket only for a complete preview", async () => {
  vi.mocked(signExpenseTicket).mockReturnValue("signed-test-preview");
  const response = await POST(request({ ...draftRequest, options: { ...draftRequest.options, taxDeductibility: 100, vatDeductibility: 100 } }));
  expect(await response.json()).toMatchObject({ status: "ready", ticket: "signed-test-preview" });
  expect(createReviewedExpense).not.toHaveBeenCalled();
});
it("continues to block existing expenses even when preparing an incomplete draft", async () => {
  vi.mocked(findExistingExpense).mockResolvedValue({ id: 55 });
  const response = await POST(request(draftRequest));
  expect(response.status).toBe(409);
  expect(signExpenseTicket).not.toHaveBeenCalled();
  expect(createReviewedExpense).not.toHaveBeenCalled();
});
