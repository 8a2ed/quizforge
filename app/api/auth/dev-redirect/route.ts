import { NextResponse, NextRequest } from "next/server";
import { SignJWT } from "jose";
import { prisma, withRetry } from "@/lib/db";

const JWT_SECRET = new TextEncoder().encode(process.env.AUTH_SECRET || "secret");

export async function GET(req: NextRequest) {
  if (process.env.NODE_ENV !== "development") {
    return NextResponse.json({ error: "Only available in dev" }, { status: 403 });
  }

  try {
    // Try to find the FIRST real user in the database (the actual admin who set up this app)
    // This ensures dev login shows real groups instead of a dummy empty sandbox
    let user = await withRetry(() => prisma.user.findFirst({
      orderBy: { createdAt: "asc" },
    }));

    // If no real user exists yet, fall back to creating a sandbox user with a sandbox group
    if (!user) {
      user = await withRetry(() => prisma.user.upsert({
        where: { telegramId: "123456789" },
        update: {},
        create: {
          telegramId: "123456789",
          firstName: "Local Admin",
          username: "localadmin",
          photoUrl: "https://ui-avatars.com/api/?name=Local+Admin&background=4f7fff&color=fff",
        },
      }));

      const group = await withRetry(() => prisma.group.upsert({
        where: { chatId: "-1001234567890" },
        update: {},
        create: {
          chatId: "-1001234567890",
          title: "Dev Sandbox Group",
          isForum: false,
        },
      }));

      await withRetry(() => prisma.groupMember.upsert({
        where: { userId_groupId: { userId: user!.id, groupId: group.id } },
        update: { role: "OWNER", approved: true },
        create: {
          userId: user!.id,
          groupId: group.id,
          role: "OWNER",
          approved: true,
        },
      }));
    }

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

    // Return an HTML page that sets the cookie then JS-redirects.
    // This bypasses the iOS Safari bug that drops Set-Cookie on 302 redirects over local IPs.
    const response = new NextResponse(
      `<!DOCTYPE html>
<html>
  <head>
    <meta http-equiv="refresh" content="0; url=/dashboard" />
    <style>body { background: #0f1420; color: #8b98b5; font-family: sans-serif; display: flex; align-items: center; justify-content: center; height: 100vh; margin: 0; }</style>
  </head>
  <body>
    <p>Logging in... <a href="/dashboard" style="color:#4f7fff">click here if not redirected</a></p>
    <script>window.location.replace("/dashboard");</script>
  </body>
</html>`,
      {
        status: 200,
        headers: { "Content-Type": "text/html" },
      }
    );

    response.cookies.set("qf_session", token, {
      httpOnly: true,
      secure: false, // Must be false for local IP (http) testing on phone
      sameSite: "lax",
      path: "/",
      maxAge: 7 * 24 * 60 * 60,
    });

    return response;
  } catch (error: any) {
    console.error("Dev Redirect Login error:", error);
    return new NextResponse(
      `<html><body style="background:#0f1420;color:#f87171;font-family:sans-serif;padding:2rem">
        <h2>Login Error</h2>
        <p>${error.message}</p>
        <p>This usually means the database is waking up. <a href="/api/auth/dev-redirect" style="color:#4f7fff">Try again</a></p>
      </body></html>`,
      { status: 500, headers: { "Content-Type": "text/html" } }
    );
  }
}
