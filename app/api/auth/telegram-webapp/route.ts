import { getAuthSecret } from "@/lib/auth";
import { NextRequest, NextResponse } from "next/server";
import { createHmac, timingSafeEqual } from "node:crypto";
import { SignJWT } from "jose";
import { prisma, withRetry } from "@/lib/db";
import { readJsonObject } from "@/lib/http";

const JWT_SECRET = getAuthSecret();
const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || "";

/**
 * Validates Telegram Mini App initData using HMAC-SHA256.
 * Spec: https://core.telegram.org/bots/webapps#validating-data-received-via-the-mini-app
 */
function validateInitData(initData: string): Record<string, string> | null {
  if (!BOT_TOKEN || initData.length > 16_384) return null;
  const params = new URLSearchParams(initData);
  const hash = params.get("hash");
  if (!hash || !/^[a-f\d]{64}$/i.test(hash)) return null;

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

  const receivedHash = Buffer.from(hash, "hex");
  const expectedHashBytes = Buffer.from(expectedHash, "hex");
  if (receivedHash.length !== expectedHashBytes.length || !timingSafeEqual(expectedHashBytes, receivedHash)) return null;

  const authDate = Number(params.get("auth_date"));
  const now = Math.floor(Date.now() / 1000);
  if (!Number.isSafeInteger(authDate) || authDate <= 0 || now - authDate > 86_400 || authDate - now > 300) return null;

  // Parse the user object
  const userStr = params.get("user");
  if (!userStr) return null;

  try {
    const user: unknown = JSON.parse(userStr);
    if (!user || typeof user !== "object" || Array.isArray(user)) return null;
    const userRecord = user as Record<string, unknown>;
    if (!(typeof userRecord.id === "number" || typeof userRecord.id === "string") || !userRecord.first_name || typeof userRecord.first_name !== "string") {
      return null;
    }
    const normalizedUser: Record<string, string> = { id: String(userRecord.id) };
    for (const [key, value] of Object.entries(userRecord)) {
      if (key !== "id" && typeof value === "string") normalizedUser[key] = value;
    }
    return normalizedUser;
  } catch {
    return null;
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await readJsonObject(req);
    if (!body) return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
    const initData = body.initData;
    if (typeof initData !== "string" || !initData) {
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
