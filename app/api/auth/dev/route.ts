import { NextResponse } from "next/server";
import { SignJWT } from "jose";
import { prisma } from "@/lib/db";

const JWT_SECRET = new TextEncoder().encode(process.env.AUTH_SECRET || "secret");

// POST /api/auth/dev
// Bypasses the Telegram Widget entirely (Localhost only)
export async function POST() {
  if (process.env.NODE_ENV !== "development") {
    return NextResponse.json({ error: "Only available in local dev environment" }, { status: 403 });
  }

  try {
    // 1. Create or Find a Development User
    const user = await prisma.user.upsert({
      where: { telegramId: "123456789" },
      update: {},
      create: {
        telegramId: "123456789",
        firstName: "Local Admin",
        username: "localadmin",
        photoUrl: "https://ui-avatars.com/api/?name=Local+Admin&background=4f7fff&color=fff",
      },
    });

    // 2. Create or Find a Development Group
    const group = await prisma.group.upsert({
      where: { chatId: "-1001234567890" },
      update: {},
      create: {
        chatId: "-1001234567890",
        title: "Dev Sandbox Group",
        isForum: false,
      },
    });

    // 3. Ensure the User is an Admin of the Group
    await prisma.groupMember.upsert({
      where: { userId_groupId: { userId: user.id, groupId: group.id } },
      update: { role: "OWNER", approved: true },
      create: {
        userId: user.id,
        groupId: group.id,
        role: "OWNER",
        approved: true,
      },
    });

    // 4. Issue the JWT
    const token = await new SignJWT({
      sub: user.id,
      telegramId: user.telegramId,
      firstName: user.firstName,
      username: user.username,
      photoUrl: user.photoUrl,
    })
      .setProtectedHeader({ alg: "HS256" })
      .setIssuedAt()
      .setExpirationTime("7d")
      .sign(JWT_SECRET);

    const response = NextResponse.json({ ok: true, message: "Logged in via Dev Sandbox" });
    response.cookies.set("qf_session", token, {
      httpOnly: true,
      secure: false, // http valid for localhost
      sameSite: "lax",
      path: "/",
      maxAge: 7 * 24 * 60 * 60,
    });

    return response;
  } catch (error) {
    console.error("Local Dev Login error:", error);
    return NextResponse.json({ error: "Failed to setup local testing environment" }, { status: 500 });
  }
}
