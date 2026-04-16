import { NextRequest, NextResponse } from "next/server";
import { jwtVerify } from "jose";
import { prisma } from "@/lib/db";

const JWT_SECRET = new TextEncoder().encode(process.env.AUTH_SECRET || "secret");

// POST /api/groups/[groupId]/quiz/[quizId]/duplicate
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ groupId: string; quizId: string }> }
) {
  const { groupId, quizId } = await params;
  const token = req.cookies.get("qf_session")?.value;
  if (!token) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { payload } = await jwtVerify(token, JWT_SECRET).catch(() => ({ payload: null }));
  if (!payload) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const userId = (payload as { sub: string }).sub;
  const membership = await prisma.groupMember.findUnique({
    where: { userId_groupId: { userId, groupId } },
  });
  if (!membership) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  // Find the original quiz
  const original = await prisma.quiz.findUnique({
    where: { id: quizId, groupId },
  });
  if (!original) return NextResponse.json({ error: "Quiz not found" }, { status: 404 });

  return NextResponse.json({
    ok: true,
    draft: {
      question: original.question,
      options: original.options,
      type: original.type.toLowerCase(),
      isAnonymous: original.isAnonymous,
      correctOptionId: original.correctOptionId,
      explanation: original.explanation,
      allowsMultiple: original.allowsMultiple,
      openPeriod: original.openPeriod,
      topicId: original.topicId,
      topicName: original.topicName,
    },
  });
}
