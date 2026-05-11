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

// PATCH /api/collections/[id] — rename / recolor
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getUser(req);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const { name, emoji, color } = await req.json();

  const existing = await withRetry(() =>
    prisma.collection.findFirst({ where: { id, userId: user.sub } })
  );
  if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const updated = await withRetry(() =>
    prisma.collection.update({
      where: { id },
      data: {
        ...(name !== undefined ? { name: name.trim() } : {}),
        ...(emoji !== undefined ? { emoji } : {}),
        ...(color !== undefined ? { color } : {}),
      },
    })
  );

  return NextResponse.json({ ok: true, collection: updated });
}

// DELETE /api/collections/[id] — delete collection (keeps quizzes)
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getUser(req);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;

  const existing = await withRetry(() =>
    prisma.collection.findFirst({ where: { id, userId: user.sub } })
  );
  if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 });

  await withRetry(() => prisma.collection.delete({ where: { id } }));
  return NextResponse.json({ ok: true });
}
