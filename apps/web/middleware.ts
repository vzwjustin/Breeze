import { auth } from "@/server/auth/config";

export default auth((req) => {
  if (
    !req.auth &&
    req.nextUrl.pathname.startsWith("/api") &&
    !req.nextUrl.pathname.startsWith("/api/auth")
  ) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
});

export const config = { matcher: ["/api/:path*"] };
