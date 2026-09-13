import { NextResponse } from "next/server";
import {
  APP_AUTH_COOKIE,
  APP_AUTH_MAX_AGE_SECONDS,
  createAppSessionCookieValue,
  getAppAuthConfigStatus,
  verifyAppPassword,
} from "@/lib/simple-auth";

export async function POST(request: Request) {
  const config = getAppAuthConfigStatus();
  const formData = await request.formData();
  const password = String(formData.get("password") ?? "");
  const nextPath = sanitizeNextPath(String(formData.get("next") ?? "/"));

  if (!config.configured) {
    return redirectToLogin(request, nextPath, "missing-config");
  }

  if (!(await verifyAppPassword(password))) {
    return redirectToLogin(request, nextPath, "invalid");
  }

  const response = NextResponse.redirect(new URL(nextPath, request.url), 303);
  response.cookies.set(APP_AUTH_COOKIE, await createAppSessionCookieValue(), {
    httpOnly: true,
    sameSite: "lax",
    secure: request.url.startsWith("https://"),
    maxAge: APP_AUTH_MAX_AGE_SECONDS,
    path: "/",
  });

  return response;
}

function redirectToLogin(request: Request, nextPath: string, error: string) {
  const url = new URL("/login", request.url);
  url.searchParams.set("next", nextPath);
  url.searchParams.set("error", error);
  return NextResponse.redirect(url, 303);
}

function sanitizeNextPath(value: string) {
  if (!value.startsWith("/") || value.startsWith("//")) {
    return "/";
  }

  return value;
}
