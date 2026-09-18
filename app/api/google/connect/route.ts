import { createHash, randomBytes } from "node:crypto";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { APP_AUTH_COOKIE, verifyAppSessionCookieValue } from "@/lib/simple-auth";
import { GOOGLE_SCOPES, GOOGLE_STATE, googleConfig, googleCookieOptions, sealGoogle } from "@/lib/google-session";

export async function GET(request: Request) {
  const auth = (await cookies()).get(APP_AUTH_COOKIE)?.value;
  if (!await verifyAppSessionCookieValue(auth)) return NextResponse.json({ error: "Login richiesto." }, { status: 401 });
  if (!googleConfig().configured) return NextResponse.redirect(new URL("/?google=missing-config", request.url));
  const state = randomBytes(32).toString("base64url");
  const verifier = randomBytes(32).toString("base64url");
  const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  url.search = new URLSearchParams({ client_id: process.env.GOOGLE_CLIENT_ID!, redirect_uri: process.env.GOOGLE_REDIRECT_URI!, response_type: "code", scope: GOOGLE_SCOPES.join(" "), state, access_type: "offline", prompt: "consent", code_challenge_method: "S256", code_challenge: createHash("sha256").update(verifier).digest("base64url") }).toString();
  const response = NextResponse.redirect(url);
  response.cookies.set(GOOGLE_STATE, sealGoogle({ state, verifier, owner: createHash("sha256").update(auth!).digest("hex"), expires: Date.now() + 600000 }), { ...googleCookieOptions(request), maxAge: 600 });
  return response;
}
