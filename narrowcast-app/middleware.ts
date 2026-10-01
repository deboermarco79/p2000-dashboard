import { NextRequest, NextResponse } from "next/server";

/**
 * Minimal layout protection for /dashboard (HTTP Basic Auth, any username).
 * Active only when DASHBOARD_PASSWORD is set. This is a placeholder until
 * Supabase Auth is wired in; it does not protect the database itself.
 */
export function middleware(req: NextRequest) {
  const password = process.env.DASHBOARD_PASSWORD;
  if (!password) return NextResponse.next();

  const header = req.headers.get("authorization");
  if (header?.startsWith("Basic ")) {
    const decoded = atob(header.slice(6));
    if (decoded.slice(decoded.indexOf(":") + 1) === password) return NextResponse.next();
  }
  return new NextResponse("Authentication required", {
    status: 401,
    headers: { "WWW-Authenticate": 'Basic realm="Narrowcast Command Center"' },
  });
}

export const config = { matcher: ["/dashboard/:path*"] };
