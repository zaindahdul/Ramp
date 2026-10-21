import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE } from "@/lib/session-cookie";

// Cheap gate: bounce visitors without a session cookie to /login. Pages still
// validate the session against the database (requireSession), and API routes
// check it themselves, so a forged or expired cookie gets nowhere.
export function proxy(request: NextRequest) {
  if (request.cookies.has(SESSION_COOKIE)) return NextResponse.next();
  const login = new URL("/login", request.url);
  const next = request.nextUrl.pathname + request.nextUrl.search;
  if (next !== "/") login.searchParams.set("next", next);
  return NextResponse.redirect(login);
}

export const config = {
  matcher: ["/((?!api|_next/static|_next/image|favicon.ico|login|signup).*)"],
};
