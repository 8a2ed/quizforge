import { NextRequest, NextResponse } from "next/server";
import { verifyTelegramHash } from "@/lib/crypto";
import { prisma, withRetry } from "@/lib/db";
import { SignJWT } from "jose";

const JWT_SECRET = new TextEncoder().encode(process.env.AUTH_SECRET || "secret");

export async function GET(req: NextRequest) {
  const params = Object.fromEntries(req.nextUrl.searchParams.entries());

  // 1. Verify Telegram hash
  if (!verifyTelegramHash(params)) {
    return NextResponse.json({ ok: false, error: "Invalid authentication data" }, { status: 401 });
  }

  // 2. Upsert user in DB
  const user = await withRetry(() => prisma.user.upsert({
    where: { telegramId: params.id },
    update: {
      firstName: params.first_name,
      lastName: params.last_name || null,
      username: params.username || null,
      photoUrl: params.photo_url || null,
    },
    create: {
      telegramId: params.id,
      firstName: params.first_name,
      lastName: params.last_name || null,
      username: params.username || null,
      photoUrl: params.photo_url || null,
    },
  }));

  // 3. Create JWT
  const token = await new SignJWT({
    sub: user.id,
    telegramId: user.telegramId,
    firstName: user.firstName,
    username: user.username,
    photoUrl: user.photoUrl,
  })
    .setProtectedHeader({ alg: "HS256" })
    .setExpirationTime("30d")
    .setIssuedAt()
    .sign(JWT_SECRET);

  // 4. Set HTTP-only cookie
  const response = NextResponse.json({ ok: true });
  response.cookies.set("qf_session", token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: 60 * 60 * 24 * 30, // 30 days
    path: "/",
  });

  return response;
}
