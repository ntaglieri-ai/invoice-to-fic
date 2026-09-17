import { afterEach, beforeEach, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));

import { buildFattureInCloudAuthorizationUrl, ficFetch } from "@/lib/fatture-in-cloud";
import { canPrepareTd17, canWriteExpenses, ficConnectionNotice } from "@/lib/fic-permissions";

beforeEach(() => {
  vi.stubEnv("FIC_CLIENT_ID", "test-id");
  vi.stubEnv("FIC_CLIENT_SECRET", "test-secret");
  vi.stubEnv("FIC_SESSION_SECRET", "test-session-secret");
  vi.stubEnv("FIC_REDIRECT_URI", "https://invoice.example/api/fatture-in-cloud/callback");
  vi.stubEnv("FIC_SCOPES", "");
});
afterEach(() => vi.unstubAllEnvs());

it("requests the documented FIC :a write permission and never :rw", () => {
  // Contract: https://developers.fattureincloud.it/docs/basics/scopes/
  const url = buildFattureInCloudAuthorizationUrl("test-state");
  expect(url.searchParams.get("scope")).toBe("entity.suppliers:r received_documents:a issued_documents.self_invoices:a");
  expect(url.searchParams.get("state")).toBe("test-state");
});
it("removes legacy invalid scopes even if they are set in the environment", () => {
  vi.stubEnv("FIC_SCOPES", "received_documents:rw received_documents:r entity.suppliers:r");
  expect(buildFattureInCloudAuthorizationUrl("test-state").searchParams.get("scope")).toBe("entity.suppliers:r received_documents:a issued_documents.self_invoices:a");
});
it("accepts full access but rejects unknown and read-only permissions", () => {
  expect(canWriteExpenses("entity.suppliers:r received_documents:a")).toBe(true);
  for (const scope of [undefined, "received_documents:r", "received_documents:rw"]) expect(canWriteExpenses(scope)).toBe(false);
});
it("requires the specific self invoice scope and read access to suppliers and expenses", () => {
  expect(canPrepareTd17("entity.suppliers:r received_documents:a issued_documents.self_invoices:a")).toBe(true);
  expect(canPrepareTd17("entity.suppliers:r received_documents:r issued_documents.self_invoices:a")).toBe(true);
  for (const scope of [undefined, "received_documents:a", "issued_documents.self_invoices:a", "entity.suppliers:r received_documents:a issued_documents.self_invoices:r"]) expect(canPrepareTd17(scope)).toBe(false);
});
it("blocks SDI transmission in the shared API client before network access", async () => {
  const network = vi.spyOn(globalThis, "fetch");
  try {
    await expect(ficFetch("test", "/c/123/issued_documents/900/e_invoice/send", { method: "POST" })).rejects.toThrow("Invio SDI disabilitato");
    expect(network).not.toHaveBeenCalled();
  } finally { network.mockRestore(); }
});
it.each(["invalid-scope", "access-denied", "authorization-error", "invalid-state", "missing-code", "token-error", "missing-config"])("shows an actionable message for %s", (result) => {
  expect(ficConnectionNotice(result, true, "received_documents:r")).toMatchObject({ error: true, message: expect.any(String) });
});
it("only reports successful write authorization when actually connected with write permission", () => {
  expect(ficConnectionNotice("connected", true, "received_documents:a")?.error).toBe(false);
  expect(ficConnectionNotice("connected", true, "received_documents:r")?.error).toBe(true);
  expect(ficConnectionNotice("connected", false, "received_documents:a")?.error).toBe(true);
  expect(ficConnectionNotice(null, true)).toBeNull();
});
