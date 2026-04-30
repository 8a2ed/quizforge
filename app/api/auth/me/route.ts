import { NextRequest, NextResponse } from "next/server";
import { jwtVerify } from "jose";
import { prisma, withRetry } from "@/lib/db";

const JWT_SECRET = new TextEncoder().encode(process.env.AUTH_SECRET || "secret");

export async function GET(req: NextRequest) {
  console.log("HIT /api/auth/me");
  const token = req.cookies.get("qf_session")?.value;
  if (!token) return NextResponse.json({ user: null });

  try {
    const { payload } = await jwtVerify(token, JWT_SECRET);
    const userId = (payload as { sub: string }).sub;

    const user = await withRetry(() => prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, firstName: true, lastName: true, username: true, photoUrl: true, telegramId: true },
    }));

    return NextResponse.json({ user });
  } catch {
    return NextResponse.json({ user: null });
  }
}
