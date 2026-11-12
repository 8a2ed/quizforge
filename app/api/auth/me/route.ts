import { getAuthSecret } from "@/lib/auth";
import { NextRequest, NextResponse } from "next/server";
import { jwtVerify } from "jose";
import { prisma, withRetry } from "@/lib/db";

const JWT_SECRET = getAuthSecret();

export async function GET(req: NextRequest) {
  const token = req.cookies.get("qf_session")?.value;
  if (!token) return NextResponse.json({ user: null });

  let userId: string;
  try {
    const { payload } = await jwtVerify(token, JWT_SECRET);
    if (typeof payload.sub !== "string" || !payload.sub) {
      return NextResponse.json({ user: null }, { status: 401 });
    }
    userId = payload.sub;
  } catch {
    return NextResponse.json({ user: null }, { status: 401 });
  }

  try {
    const user = await withRetry(() => prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, firstName: true, lastName: true, username: true, photoUrl: true, telegramId: true },
    }));

    return NextResponse.json({ user });
  } catch (error) {
    console.error("[auth/me] User lookup failed:", error);
    return NextResponse.json({ error: "Database unavailable" }, { status: 503 });
  }
}
