import { getErrorMessage } from "@/lib/errors";
import { getAuthSecret } from "@/lib/auth";
import { NextRequest, NextResponse } from "next/server";
import { jwtVerify } from "jose";
import { prisma, withRetry } from "@/lib/db";
import { ensureFeedbackTable } from "@/lib/feedback";

const JWT_SECRET = getAuthSecret();

async function authorize(req: NextRequest, groupId: string) {
  const token = req.cookies.get("qf_session")?.value;
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, JWT_SECRET);
    const userId = (payload as { sub: string }).sub;
    const m = await withRetry(() => prisma.groupMember.findUnique({
      where: { userId_groupId: { userId, groupId } },
      select: { approved: true, role: true },
    }));
    return m?.approved && (m.role === "OWNER" || m.role === "ADMIN") ? { userId } : null;
  } catch { return null; }
}

// GET /api/groups/[groupId]/exams/[examId]/feedback
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ groupId: string; examId: string }> }
) {
  const { groupId, examId } = await params;
  const auth = await authorize(req, groupId);
  if (!auth) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  await ensureFeedbackTable();

  try {
    let cleanExamId = examId;
    let exam = await withRetry(() => prisma.exam.findFirst({
      where: { id: cleanExamId, groupId },
      select: { id: true, title: true },
    }));

    if (!exam) {
      cleanExamId = examId.replace(/^exam[_-]/i, "");
      exam = await withRetry(() => prisma.exam.findFirst({
        where: { id: cleanExamId, groupId },
        select: { id: true, title: true },
      }));
    }

    if (!exam) {
      return NextResponse.json({ error: "Exam not found" }, { status: 404 });
    }

    const feedbacks = await withRetry(() => prisma.examFeedback.findMany({
      where: {
        OR: [
          { examId: exam!.id },
          { examId: `exam_${exam!.id}` },
        ],
      },
      orderBy: { createdAt: "desc" },
    })).catch(() => []);

    const totalFeedbacks = feedbacks.length;
    const sumRatings = feedbacks.reduce((acc, f) => acc + (f.rating || 0), 0);
    const averageRating = totalFeedbacks > 0 ? Number((sumRatings / totalFeedbacks).toFixed(1)) : 0;

    const distribution: Record<number, number> = {
      1: 0, 2: 0, 3: 0, 4: 0, 5: 0,
      6: 0, 7: 0, 8: 0, 9: 0, 10: 0,
    };
    let withSuggestionsCount = 0;

    feedbacks.forEach(f => {
      const r = Math.min(10, Math.max(1, f.rating));
      distribution[r] = (distribution[r] || 0) + 1;
      if (f.suggestion && f.suggestion.trim().length > 0) {
        withSuggestionsCount++;
      }
    });

    return NextResponse.json({
      examTitle: exam.title,
      stats: {
        totalFeedbacks,
        averageRating,
        withSuggestionsCount,
        distribution,
      },
      feedbacks: feedbacks.map(f => ({
        id: f.id,
        name: f.name || "طالب",
        username: f.username || null,
        telegramId: f.telegramId,
        rating: f.rating,
        suggestion: f.suggestion || null,
        createdAt: f.createdAt.toISOString(),
        updatedAt: f.updatedAt.toISOString(),
      })),
    });
  } catch (error: unknown) {
    console.error("[feedback/GET] error:", error);
    return NextResponse.json({ error: getErrorMessage(error, "Internal error") }, { status: 500 });
  }
}
