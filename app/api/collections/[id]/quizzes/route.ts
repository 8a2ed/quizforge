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

async function ownsCollection(userId: string, collectionId: string) {
  const c = await withRetry(() =>
    prisma.collection.findFirst({ where: { id: collectionId, userId } })
  );
  return !!c;
}

// POST /api/collections/[id]/quizzes — add quiz IDs to collection
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getUser(req);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id: collectionId } = await params;
  if (!(await ownsCollection(user.sub, collectionId)))
    return NextResponse.json({ error: "Not found" }, { status: 404 });

  const { quizIds } = await req.json() as { quizIds: string[] };
  if (!Array.isArray(quizIds) || quizIds.length === 0)
    return NextResponse.json({ error: "quizIds required" }, { status: 400 });

  // createMany ignores duplicates with skipDuplicates
  await withRetry(() =>
    prisma.collectionQuiz.createMany({
      data: quizIds.map(quizId => ({ collectionId, quizId })),
      skipDuplicates: true,
    })
  );

  return NextResponse.json({ ok: true, added: quizIds.length });
}

// DELETE /api/collections/[id]/quizzes — remove quiz IDs from collection
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getUser(req);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id: collectionId } = await params;
  if (!(await ownsCollection(user.sub, collectionId)))
    return NextResponse.json({ error: "Not found" }, { status: 404 });

  const { quizIds } = await req.json() as { quizIds: string[] };
  if (!Array.isArray(quizIds) || quizIds.length === 0)
    return NextResponse.json({ error: "quizIds required" }, { status: 400 });

  await withRetry(() =>
    prisma.collectionQuiz.deleteMany({
      where: { collectionId, quizId: { in: quizIds } },
    })
  );

  return NextResponse.json({ ok: true, removed: quizIds.length });
}
