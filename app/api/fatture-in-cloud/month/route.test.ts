import { beforeEach, expect, it, vi } from "vitest";
vi.mock("next/headers", () => ({ cookies: vi.fn() }));
vi.mock("@/lib/simple-auth", () => ({ APP_AUTH_COOKIE: "auth", verifyAppSessionCookieValue: vi.fn() }));
vi.mock("@/lib/fatture-in-cloud", () => ({ FIC_SESSION_COOKIE: "fic", unsealFattureInCloudSession: vi.fn(), shouldRefreshSession: () => false, refreshFattureInCloudSession: vi.fn(), sealFattureInCloudSession: vi.fn() }));
vi.mock("@/lib/fic-expenses", () => ({ requireCompany: vi.fn() }));
vi.mock("@/lib/fic-month", () => ({ loadFicMonth: vi.fn() }));
import { cookies } from "next/headers";
import { verifyAppSessionCookieValue } from "@/lib/simple-auth";
import { unsealFattureInCloudSession } from "@/lib/fatture-in-cloud";
import { requireCompany } from "@/lib/fic-expenses";
import { loadFicMonth } from "@/lib/fic-month";
import { POST } from "./route";
const request = (month = "2026-09", origin = "https://invoice-to-fic.vercel.app") => new Request("https://invoice-to-fic.vercel.app/api/fatture-in-cloud/month", { method: "POST", headers: { Origin: origin, "Content-Type": "application/json" }, body: JSON.stringify({ companyId: 1, month }) });
beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(cookies).mockResolvedValue({ get: () => ({ value: "cookie" }) } as unknown as Awaited<ReturnType<typeof cookies>>);
  vi.mocked(verifyAppSessionCookieValue).mockResolvedValue(true);
  vi.mocked(unsealFattureInCloudSession).mockReturnValue({ accessToken: "mock", refreshToken: "mock", expiresAt: "2099-01-01" });
  vi.mocked(loadFicMonth).mockResolvedValue([]);
});
it("rejects cross-origin, logged-out and disconnected requests", async () => {
  expect((await POST(request("2026-09", "https://other.example"))).status).toBe(403);
  vi.mocked(verifyAppSessionCookieValue).mockResolvedValue(false);
  expect((await POST(request())).status).toBe(401);
  vi.mocked(verifyAppSessionCookieValue).mockResolvedValue(true);
  vi.mocked(unsealFattureInCloudSession).mockReturnValue(null);
  expect((await POST(request())).status).toBe(401);
  expect(loadFicMonth).not.toHaveBeenCalled();
});
it("validates month and company membership before reading", async () => {
  expect((await POST(request("2026-99"))).status).toBe(400);
  vi.mocked(requireCompany).mockRejectedValue(new Error("Forbidden"));
  expect((await POST(request())).status).toBe(400);
  expect(loadFicMonth).not.toHaveBeenCalled();
});
it("returns an authenticated empty month, not a false failure", async () => {
  const response = await POST(request());
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ invoices: [] });
  expect(loadFicMonth).toHaveBeenCalledWith("mock", 1, "2026-09");
});
it("does not turn read errors into empty success or leak credentials", async () => {
  vi.mocked(loadFicMonth).mockRejectedValue(new Error("Bearer private-token"));
  const response = await POST(request());
  expect(response.status).toBe(400);
  const body = await response.json();
  expect(body).not.toHaveProperty("invoices");
  expect(JSON.stringify(body)).not.toContain("private-token");
});
