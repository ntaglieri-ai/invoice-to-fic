import { afterEach, beforeEach, expect, it, vi } from "vitest";
vi.mock("next/headers", () => ({ cookies: vi.fn() }));
vi.mock("@/lib/fatture-in-cloud", () => ({
  exchangeAuthorizationCode: vi.fn(), FIC_SESSION_COOKIE: "fic-session", FIC_STATE_COOKIE: "fic-state", sealFattureInCloudSession: () => "sealed-session",
}));
import { cookies } from "next/headers";
import { exchangeAuthorizationCode } from "@/lib/fatture-in-cloud";
import { GET } from "./route";

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.mocked(cookies).mockResolvedValue({ get: () => ({ value: "valid-state" }) } as unknown as Awaited<ReturnType<typeof cookies>>);
});
afterEach(() => vi.restoreAllMocks());

it.each([["invalid_scope", "invalid-scope"], ["access_denied", "access-denied"], ["server_error", "authorization-error"]])("handles provider %s without attempting a token exchange", async (error, expected) => {
  const response = await GET(new Request(`https://invoice.example/api/fatture-in-cloud/callback?state=valid-state&error=${error}`));
  expect(new URL(response.headers.get("location")!).searchParams.get("fic")).toBe(expected);
  expect(exchangeAuthorizationCode).not.toHaveBeenCalled();
  expect(response.cookies.get("fic-session")).toBeUndefined();
});
it("rejects mismatched state before interpreting provider input", async () => {
  const response = await GET(new Request("https://invoice.example/api/fatture-in-cloud/callback?state=other&error=invalid_scope"));
  expect(new URL(response.headers.get("location")!).searchParams.get("fic")).toBe("invalid-state");
  expect(exchangeAuthorizationCode).not.toHaveBeenCalled();
});
it("distinguishes missing authorization code from an invalid state", async () => {
  const response = await GET(new Request("https://invoice.example/api/fatture-in-cloud/callback?state=valid-state"));
  expect(new URL(response.headers.get("location")!).searchParams.get("fic")).toBe("missing-code");
});
