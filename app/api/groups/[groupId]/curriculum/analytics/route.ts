import { NextRequest, NextResponse } from "next/server";
import { jwtVerify } from "jose";
import { prisma, withRetry } from "@/lib/db";
import { getAIAnalytics } from "@/lib/aiStorage";

const JWT_SECRET = new TextEncoder().encode(process.env.AUTH_SECRET || "secret");

async function checkAuth(req: NextRequest) {
  const token = req.cookies.get("qf_session")?.value;
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, JWT_SECRET);
    return (payload as { sub: string }).sub;
  } catch {
    return null;
  }
}

// GET /api/groups/[groupId]/curriculum/analytics
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ groupId: string }> }
) {
  const { groupId } = await params;
  const userId = await checkAuth(req);
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const baseAnalytics = await getAIAnalytics(groupId);

  // Safely compute real student results and performance metrics from database
  let broadcastedQuizzesCount = 0;
  let studentAnswersCount = 0;
  let examsCreatedCount = 0;
  let examResultsCount = 0;
  let averageScore = 0;
  let passRate = 0;

  try {
    // 1. Quizzes with AI_CURRICULUM tag in this group
    const quizzes = await withRetry(() =>
      prisma.quiz.findMany({
        where: {
          groupId,
          tags: { has: "AI_CURRICULUM" },
        },
        include: {
          _count: { select: { answers: true } },
        },
      })
    );

    broadcastedQuizzesCount = quizzes.length;
    studentAnswersCount = quizzes.reduce((acc, q) => acc + (q._count?.answers || 0), 0);

    // 2. Exams in this group
    const exams = await withRetry(() =>
      prisma.exam.findMany({
        where: { groupId },
        include: {
          results: {
            select: { score: true, passed: true },
          },
        },
      })
    );

    examsCreatedCount = exams.length;
    const allResults = exams.flatMap((e) => e.results);
    examResultsCount = allResults.length;

    if (examResultsCount > 0) {
      const totalScore = allResults.reduce((acc, r) => acc + (r.score || 0), 0);
      const passedCount = allResults.filter((r) => r.passed).length;
      averageScore = Math.round(totalScore / examResultsCount);
      passRate = Math.round((passedCount / examResultsCount) * 100);
    }
  } catch (dbErr) {
    console.warn("[Analytics DB Query Notice]", dbErr);
  }

  const enrichedAnalytics = {
    ...baseAnalytics,
    studentParticipants: studentAnswersCount + examResultsCount,
    averageScore,
    passRate,
    broadcastedQuizzesCount,
    examsCreatedCount,
  };

  return NextResponse.json({ analytics: enrichedAnalytics });
}
