export const APP_AUTH_COOKIE = "invoice_to_fic_auth";
export const APP_AUTH_MAX_AGE_SECONDS = 60 * 60 * 8;

type AppSession = {
  authenticatedAt: number;
  expiresAt: number;
};

export function getAppAuthConfigStatus() {
  const required = {
    APP_LOGIN_PASSWORD: process.env.APP_LOGIN_PASSWORD,
    APP_SESSION_SECRET: process.env.APP_SESSION_SECRET,
  };
  const missing = Object.entries(required)
    .filter(([, value]) => !value?.trim())
    .map(([key]) => key);

  return {
    configured: missing.length === 0,
    missing,
  };
}

export async function verifyAppPassword(password: string) {
  const expectedPassword = process.env.APP_LOGIN_PASSWORD?.trim();
  const sessionSecret = process.env.APP_SESSION_SECRET?.trim();

  if (!expectedPassword || !sessionSecret) {
    return false;
  }

  const [submittedDigest, expectedDigest] = await Promise.all([
    hmacSha256(password, sessionSecret),
    hmacSha256(expectedPassword, sessionSecret),
  ]);

  return constantTimeEqual(submittedDigest, expectedDigest);
}

export async function createAppSessionCookieValue() {
  const now = Date.now();
  const session: AppSession = {
    authenticatedAt: now,
    expiresAt: now + APP_AUTH_MAX_AGE_SECONDS * 1000,
  };
  const payload = toBase64Url(JSON.stringify(session));
  const signature = await sign(payload);
  return `${payload}.${signature}`;
}

export async function verifyAppSessionCookieValue(value?: string) {
  if (!value) return false;

  const [payload, signature] = value.split(".");
  if (!payload || !signature) return false;

  const expectedSignature = await sign(payload);
  if (!constantTimeEqual(signature, expectedSignature)) {
    return false;
  }

  try {
    const session = JSON.parse(fromBase64Url(payload)) as Partial<AppSession>;
    return typeof session.expiresAt === "number" && session.expiresAt > Date.now();
  } catch {
    return false;
  }
}

async function sign(value: string) {
  const secret = process.env.APP_SESSION_SECRET?.trim();
  if (!secret) return "";
  return hmacSha256(value, secret);
}

async function hmacSha256(value: string, secret: string) {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign("HMAC", key, encoder.encode(value));
  return bytesToBase64Url(new Uint8Array(signature));
}

function constantTimeEqual(left: string, right: string) {
  if (left.length !== right.length) return false;

  let diff = 0;
  for (let index = 0; index < left.length; index += 1) {
    diff |= left.charCodeAt(index) ^ right.charCodeAt(index);
  }

  return diff === 0;
}

function toBase64Url(value: string) {
  return bytesToBase64Url(new TextEncoder().encode(value));
}

function fromBase64Url(value: string) {
  const padded = value.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(value.length / 4) * 4, "=");
  const binary = atob(padded);
  return new TextDecoder().decode(Uint8Array.from(binary, (char) => char.charCodeAt(0)));
}

function bytesToBase64Url(bytes: Uint8Array) {
  let binary = "";
  bytes.forEach((byte) => {
    binary += String.fromCharCode(byte);
  });

  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}
