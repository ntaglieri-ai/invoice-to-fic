import { afterEach, expect, it, vi } from "vitest";
import { freshGoogle, GOOGLE_SCOPES, googleFetch, googleToken, openGoogle, sealGoogle } from "./google-session";
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });
it("encrypts tokens and rejects tampering", () => {
  vi.stubEnv("APP_SESSION_SECRET", "test-secret-only");
  const sealed = sealGoogle({ refresh: "private-token" });
  expect(sealed).not.toContain("private-token");
  expect(openGoogle(sealed)).toEqual({ refresh: "private-token" });
  expect(openGoogle("AAAA" + sealed.slice(4))).toBeNull();
  vi.stubEnv("APP_SESSION_SECRET", "different");
  expect(openGoogle(sealed)).toBeNull();
});
it("rejects partial consent and never returns provider details", async () => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({ access_token: "a", refresh_token: "r", expires_in: 3600, scope: GOOGLE_SCOPES[0] })));
  await expect(googleToken({ code: "test" })).rejects.toThrow("sia Gmail sia Drive");
});
it("refreshes with the existing refresh token when Google omits a new one", async () => {
  const fetch = vi.fn().mockResolvedValue(Response.json({ access_token: "new", expires_in: 3600 })); vi.stubGlobal("fetch", fetch);
  const updated = await freshGoogle({ access: "old", refresh: "refresh", expires: 0, scope: GOOGLE_SCOPES.join(" ") });
  expect(updated.access).toBe("new"); expect(updated.refresh).toBe("refresh");
});
it("does not send access tokens to arbitrary URLs", async () => {
  const fetch = vi.fn(); vi.stubGlobal("fetch", fetch);
  await expect(googleFetch({ access: "a", refresh: "r", expires: 0, scope: "" }, "https://evil.test")).rejects.toThrow();
  expect(fetch).not.toHaveBeenCalled();
});
