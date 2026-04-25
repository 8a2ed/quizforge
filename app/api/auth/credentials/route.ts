import { NextRequest, NextResponse } from "next/server";
import { prisma, withRetry } from "@/lib/db";
import bcrypt from "bcryptjs";
import { SignJWT } from "jose";

const JWT_SECRET = new TextEncoder().encode(process.env.AUTH_SECRET || "secret");

export async function POST(req: NextRequest) {
  try {
    const { username, password } = await req.json();

    if (!username || !password) {
      return NextResponse.json({ error: "Username and password are required" }, { status: 400 });
    }

    // Find credential
    const credential = await withRetry(() =>
      prisma.instructorCredential.findUnique({
        where: { username: username.trim().toLowerCase() },
        include: { user: true },
      })
    );

    if (!credential) {
      return NextResponse.json({ error: "Invalid username or password" }, { status: 401 });
    }

    // Verify password
    const valid = await bcrypt.compare(password, credential.passwordHash);
    if (!valid) {
      return NextResponse.json({ error: "Invalid username or password" }, { status: 401 });
    }

    // Issue JWT session
    const token = await new SignJWT({
      sub: credential.user.id,
      firstName: credential.user.firstName,
      username: credential.user.username,
    })
      .setProtectedHeader({ alg: "HS256" })
      .setIssuedAt()
      .setExpirationTime("30d")
      .sign(JWT_SECRET);

    const res = NextResponse.json({ ok: true });
    res.cookies.set("qf_session", token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      maxAge: 60 * 60 * 24 * 30,
      path: "/",
    });
    return res;
  } catch (err) {
    console.error("Credential login error:", err);
    return NextResponse.json({ error: "Login failed" }, { status: 500 });
  }
}
