import { afterEach, expect, it, vi } from "vitest";
import { freshGoogle, GOOGLE_SCOPES, googleFetch, googleToken, openGoogle, sealGoogle } from "./google-session";
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); vi.useRealTimers(); vi.restoreAllMocks(); });
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
const session = { access: "a", refresh: "r", expires: 0, scope: "" };
it.each([
  ["storageQuotaExceeded", "Spazio Google Drive esaurito"],
  ["insufficientPermissions", "Accesso Drive negato"],
  ["dailyLimitExceeded", "Quota giornaliera"],
])("explains Google 403 %s without exposing provider messages", async (reason, message) => {
  const fetch = vi.fn().mockResolvedValue(Response.json({ error: { message: "private-token", errors: [{ reason }] } }, { status: 403 }));
  vi.stubGlobal("fetch", fetch); const log = vi.spyOn(console, "warn").mockImplementation(() => {});
  await expect(googleFetch(session, "/drive/v3/files")).rejects.toThrow(message);
  expect(fetch).toHaveBeenCalledTimes(1);
  expect(JSON.stringify(log.mock.calls)).not.toContain("private-token");
});
it("retries a temporary read limit with backoff", async () => {
  vi.useFakeTimers();
  const fetch = vi.fn().mockResolvedValueOnce(Response.json({ error: { errors: [{ reason: "userRateLimitExceeded" }] } }, { status: 403 })).mockResolvedValueOnce(Response.json({ files: [] }));
  vi.stubGlobal("fetch", fetch);
  const result = googleFetch(session, "/drive/v3/files");
  await vi.runAllTimersAsync();
  expect((await result).ok).toBe(true); expect(fetch).toHaveBeenCalledTimes(2);
});
it("never retries an uncertain upload", async () => {
  const fetch = vi.fn().mockResolvedValue(Response.json({}, { status: 503 })); vi.stubGlobal("fetch", fetch);
  vi.spyOn(console, "warn").mockImplementation(() => {});
  await expect(googleFetch(session, "/upload/drive/v3/files", { method: "POST", body: "pdf" })).rejects.toThrow("temporaneamente");
  expect(fetch).toHaveBeenCalledTimes(1);
});
