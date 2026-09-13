import { NextResponse } from "next/server";
import { APP_AUTH_COOKIE } from "@/lib/simple-auth";

export async function POST(request: Request) {
  const response = NextResponse.redirect(new URL("/login", request.url));
  response.cookies.delete(APP_AUTH_COOKIE);
  return response;
}
