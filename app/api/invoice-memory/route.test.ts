import { beforeEach, afterEach, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
vi.mock("next/headers", () => ({ cookies: vi.fn() }));
vi.mock("@/lib/simple-auth", () => ({ APP_AUTH_COOKIE: "auth", verifyAppSessionCookieValue: vi.fn() }));
vi.mock("@/lib/google-session", () => ({ GOOGLE_COOKIE: "google", openGoogle: vi.fn(), freshGoogle: vi.fn(), sealGoogle: () => "refreshed-google", googleCookieOptions: () => ({ path: "/" }), googleFetch: vi.fn() }));
vi.mock("@/lib/fatture-in-cloud", () => ({ FIC_SESSION_COOKIE: "fic", unsealFattureInCloudSession: vi.fn(), shouldRefreshSession: () => false, refreshFattureInCloudSession: vi.fn(), sealFattureInCloudSession: () => "refreshed-fic" }));
vi.mock("@/lib/fic-expenses", () => ({ requireCompany: vi.fn() }));
vi.mock("@/lib/drive-invoice-memory", () => ({ loadInvoiceMemory: vi.fn(), saveInvoiceMemory: vi.fn(), MemoryConflict: class MemoryConflict extends Error {} }));
import { cookies } from "next/headers";
import { verifyAppSessionCookieValue } from "@/lib/simple-auth";
import { openGoogle, freshGoogle, googleFetch } from "@/lib/google-session";
import { unsealFattureInCloudSession } from "@/lib/fatture-in-cloud";
import { requireCompany } from "@/lib/fic-expenses";
import { loadInvoiceMemory, saveInvoiceMemory } from "@/lib/drive-invoice-memory";
import { POST } from "./route";
const request = (body: unknown = { companyId: 17, action: "load" }, origin = "https://invoice-to-fic.vercel.app") => new Request("https://invoice-to-fic.vercel.app/api/invoice-memory", { method: "POST", headers: { Origin: origin, "Content-Type": "application/json" }, body: JSON.stringify(body) });
beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(cookies).mockResolvedValue({ get: () => ({ value: "cookie" }) } as unknown as Awaited<ReturnType<typeof cookies>>);
  vi.mocked(verifyAppSessionCookieValue).mockResolvedValue(true);
  vi.mocked(openGoogle).mockReturnValue({ access: "old", refresh: "mock", expires: 0, scope: "" });
  vi.mocked(freshGoogle).mockResolvedValue({ access: "fresh", refresh: "mock", expires: 9999999999999, scope: "" });
  vi.mocked(unsealFattureInCloudSession).mockReturnValue({ accessToken: "mock", refreshToken: "mock", expiresAt: "2099-01-01" });
  vi.mocked(requireCompany).mockResolvedValue({ id: 17, name: "Test", type: "company" });
  vi.mocked(loadInvoiceMemory).mockResolvedValue({ records: {}, accepted: new Set(), seen: new Set(), files: [], unfolded: 0 });
  vi.mocked(googleFetch).mockResolvedValue(Response.json({ user: { permissionId: "account17" } }));
});
afterEach(() => vi.restoreAllMocks());
it("requires same-origin requests, app login and both OAuth sessions", async () => {
  expect((await POST(request({}, "https://other.example"))).status).toBe(403);
  vi.mocked(verifyAppSessionCookieValue).mockResolvedValue(false);
  expect((await POST(request())).status).toBe(401);
  vi.mocked(verifyAppSessionCookieValue).mockResolvedValue(true);
  vi.mocked(openGoogle).mockReturnValue(null);
  expect((await POST(request())).status).toBe(401);
  expect(loadInvoiceMemory).not.toHaveBeenCalled();
});
it("checks company membership before reading or writing registry data", async () => {
  vi.mocked(requireCompany).mockRejectedValue(new Error("Azienda non autorizzata."));
  expect((await POST(request())).status).toBe(400);
  expect(loadInvoiceMemory).not.toHaveBeenCalled();
  expect(saveInvoiceMemory).not.toHaveBeenCalled();
});
it("returns account-scoped records without OAuth credentials and persists refreshed sessions", async () => {
  const response = await POST(request());
  expect(await response.json()).toEqual({ records: {}, accountId: "account17" });
  expect(response.headers.get("set-cookie")).toContain("refreshed-google");
  expect(requireCompany).toHaveBeenCalledWith("mock", 17);
  expect(response.headers.get("cache-control")).toBe("no-store");
});
it("validates save payloads and never converts a failed read into an empty memory", async () => {
  expect((await POST(request({ companyId: 17, action: "save", event: { changes: [] } }))).status).toBe(400);
  expect(saveInvoiceMemory).not.toHaveBeenCalled();
  vi.mocked(loadInvoiceMemory).mockRejectedValue(new Error("Drive non disponibile."));
  const response = await POST(request());
  expect(response.status).toBe(400);
  expect(await response.json()).not.toHaveProperty("records");
  expect(response.headers.get("set-cookie")).toContain("refreshed-google");
});
