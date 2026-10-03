import { beforeEach, afterEach, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
vi.mock("next/headers", () => ({ cookies: vi.fn() }));
vi.mock("@/lib/simple-auth", () => ({ APP_AUTH_COOKIE: "auth", verifyAppSessionCookieValue: vi.fn() }));
vi.mock("@/lib/fatture-in-cloud", () => ({ FIC_API_BASE_URL: "https://api-v2.fattureincloud.it", FIC_SESSION_COOKIE: "fic", unsealFattureInCloudSession: vi.fn(), shouldRefreshSession: () => false, refreshFattureInCloudSession: vi.fn(), sealFattureInCloudSession: vi.fn() }));
vi.mock("@/lib/fic-expenses", () => ({ requireCompany: vi.fn(), listExpenseSuppliers: vi.fn(), findExistingExpense: vi.fn() }));
vi.mock("@/lib/fic-td17", () => ({ findExistingTd17: vi.fn() }));
import { cookies } from "next/headers";
import { verifyAppSessionCookieValue } from "@/lib/simple-auth";
import { unsealFattureInCloudSession } from "@/lib/fatture-in-cloud";
import { requireCompany, listExpenseSuppliers, findExistingExpense } from "@/lib/fic-expenses";
import { findExistingTd17 } from "@/lib/fic-td17";
import { POST } from "./route";
const request = (records: unknown[], origin = "https://invoice-to-fic.vercel.app") => new Request("https://invoice-to-fic.vercel.app/api/fatture-in-cloud/processing", { method: "POST", headers: { Origin: origin, "Content-Type": "application/json" }, body: JSON.stringify({ companyId: 1, records }) });
beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(cookies).mockResolvedValue({ get: () => ({ value: "cookie" }) } as unknown as Awaited<ReturnType<typeof cookies>>);
  vi.mocked(verifyAppSessionCookieValue).mockResolvedValue(true);
  vi.mocked(unsealFattureInCloudSession).mockReturnValue({ accessToken: "mock", refreshToken: "mock", expiresAt: "2099-01-01" });
  vi.mocked(requireCompany).mockResolvedValue({ id: 1, name: "Test", type: "company" });
  vi.mocked(listExpenseSuppliers).mockResolvedValue([]);
});
afterEach(() => vi.unstubAllGlobals());
it("rejects cross-origin and unauthenticated checks", async () => {
  expect((await POST(request([], "https://other.example"))).status).toBe(403);
  vi.mocked(verifyAppSessionCookieValue).mockResolvedValue(false);
  expect((await POST(request([]))).status).toBe(401);
  expect(requireCompany).not.toHaveBeenCalled();
});
it("distinguishes missing documents from permission failures without writing to FIC", async () => {
  const fetch = vi.fn().mockResolvedValue(new Response(null, { status: 404 })); vi.stubGlobal("fetch", fetch);
  const response = await POST(request([{ key: "test", expenseId: 123, td17Id: 456 }]));
  expect(await response.json()).toEqual({ records: [{ key: "test", expenseExists: false, td17Exists: false }] });
  expect(fetch.mock.calls[0][1].method).toBeUndefined();
  fetch.mockResolvedValue(new Response(null, { status: 403 }));
  const failed = await POST(request([{ key: "test", expenseId: 123, td17Id: 456 }]));
  expect(failed.status).toBe(400); expect(await failed.json()).not.toHaveProperty("records");
});
it("recovers existing expense and TD17 IDs using supplier VAT and invoice identity", async () => {
  vi.mocked(listExpenseSuppliers).mockResolvedValue([{ id: 8, name: "OpenAI", vat_number: "IE4143435AH" }]);
  vi.mocked(findExistingExpense).mockResolvedValue({ id: 123 }); vi.mocked(findExistingTd17).mockResolvedValue({ id: 456 });
  const response = await POST(request([{ key: "test", invoice: { invoice_number: "TEST-0095", invoice_date: "2026-09-15", supplier_vat: "IE4143435AH" } }]));
  expect(await response.json()).toEqual({ records: [{ key: "test", expenseId: 123, td17Id: 456 }] });
});
