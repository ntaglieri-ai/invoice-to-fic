import "server-only";

import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import type { InvoiceFields } from "@/lib/types";
import { FIC_EXPENSE_WRITE_SCOPE, FIC_TD17_WRITE_SCOPE } from "@/lib/fic-permissions";

export type ReverseChargeMode = "none" | "td17" | "td18";

export const FIC_API_BASE_URL = "https://api-v2.fattureincloud.it";
export const FIC_SESSION_COOKIE = "fic_oauth_session";
export const FIC_STATE_COOKIE = "fic_oauth_state";
export const FIC_DEFAULT_SCOPES = ["entity.suppliers:r", FIC_EXPENSE_WRITE_SCOPE, FIC_TD17_WRITE_SCOPE] as const;

export type FattureInCloudDraftExpense = {
  supplierName: string;
  supplierVat: string;
  invoiceNumber: string;
  invoiceDate: string;
  currency: string;
  netAmount: number;
  taxAmount: number;
  totalAmount: number;
  reverseChargeMode: ReverseChargeMode;
  source: "manual_review";
};

export type FattureInCloudOAuthSession = {
  accessToken: string;
  refreshToken: string;
  expiresAt: string;
  scope?: string;
};

export type FattureInCloudCompany = {
  vat_number?: string | null;
  id: number | null;
  name: string | null;
  type: "company" | "accountant" | string | null;
  controlled_companies?: FattureInCloudCompany[] | null;
};

export type FattureInCloudConfigStatus = {
  configured: boolean;
  missing: string[];
  redirectUri: string;
  scopes: string[];
};

export function buildDraftExpense(invoice: InvoiceFields): FattureInCloudDraftExpense {
  if (invoice.net_amount === null || invoice.tax_amount === null || invoice.total_amount === null) {
    throw new Error("La fattura deve avere imponibile, IVA e totale prima della fase FIC.");
  }

  return {
    supplierName: invoice.supplier,
    supplierVat: invoice.supplier_vat,
    invoiceNumber: invoice.invoice_number,
    invoiceDate: invoice.invoice_date,
    currency: invoice.currency,
    netAmount: invoice.net_amount,
    taxAmount: invoice.tax_amount,
    totalAmount: invoice.total_amount,
    reverseChargeMode: "none",
    source: "manual_review",
  };
}

export function getFattureInCloudConfigStatus(): FattureInCloudConfigStatus {
  const required = {
    FIC_CLIENT_ID: process.env.FIC_CLIENT_ID,
    FIC_CLIENT_SECRET: process.env.FIC_CLIENT_SECRET,
    FIC_REDIRECT_URI: process.env.FIC_REDIRECT_URI,
    FIC_SESSION_SECRET: process.env.FIC_SESSION_SECRET,
  };
  const missing = Object.entries(required)
    .filter(([, value]) => !value?.trim())
    .map(([key]) => key);

  return {
    configured: missing.length === 0,
    missing,
    redirectUri: process.env.FIC_REDIRECT_URI?.trim() ?? "",
    scopes: getConfiguredScopes(),
  };
}

export function buildFattureInCloudAuthorizationUrl(state: string) {
  const config = getRequiredConfig();
  const url = new URL("/oauth/authorize", FIC_API_BASE_URL);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("client_id", config.clientId);
  url.searchParams.set("redirect_uri", config.redirectUri);
  url.searchParams.set("scope", config.scopes.join(" "));
  url.searchParams.set("state", state);
  return url;
}

export async function exchangeAuthorizationCode(code: string): Promise<FattureInCloudOAuthSession> {
  const config = getRequiredConfig();
  const session = await requestToken({
    grant_type: "authorization_code",
    client_id: config.clientId,
    client_secret: config.clientSecret,
    redirect_uri: config.redirectUri,
    code,
  });
  // OAuth omits scope when the granted set equals the requested set.
  return { ...session, scope: session.scope ?? config.scopes.join(" ") };
}

export async function refreshFattureInCloudSession(
  session: FattureInCloudOAuthSession,
): Promise<FattureInCloudOAuthSession> {
  const config = getRequiredConfig();
  const refreshed = await requestToken({
    grant_type: "refresh_token",
    client_id: config.clientId,
    client_secret: config.clientSecret,
    refresh_token: session.refreshToken,
  });
  return { ...refreshed, scope: refreshed.scope ?? session.scope };
}

export function shouldRefreshSession(session: FattureInCloudOAuthSession) {
  const refreshBufferMs = 5 * 60 * 1000;
  return new Date(session.expiresAt).getTime() - Date.now() < refreshBufferMs;
}

export async function listUserCompanies(accessToken: string): Promise<FattureInCloudCompany[]> {
  const response = await ficFetch<{ data?: { companies?: FattureInCloudCompany[] } }>(
    accessToken,
    "/user/companies",
  );
  return response.data?.companies ?? [];
}

export async function ficFetch<T>(accessToken: string, path: string, init: RequestInit = {}): Promise<T> {
  if (/\/e_invoice\/send\/?$/.test(new URL(path, FIC_API_BASE_URL).pathname)) {
    throw new Error("Invio SDI disabilitato nell'app. Conferma l'invio direttamente in Fatture in Cloud.");
  }
  const response = await fetch(new URL(path, FIC_API_BASE_URL), {
    ...init,
    cache: "no-store",
    signal: init.signal ?? AbortSignal.timeout(20000),
    headers: {
      Accept: "application/json",
      Authorization: `Bearer ${accessToken}`,
      ...(init.body ? { "Content-Type": "application/json" } : {}),
      ...init.headers,
    },
  });

  return parseFicResponse<T>(response);
}

export function sealFattureInCloudSession(session: FattureInCloudOAuthSession) {
  const iv = randomBytes(12);
  const key = getSessionKey();
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const encrypted = Buffer.concat([cipher.update(JSON.stringify(session), "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, encrypted]).toString("base64url");
}

export function unsealFattureInCloudSession(value: string): FattureInCloudOAuthSession | null {
  try {
    const payload = Buffer.from(value, "base64url");
    const iv = payload.subarray(0, 12);
    const tag = payload.subarray(12, 28);
    const encrypted = payload.subarray(28);
    const decipher = createDecipheriv("aes-256-gcm", getSessionKey(), iv);
    decipher.setAuthTag(tag);
    const decrypted = Buffer.concat([decipher.update(encrypted), decipher.final()]).toString("utf8");
    const session = JSON.parse(decrypted) as Partial<FattureInCloudOAuthSession>;

    if (!session.accessToken || !session.refreshToken || !session.expiresAt) {
      return null;
    }

    return {
      accessToken: session.accessToken,
      refreshToken: session.refreshToken,
      expiresAt: session.expiresAt,
      scope: session.scope,
    };
  } catch {
    return null;
  }
}

function getConfiguredScopes() {
  return [...new Set([
    ...(process.env.FIC_SCOPES?.split(/\s+/).filter(Boolean) ?? []),
    ...FIC_DEFAULT_SCOPES,
  ])].filter((scope) => scope !== "received_documents:r" && scope !== "received_documents:rw");
}

function getRequiredConfig() {
  const status = getFattureInCloudConfigStatus();
  if (!status.configured) {
    throw new Error(`Configurazione Fatture in Cloud incompleta: ${status.missing.join(", ")}`);
  }

  return {
    clientId: process.env.FIC_CLIENT_ID!.trim(),
    clientSecret: process.env.FIC_CLIENT_SECRET!.trim(),
    redirectUri: process.env.FIC_REDIRECT_URI!.trim(),
    scopes: status.scopes,
  };
}

function getSessionKey() {
  const secret = process.env.FIC_SESSION_SECRET?.trim();
  if (!secret) {
    throw new Error("FIC_SESSION_SECRET non configurato.");
  }
  return createHash("sha256").update(secret).digest();
}

async function requestToken(body: Record<string, string>): Promise<FattureInCloudOAuthSession> {
  const response = await fetch(new URL("/oauth/token", FIC_API_BASE_URL), {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  const payload = await parseFicResponse<{
    access_token?: string;
    refresh_token?: string;
    expires_in?: number;
    scope?: string;
  }>(response);

  if (!payload.access_token || !payload.refresh_token || !payload.expires_in) {
    throw new Error("Risposta OAuth Fatture in Cloud incompleta.");
  }

  return {
    accessToken: payload.access_token,
    refreshToken: payload.refresh_token,
    expiresAt: new Date(Date.now() + payload.expires_in * 1000).toISOString(),
    scope: payload.scope,
  };
}

async function parseFicResponse<T>(response: Response): Promise<T> {
  const text = await response.text();
  let payload;
  try {
    payload = text ? JSON.parse(text) : {};
  } catch {
    throw new Error(`Risposta Fatture in Cloud non valida (${response.status}).`);
  }

  if (!response.ok) {
    const message =
      payload?.error_description ??
      payload?.message ??
      payload?.error?.message ??
      `Errore Fatture in Cloud ${response.status}`;
    throw new Error(typeof message === "string" ? message : `Errore Fatture in Cloud ${response.status}`);
  }

  return payload as T;
}
