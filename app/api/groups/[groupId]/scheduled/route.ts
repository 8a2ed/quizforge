import { NextRequest, NextResponse } from "next/server";
import { jwtVerify } from "jose";
import { prisma, withRetry } from "@/lib/db";

const JWT_SECRET = new TextEncoder().encode(process.env.AUTH_SECRET || "secret");

async function authorize(req: NextRequest, groupId: string) {
  const token = req.cookies.get("qf_session")?.value;
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, JWT_SECRET);
    const userId = (payload as { sub: string }).sub;
    const m = await withRetry(() => prisma.groupMember.findUnique({
      where: { userId_groupId: { userId, groupId } },
      include: { group: true },
    }));
    if (!m || !m.approved) return null;
    return { userId, membership: m };
  } catch { return null; }
}

// GET — list pending scheduled quizzes for this group
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ groupId: string }> }
) {
  const { groupId } = await params;
  const auth = await authorize(req, groupId);
  if (!auth) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const quizzes = await withRetry(() => prisma.quiz.findMany({
    where: { groupId, sentAt: null, scheduledAt: { not: null } },
    orderBy: { scheduledAt: "asc" },
    select: {
      id: true,
      question: true,
      options: true,
      type: true,
      isAnonymous: true,
      correctOptionId: true,
      explanation: true,
      topicId: true,
      topicName: true,
      scheduledAt: true,
      recurrence: true,
      tags: true,
      openPeriod: true,
      allowsMultiple: true,
      createdAt: true,
    },
  }));

  return NextResponse.json({ quizzes });
}

// PATCH — update scheduledAt or other fields
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ groupId: string }> }
) {
  const { groupId } = await params;
  const auth = await authorize(req, groupId);
  if (!auth) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id, scheduledAt, recurrence, topicId, topicName } = await req.json();
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });

  const updated = await withRetry(() => prisma.quiz.updateMany({
    where: { id, groupId, sentAt: null },
    data: {
      ...(scheduledAt !== undefined ? { scheduledAt: scheduledAt ? new Date(scheduledAt) : null } : {}),
      ...(recurrence !== undefined ? { recurrence } : {}),
      ...(topicId !== undefined ? { topicId: topicId ? Number(topicId) : null } : {}),
      ...(topicName !== undefined ? { topicName: topicName || null } : {}),
    },
  }));

  return NextResponse.json({ ok: true, count: updated.count });
}

// DELETE — cancel a scheduled quiz
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ groupId: string }> }
) {
  const { groupId } = await params;
  const auth = await authorize(req, groupId);
  if (!auth) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await req.json();
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });

  await withRetry(() => prisma.quiz.deleteMany({
    where: { id, groupId, sentAt: null },
  }));

  return NextResponse.json({ ok: true });
}
