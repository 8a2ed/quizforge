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
    if (!membership) return NextResponse.json({ error: "Not a member" }, { status: 403 });

    // Run heavy queries in parallel to reduce latency
    const [totalQuizzes, totalAnswers, quizBreakdown, recentQuizzes, byTopic, byType, bySender] = await Promise.all([
      withRetry(() => prisma.quiz.count({ where: { groupId, sentAt: { not: null } } })),
      withRetry(() => prisma.pollAnswer.count({ where: { quiz: { groupId } } })),
      withRetry(() => prisma.quiz.findMany({
        where: { groupId, type: "QUIZ", sentAt: { not: null } },
        select: { id: true, correctOptionId: true, _count: { select: { answers: true } } },
      })),
      withRetry(() => prisma.quiz.findMany({
        where: { groupId, sentAt: { gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) } },
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

    // Compute overall correct rate (parallelized)
    const correctRates = await Promise.all(
      quizBreakdown
        .filter(q => q._count.answers > 0 && q.correctOptionId !== null)
        .map(q => withRetry(() => prisma.pollAnswer.count({
          where: { quizId: q.id, optionIds: { has: q.correctOptionId! } },
        })).then(correct => ({ total: q._count.answers, correct })))
    );
    const totalAnswered = correctRates.reduce((s, r) => s + r.total, 0);
    const totalCorrect = correctRates.reduce((s, r) => s + r.correct, 0);
    const overallCorrectRate = totalAnswered > 0 ? Math.round((totalCorrect / totalAnswered) * 100) : 0;

    // Resolve sender details
    const senderDetails = await Promise.all(
      bySender.map(async (s) => {
        const user = await withRetry(() => prisma.user.findUnique({
          where: { id: s.sentById },
          select: { id: true, firstName: true, username: true, photoUrl: true },
        }));
        return { ...s, user };
      })
    );

    // Activity heatmap
    const activityMap: Record<string, number> = {};
    recentQuizzes.forEach((q) => {
      if (q.sentAt) {
        const key = q.sentAt.toISOString().slice(0, 10);
        activityMap[key] = (activityMap[key] || 0) + 1;
      }
    });
    const activityData = Object.entries(activityMap)
      .map(([date, count]) => ({ date, count }))
      .sort((a, b) => a.date.localeCompare(b.date));

    // Top topics
    const topTopics = await withRetry(() => prisma.quiz.findMany({
      where: { groupId, topicName: { not: null }, sentAt: { not: null } },
      include: { _count: { select: { answers: true } } },
      orderBy: { answers: { _count: "desc" } },
      take: 5,
    }));

    return NextResponse.json({
      summary: { totalQuizzes, totalAnswers, overallCorrectRate, quizTypes: byType },
      byTopic,
      bySender: senderDetails,
      activityData,
      topTopics: topTopics.map(t => ({ topicName: t.topicName, topicId: t.topicId, _count: t._count })),
    });
  } catch (err) {
    console.error("[analytics]", err);
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
}
