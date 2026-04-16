import { NextRequest, NextResponse } from "next/server";
import { jwtVerify } from "jose";

const JWT_SECRET = new TextEncoder().encode(process.env.AUTH_SECRET || "secret");

export async function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl;

  // Protect dashboard routes
  if (pathname.startsWith("/dashboard")) {
    const token = req.cookies.get("qf_session")?.value;
    if (!token) {
      return NextResponse.redirect(new URL("/login", req.url));
    }
    try {
      await jwtVerify(token, JWT_SECRET);
      return NextResponse.next();
    } catch {
      const res = NextResponse.redirect(new URL("/login", req.url));
      res.cookies.delete("qf_session");
      return res;
    }
  }

  // Redirect root to login
  if (pathname === "/") {
    return NextResponse.redirect(new URL("/login", req.url));
  }

  return NextResponse.next();
}

export default proxy;

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|api/webhook).*)"],
};
