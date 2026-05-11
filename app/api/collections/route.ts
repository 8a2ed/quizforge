import { NextRequest, NextResponse } from "next/server";
import { jwtVerify } from "jose";
import { prisma, withRetry } from "@/lib/db";

const JWT_SECRET = new TextEncoder().encode(process.env.AUTH_SECRET || "secret");

async function getUser(req: NextRequest) {
  const token = req.cookies.get("qf_session")?.value;
  if (!token) return null;
  const { payload } = await jwtVerify(token, JWT_SECRET).catch(() => ({ payload: null }));
  return payload ? (payload as { sub: string }) : null;
}

// GET /api/collections — list user's collections with quiz count
export async function GET(req: NextRequest) {
  const user = await getUser(req);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const collections = await withRetry(() =>
    prisma.collection.findMany({
      where: { userId: user.sub },
      orderBy: { createdAt: "asc" },
      include: { _count: { select: { quizzes: true } } },
    })
  );

  return NextResponse.json({
    collections: collections.map(c => ({
      id: c.id,
      name: c.name,
      emoji: c.emoji,
      color: c.color,
      quizCount: c._count.quizzes,
      createdAt: c.createdAt,
    })),
  });
}

// POST /api/collections — create a collection
export async function POST(req: NextRequest) {
  const user = await getUser(req);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { name, emoji, color } = await req.json();
  if (!name?.trim()) return NextResponse.json({ error: "Name required" }, { status: 400 });

  const collection = await withRetry(() =>
    prisma.collection.create({
      data: {
        name: name.trim(),
        emoji: emoji || "📁",
        color: color || "#6366f1",
        userId: user.sub,
      },
    })
  );

  return NextResponse.json({ ok: true, collection });
}
