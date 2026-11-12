import { getAuthSecret } from "@/lib/auth";
import { NextRequest, NextResponse } from "next/server";
import { jwtVerify } from "jose";
import { prisma, withRetry } from "@/lib/db";
import { getAIAnalytics } from "@/lib/aiStorage";

const JWT_SECRET = getAuthSecret();

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ groupId: string }> }
) {
  const { groupId } = await params;
  const token = req.cookies.get("qf_session")?.value;
  if (!token) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let userId: string;
  try {
    const { payload } = await jwtVerify(token, JWT_SECRET);
    if (typeof payload.sub !== "string" || !payload.sub) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    userId = payload.sub;
  } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const membership = await withRetry(() => prisma.groupMember.findUnique({
      where: { userId_groupId: { userId, groupId } },
      select: { approved: true, role: true },
    }));
    if (!membership?.approved || (membership.role !== "OWNER" && membership.role !== "ADMIN")) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const { searchParams } = req.nextUrl;
    const requestedDays = Number.parseInt(searchParams.get("days") || "30", 10);
    const rangeDays = Number.isFinite(requestedDays) ? Math.min(365, Math.max(1, requestedDays)) : 30;
    const since = new Date(Date.now() - rangeDays * 24 * 60 * 60 * 1000);

    // ── Parallel base queries ──────────────────────────────────────────────────
    const [
      totalQuizzes,
      totalAnswers,
      deletedCount,
      closedCount,
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
      // Aggregate on the database instead of transferring one row per quiz.
      prisma.$queryRaw<Array<{ date: string; count: bigint }>>`
        SELECT TO_CHAR(DATE_TRUNC('day', "sentAt" AT TIME ZONE 'UTC'), 'YYYY-MM-DD') AS date,
               COUNT(*)::bigint AS count
        FROM "quizzes"
        WHERE "groupId" = ${groupId} AND "sentAt" >= ${since}
        GROUP BY 1 ORDER BY 1
      `,
      // 12-week peak-hour histogram; one compact row per hour.
      prisma.$queryRaw<Array<{ hour: number; count: bigint }>>`
        SELECT EXTRACT(HOUR FROM ("sentAt" AT TIME ZONE 'UTC'))::int AS hour,
               COUNT(*)::bigint AS count
        FROM "quizzes"
        WHERE "groupId" = ${groupId}
          AND "sentAt" >= ${new Date(Date.now() - 84 * 24 * 60 * 60 * 1000)}
        GROUP BY 1
      `,
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

    // Rank the hardest/easiest quizzes in SQL and return only ten rows instead of
    // transferring every historical question and calculating rates in Node.
    type RankedQuizRow = {
      total_answered: bigint;
      total_correct: bigint;
      quiz_id: string | null;
      question: string | null;
      answer_count: bigint | null;
      correct_count: bigint | null;
      rate: number | null;
      hard_rank: bigint | null;
      easy_rank: bigint | null;
    };
    const rankedQuizRows = await prisma.$queryRaw<RankedQuizRow[]>`
      WITH per_quiz AS (
        SELECT q."id", q."question", COUNT(pa."id")::bigint AS total,
               COUNT(pa."id") FILTER (WHERE q."correctOptionId" = ANY(pa."optionIds"))::bigint AS correct
        FROM "quizzes" q
        JOIN "poll_answers" pa ON pa."quizId" = q."id"
        WHERE q."groupId" = ${groupId} AND q."type" = 'QUIZ'
          AND q."sentAt" IS NOT NULL AND q."correctOptionId" IS NOT NULL
        GROUP BY q."id", q."question"
      ),
      stats AS (
        SELECT COALESCE(SUM(total), 0)::bigint AS total_answered,
               COALESCE(SUM(correct), 0)::bigint AS total_correct
        FROM per_quiz
      ),
      ranked AS (
        SELECT id, question, total, correct,
               ROUND(correct::numeric * 100 / NULLIF(total, 0))::int AS rate,
               ROW_NUMBER() OVER (ORDER BY correct::numeric / NULLIF(total, 0) ASC, total DESC) AS hard_rank,
               ROW_NUMBER() OVER (ORDER BY correct::numeric / NULLIF(total, 0) DESC, total DESC) AS easy_rank
        FROM per_quiz WHERE total >= 2
      )
      SELECT stats.total_answered, stats.total_correct, ranked.id AS quiz_id,
             ranked.question, ranked.total AS answer_count, ranked.correct AS correct_count,
             ranked.rate, ranked.hard_rank, ranked.easy_rank
      FROM stats LEFT JOIN ranked ON ranked.hard_rank <= 5 OR ranked.easy_rank <= 5
      ORDER BY ranked.hard_rank NULLS LAST
    `;
    const firstRankedRow = rankedQuizRows[0];
    const totalAnswered = Number(firstRankedRow?.total_answered ?? 0);
    const totalCorrect = Number(firstRankedRow?.total_correct ?? 0);
    const overallCorrectRate = totalAnswered > 0 ? Math.round((totalCorrect / totalAnswered) * 100) : 0;

    const hardestQuizzes = rankedQuizRows
      .filter(row => row.quiz_id !== null && Number(row.hard_rank) <= 5)
      .map(row => ({ id: row.quiz_id!, question: row.question!, total: Number(row.answer_count), correct: Number(row.correct_count), rate: Number(row.rate) }));
    const easiestQuizzes = rankedQuizRows
      .filter(row => row.quiz_id !== null && Number(row.easy_rank) <= 5)
      .sort((a, b) => Number(a.easy_rank) - Number(b.easy_rank))
      .map(row => ({ id: row.quiz_id!, question: row.question!, total: Number(row.answer_count), correct: Number(row.correct_count), rate: Number(row.rate) }));

    // ── Activity heatmap (daily) ───────────────────────────────────────────────
    const activityData = recentQuizzes.map(row => ({ date: row.date, count: Number(row.count) }));

    // ── Peak hours (0-23 histogram) ────────────────────────────────────────────
    const hourMap = new Map(allTimeActivity.map(row => [Number(row.hour), Number(row.count)]));
    const peakHours = Array.from({ length: 24 }, (_, h) => ({
      hour: h,
      label: `${String(h).padStart(2, "0")}:00`,
      count: hourMap.get(h) || 0,
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
    type TopicResponseRow = { topic_id: number | null; topic_name: string | null; quiz_count: bigint; answer_count: bigint };
    const topicResponseRows = await prisma.$queryRaw<TopicResponseRow[]>`
      SELECT q."topicId" AS topic_id, q."topicName" AS topic_name,
             COUNT(DISTINCT q."id")::bigint AS quiz_count,
             COUNT(pa."id")::bigint AS answer_count
      FROM "quizzes" q
      LEFT JOIN "poll_answers" pa ON pa."quizId" = q."id"
      WHERE q."groupId" = ${groupId} AND q."sentAt" IS NOT NULL
      GROUP BY q."topicId", q."topicName"
    `;
    const topicResponseMap = new Map(topicResponseRows.map(row => [
      `${row.topic_id ?? "null"}:${row.topic_name ?? ""}`,
      { quizCount: Number(row.quiz_count), answerCount: Number(row.answer_count) },
    ]));
    const responseRateByTopic = byTopic.slice(0, 8).map(t => {
      const stats = topicResponseMap.get(`${t.topicId ?? "null"}:${t.topicName ?? ""}`);
      const quizCount = Number(t._count.id);
      return {
        topic: t.topicName || "General",
        quizCount,
        avgResponses: quizCount > 0 ? Math.round((stats?.answerCount ?? 0) / quizCount) : 0,
      };
    });

    // ── Sender details ────────────────────────────────────────────────────────
    const senderIds = bySender.map(s => s.sentById).filter((id): id is string => id !== null);
    const senderUsers = senderIds.length ? await withRetry(() => prisma.user.findMany({
      where: { id: { in: senderIds } },
      select: { id: true, firstName: true, username: true, photoUrl: true },
    })) : [];
    const usersById = new Map(senderUsers.map(user => [user.id, user]));
    const senderDetails = bySender.map(s => ({ ...s, user: s.sentById ? usersById.get(s.sentById) ?? null : null }));

    // ── Anonymous vs Public Quizzes stats ─────────────────────────────────────
    const [privacyStats, aiAnalytics] = await Promise.all([
      prisma.$queryRaw<Array<{ anon_quizzes: bigint; public_quizzes: bigint; anon_answers: bigint; public_answers: bigint }>>`
        SELECT
          COUNT(*) FILTER (WHERE q."isAnonymous" = true AND q."sentAt" IS NOT NULL)::bigint AS anon_quizzes,
          COUNT(*) FILTER (WHERE q."isAnonymous" = false AND q."sentAt" IS NOT NULL)::bigint AS public_quizzes,
          (SELECT COUNT(*) FROM "poll_answers" pa JOIN "quizzes" aq ON aq."id" = pa."quizId"
            WHERE aq."groupId" = ${groupId} AND aq."isAnonymous" = true)::bigint AS anon_answers,
          (SELECT COUNT(*) FROM "poll_answers" pa JOIN "quizzes" pq ON pq."id" = pa."quizId"
            WHERE pq."groupId" = ${groupId} AND pq."isAnonymous" = false)::bigint AS public_answers
        FROM "quizzes" q WHERE q."groupId" = ${groupId}
      `,
      getAIAnalytics(groupId).catch(() => null),
    ]);
    const privacy = privacyStats[0];
    const anonQuizzesCount = Number(privacy?.anon_quizzes ?? 0);
    const publicQuizzesCount = Number(privacy?.public_quizzes ?? 0);
    const anonAnswersCount = Number(privacy?.anon_answers ?? 0);
    const publicAnswersCount = Number(privacy?.public_answers ?? 0);

    const anonymousStats = {
      anonQuizzes: anonQuizzesCount,
      publicQuizzes: publicQuizzesCount,
      anonAnswers: anonAnswersCount,
      publicAnswers: publicAnswersCount,
      anonAvgAnswers: anonQuizzesCount > 0 ? Math.round((anonAnswersCount / anonQuizzesCount) * 10) / 10 : 0,
      publicAvgAnswers: publicQuizzesCount > 0 ? Math.round((publicAnswersCount / publicQuizzesCount) * 10) / 10 : 0,
    };

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
      anonymousStats,
      aiAnalytics,
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
    return NextResponse.json({ error: "Failed to load analytics" }, { status: 500 });
  }
}
