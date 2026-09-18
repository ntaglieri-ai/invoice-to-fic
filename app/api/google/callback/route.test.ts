import { createHash } from "node:crypto";
import { beforeEach, expect, it, vi } from "vitest";
vi.mock("next/headers", () => ({ cookies: vi.fn() }));
vi.mock("@/lib/simple-auth", () => ({ APP_AUTH_COOKIE: "auth", verifyAppSessionCookieValue: vi.fn() }));
vi.mock("@/lib/google-session", () => ({ GOOGLE_COOKIE: "google", GOOGLE_STATE: "state", googleToken: vi.fn(), openGoogle: vi.fn(), sealGoogle: () => "sealed", googleCookieOptions: () => ({ httpOnly: true }) }));
import { cookies } from "next/headers";
import { verifyAppSessionCookieValue } from "@/lib/simple-auth";
import { googleToken, openGoogle } from "@/lib/google-session";
import { GET } from "./route";
beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(cookies).mockResolvedValue({ get: () => ({ value: "test" }) } as unknown as Awaited<ReturnType<typeof cookies>>);
  vi.mocked(verifyAppSessionCookieValue).mockResolvedValue(true);
  vi.mocked(openGoogle).mockReturnValue({ state: "valid", verifier: "pkce", owner: createHash("sha256").update("test").digest("hex"), expires: Date.now() + 100000 });
});
it("rejects wrong state without exchanging code", async () => {
  const r = await GET(new Request("https://app.test/api/google/callback?state=bad&code=code"));
  expect(r.headers.get("location")).toContain("authorization-error"); expect(googleToken).not.toHaveBeenCalled();
});
it("rejects missing app auth and expired state", async () => {
  vi.mocked(verifyAppSessionCookieValue).mockResolvedValue(false);
  await GET(new Request("https://app.test/api/google/callback?state=valid&code=code"));
  expect(googleToken).not.toHaveBeenCalled();
  vi.mocked(verifyAppSessionCookieValue).mockResolvedValue(true);
  vi.mocked(openGoogle).mockReturnValue({ state: "valid", expires: 0 });
  await GET(new Request("https://app.test/api/google/callback?state=valid&code=code"));
  expect(googleToken).not.toHaveBeenCalled();
});
it("uses PKCE and writes only encrypted cookie", async () => {
  vi.mocked(googleToken).mockResolvedValue({ access: "private", refresh: "secret", scope: "", expires: 100 });
  const r = await GET(new Request("https://app.test/api/google/callback?state=valid&code=code"));
  expect(googleToken).toHaveBeenCalledWith(expect.objectContaining({ code_verifier: "pkce" }));
  expect(r.headers.get("set-cookie")).toContain("google=sealed");
  expect(r.headers.get("location")).toBe("https://app.test/?google=connected");
  expect(r.headers.get("set-cookie")).not.toContain("private");
});
