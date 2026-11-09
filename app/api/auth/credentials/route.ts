import { getAuthSecret } from "@/lib/auth";
import { NextRequest, NextResponse } from "next/server";
import { prisma, withRetry } from "@/lib/db";
import bcrypt from "bcryptjs";
import { SignJWT } from "jose";
import { readJsonObject } from "@/lib/http";

const JWT_SECRET = getAuthSecret();

export async function POST(req: NextRequest) {
  try {
    const body = await readJsonObject(req);
    if (!body) return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
    const username = typeof body.username === "string" ? body.username.trim().toLowerCase() : "";
    const password = typeof body.password === "string" ? body.password : "";

    if (!username || !password) {
      return NextResponse.json({ error: "Username and password are required" }, { status: 400 });
    }
    if (username.length > 50 || password.length > 128) {
      return NextResponse.json({ error: "Invalid username or password" }, { status: 401 });
    }

    // Find credential
    const credential = await withRetry(() =>
      prisma.instructorCredential.findUnique({
        where: { username },
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
  telegramId: credential.user.telegramId ?? "",
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
