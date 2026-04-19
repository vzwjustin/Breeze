import { NextRequest, NextResponse } from "next/server";

/**
 * Lightweight middleware guard for API routes.
 *
 * Full session verification (including DB lookup) is handled per-route by
 * requireUser(). This middleware provides a fast early-return for requests
 * that have no session cookie at all, avoiding unnecessary DB round-trips.
 *
 * Note: next-auth v5 with strategy:"database" cannot validate sessions in
 * the Edge Runtime because the DB adapter requires Node.js crypto APIs.
 * A cookie presence check here is sufficient for the first gate; the route
 * handler performs the authoritative check.
 */
export function middleware(req: NextRequest) {
  if (
    req.nextUrl.pathname.startsWith("/api") &&
    !req.nextUrl.pathname.startsWith("/api/auth")
  ) {
    // Check for any next-auth session cookie (v5 uses "authjs.session-token"
    // or the legacy "__Secure-next-auth.session-token" name).
    const hasSession =
      req.cookies.has("authjs.session-token") ||
      req.cookies.has("__Secure-authjs.session-token") ||
      req.cookies.has("next-auth.session-token") ||
      req.cookies.has("__Secure-next-auth.session-token");

    if (!hasSession) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
  }
}

export const config = { matcher: ["/api/:path*"] };
