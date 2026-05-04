import { NextRequest, NextResponse } from "next/server";
import { jwtVerify } from "jose";
import { prisma, withRetry } from "@/lib/db";

const JWT_SECRET = new TextEncoder().encode(process.env.AUTH_SECRET || "secret");

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ groupId: string }> }
) {
  const { groupId } = await params;
  const token = req.cookies.get("qf_session")?.value;
  if (!token) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const { payload } = await jwtVerify(token, JWT_SECRET);
    const userId = (payload as { sub: string }).sub;
    const membership = await withRetry(() => prisma.groupMember.findUnique({
      where: { userId_groupId: { userId, groupId } },
    }));
    if (!membership) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

    const { searchParams } = req.nextUrl;
    const rangeDays = parseInt(searchParams.get("days") || "30");
    const since = new Date(Date.now() - rangeDays * 24 * 60 * 60 * 1000);

    // ── Parallel base queries ──────────────────────────────────────────────────
    const [
      totalQuizzes,
      totalAnswers,
      deletedCount,
      closedCount,
      quizBreakdown,
      recentQuizzes,
      allTimeActivity,
      byTopic,
      byType,
      bySender,
    ] = await Promise.all([
      withRetry(() => prisma.quiz.count({ where: { groupId, sentAt: { not: null } } })),
      withRetry(() => prisma.pollAnswer.count({ where: { quiz: { groupId } } })),
      withRetry(() => prisma.quiz.count({ where: { groupId, deletedAt: { not: null } } })),
      withRetry(() => prisma.quiz.count({ where: { groupId, pollClosed: true, deletedAt: null } })),
      withRetry(() => prisma.quiz.findMany({
        where: { groupId, type: "QUIZ", sentAt: { not: null } },
        select: { id: true, question: true, correctOptionId: true, _count: { select: { answers: true } } },
      })),
      withRetry(() => prisma.quiz.findMany({
        where: { groupId, sentAt: { gte: since } },
        select: { sentAt: true },
        orderBy: { sentAt: "asc" },
      })),
      // 12-week activity (for trend chart)
      withRetry(() => prisma.quiz.findMany({
        where: { groupId, sentAt: { gte: new Date(Date.now() - 84 * 24 * 60 * 60 * 1000) } },
        select: { sentAt: true },
      })),
      withRetry(() => prisma.quiz.groupBy({
        by: ["topicName", "topicId"],
        where: { groupId, sentAt: { not: null } },
        _count: { id: true },
        orderBy: { _count: { id: "desc" } },
      })),
      withRetry(() => prisma.quiz.groupBy({
        by: ["type"],
        where: { groupId, sentAt: { not: null } },
        _count: { id: true },
      })),
      withRetry(() => prisma.quiz.groupBy({
        by: ["sentById"],
        where: { groupId, sentAt: { not: null } },
        _count: { id: true },
        orderBy: { _count: { id: "desc" } },
        take: 10,
      })),
    ]);

    // ── Correct rates per quiz (batch) ────────────────────────────────────────
    const quizzesWithAnswers = quizBreakdown.filter(q => q._count.answers > 0 && q.correctOptionId !== null);
    const correctCounts = await Promise.all(
      quizzesWithAnswers.map(q =>
        withRetry(() => prisma.pollAnswer.count({
          where: { quizId: q.id, optionIds: { has: q.correctOptionId! } },
        })).then(correct => ({
          id: q.id,
          question: q.question,
          total: q._count.answers,
          correct,
          rate: Math.round((correct / q._count.answers) * 100),
        }))
      )
    );

    const totalAnswered = correctCounts.reduce((s, r) => s + r.total, 0);
    const totalCorrect = correctCounts.reduce((s, r) => s + r.correct, 0);
    const overallCorrectRate = totalAnswered > 0 ? Math.round((totalCorrect / totalAnswered) * 100) : 0;

    // Hardest / Easiest (min 2 answers)
    const ranked = correctCounts.filter(r => r.total >= 2).sort((a, b) => a.rate - b.rate);
    const hardestQuizzes = ranked.slice(0, 5);
    const easiestQuizzes = [...ranked].reverse().slice(0, 5);

    // ── Activity heatmap (daily) ───────────────────────────────────────────────
    const activityMap: Record<string, number> = {};
    recentQuizzes.forEach(q => {
      if (q.sentAt) {
        const key = q.sentAt.toISOString().slice(0, 10);
        activityMap[key] = (activityMap[key] || 0) + 1;
      }
    });
    const activityData = Object.entries(activityMap)
      .map(([date, count]) => ({ date, count }))
      .sort((a, b) => a.date.localeCompare(b.date));

    // ── Peak hours (0-23 histogram) ────────────────────────────────────────────
    const hourMap: Record<number, number> = {};
    allTimeActivity.forEach(q => {
      if (q.sentAt) {
        const h = q.sentAt.getUTCHours();
        hourMap[h] = (hourMap[h] || 0) + 1;
      }
    });
    const peakHours = Array.from({ length: 24 }, (_, h) => ({
      hour: h,
      label: `${String(h).padStart(2, "0")}:00`,
      count: hourMap[h] || 0,
    }));

    // ── Drop-off by topic ──────────────────────────────────────────────────────
    // For each topic: get quizzes in sent order with their answer counts
    const topicDropoff: Record<string, Array<{ question: string; sentAt: string; answers: number }>> = {};
    const topicsWithMultiple = byTopic.filter(t => t._count.id >= 2 && t.topicName);
    await Promise.all(
      topicsWithMultiple.slice(0, 6).map(async t => {
        const quizzes = await withRetry(() => prisma.quiz.findMany({
          where: { groupId, topicName: t.topicName, sentAt: { not: null } },
          select: { question: true, sentAt: true, _count: { select: { answers: true } } },
          orderBy: { sentAt: "asc" },
          take: 20,
        }));
        topicDropoff[t.topicName!] = quizzes.map(q => ({
          question: q.question.slice(0, 60),
          sentAt: q.sentAt!.toISOString(),
          answers: q._count.answers,
        }));
      })
    );

    // ── Response rate by topic ────────────────────────────────────────────────
    const responseRateByTopic = await Promise.all(
      byTopic.slice(0, 8).map(async t => {
        const avgAnswers = await withRetry(() => prisma.quiz.aggregate({
          where: { groupId, topicName: t.topicName, sentAt: { not: null } },
          _avg: { _count: undefined } as never,
        })).catch(() => null);
        void avgAnswers; // not used below — use raw count
        const quizCount = t._count.id;
        const answerSum = await withRetry(() => prisma.pollAnswer.count({
          where: { quiz: { groupId, topicName: t.topicName } },
        }));
        return {
          topic: t.topicName || "General",
          quizCount,
          avgResponses: quizCount > 0 ? Math.round(answerSum / quizCount) : 0,
        };
      })
    );

    // ── Sender details ────────────────────────────────────────────────────────
    const senderDetails = await Promise.all(
      bySender.map(async s => {
        const user = await withRetry(() => prisma.user.findUnique({
          where: { id: s.sentById },
          select: { id: true, firstName: true, username: true, photoUrl: true },
        }));
        return { ...s, user };
      })
    );

    return NextResponse.json({
      summary: {
        totalQuizzes,
        totalAnswers,
        overallCorrectRate,
        quizTypes: byType,
        deletedCount,
        closedCount,
        activeCount: totalQuizzes - deletedCount - closedCount,
      },
      byTopic,
      bySender: senderDetails,
      activityData,
      peakHours,
      hardestQuizzes,
      easiestQuizzes,
      topicDropoff,
      responseRateByTopic,
    });
  } catch (err) {
    console.error("[analytics]", err);
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
}
