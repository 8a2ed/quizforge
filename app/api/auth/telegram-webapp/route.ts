import { NextRequest, NextResponse } from "next/server";
import { createHmac } from "crypto";
import { SignJWT } from "jose";
import { prisma, withRetry } from "@/lib/db";

const JWT_SECRET = new TextEncoder().encode(process.env.AUTH_SECRET || "secret");
const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || "";

/**
 * Validates Telegram Mini App initData using HMAC-SHA256.
 * Spec: https://core.telegram.org/bots/webapps#validating-data-received-via-the-mini-app
 */
function validateInitData(initData: string): Record<string, string> | null {
  const params = new URLSearchParams(initData);
  const hash = params.get("hash");
  if (!hash) return null;

  // Build data-check-string: all params except hash, sorted alphabetically, joined by \n
  const entries: string[] = [];
  params.forEach((value, key) => {
    if (key !== "hash") entries.push(`${key}=${value}`);
  });
  entries.sort();
  const dataCheckString = entries.join("\n");

  // secret_key = HMAC-SHA256("WebAppData", bot_token)
  const secretKey = createHmac("sha256", "WebAppData").update(BOT_TOKEN).digest();
  const expectedHash = createHmac("sha256", secretKey).update(dataCheckString).digest("hex");

  if (expectedHash !== hash) return null;

  // Parse the user object
  const userStr = params.get("user");
  if (!userStr) return null;

  try {
    return JSON.parse(userStr);
  } catch {
    return null;
  }
}

export async function POST(req: NextRequest) {
  try {
    const { initData } = await req.json();
    if (!initData) {
      return NextResponse.json({ error: "initData is required" }, { status: 400 });
    }

    const tgUser = validateInitData(initData);
    if (!tgUser) {
      return NextResponse.json({ error: "Invalid initData signature" }, { status: 401 });
    }

    const telegramId = String(tgUser.id);
    const firstName = tgUser.first_name || "User";
    const lastName = tgUser.last_name || null;
    const username = tgUser.username || null;
    const photoUrl = tgUser.photo_url || null;

    // Upsert user in DB
    const user = await withRetry(() =>
      prisma.user.upsert({
        where: { telegramId },
        update: { firstName, lastName, username, photoUrl, updatedAt: new Date() },
        create: { telegramId, firstName, lastName, username, photoUrl },
      })
    );

    // Issue JWT session cookie (30 days)
    const token = await new SignJWT({ sub: user.id, telegramId })
      .setProtectedHeader({ alg: "HS256" })
      .setExpirationTime("30d")
      .setIssuedAt()
      .sign(JWT_SECRET);

    const response = NextResponse.json({ ok: true, user: { id: user.id, firstName } });
    response.cookies.set("qf_session", token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      maxAge: 30 * 24 * 60 * 60,
      path: "/",
    });

    return response;
  } catch (err) {
    console.error("[MiniApp Auth]", err);
    return NextResponse.json({ error: "Authentication failed" }, { status: 500 });
  }
}
