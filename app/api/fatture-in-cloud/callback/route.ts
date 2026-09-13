import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import {
  exchangeAuthorizationCode,
  FIC_SESSION_COOKIE,
  FIC_STATE_COOKIE,
  sealFattureInCloudSession,
} from "@/lib/fatture-in-cloud";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const returnedState = url.searchParams.get("state");
  const cookieStore = await cookies();
  const expectedState = cookieStore.get(FIC_STATE_COOKIE)?.value;
  const redirectUrl = new URL("/", request.url);

  if (!code || !returnedState || !expectedState || returnedState !== expectedState) {
    redirectUrl.searchParams.set("fic", "invalid-state");
    const response = NextResponse.redirect(redirectUrl);
    response.cookies.delete(FIC_STATE_COOKIE);
    return response;
  }

  try {
    const session = await exchangeAuthorizationCode(code);
    const response = NextResponse.redirect(new URL("/?fic=connected", request.url));
    response.cookies.delete(FIC_STATE_COOKIE);
    response.cookies.set(FIC_SESSION_COOKIE, sealFattureInCloudSession(session), {
      httpOnly: true,
      sameSite: "lax",
      secure: request.url.startsWith("https://"),
      maxAge: 60 * 60 * 24 * 30,
      path: "/",
    });
    return response;
  } catch (error) {
    redirectUrl.searchParams.set("fic", "token-error");
    const response = NextResponse.redirect(redirectUrl);
    response.cookies.delete(FIC_STATE_COOKIE);
    response.cookies.delete(FIC_SESSION_COOKIE);
    console.error("Fatture in Cloud OAuth callback failed", error);
    return response;
  }
}
