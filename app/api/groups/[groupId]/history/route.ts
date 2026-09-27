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

  let userId: string;
  try {
    const { payload } = await jwtVerify(token, JWT_SECRET);
    userId = (payload as { sub: string }).sub;
  } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    // Auth check + group metadata in parallel
    const [membership, group] = await Promise.all([
      withRetry(() =>
        prisma.groupMember.findUnique({
          where: { userId_groupId: { userId, groupId } },
        })
      ),
      withRetry(() =>
        prisma.group.findUnique({
          where: { id: groupId },
          select: { id: true, title: true, username: true, chatId: true, isForum: true },
        })
      ),
    ]);

    if (!membership || !membership.approved) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    // ── 1. Smart Auto-Expire Sync for Telegram Timed Polls ─────────────────
    // Automatically close expired polls in the DB using a single fast SQL statement.
    // In Telegram Bot API, polls with open_period close automatically after open_period seconds.
    await prisma.$executeRaw`
      UPDATE "quizzes"
      SET "pollClosed" = true
      WHERE "groupId" = ${groupId}
        AND "pollClosed" = false
        AND "openPeriod" IS NOT NULL
        AND "sentAt" IS NOT NULL
        AND EXTRACT(EPOCH FROM (NOW() - "sentAt")) >= "openPeriod"
    `.catch((err) => console.error("[history] Auto-expire DB update error:", err));

    const { searchParams } = req.nextUrl;
    const page      = Math.max(1, parseInt(searchParams.get("page")  || "1"));
    const limit     = Math.min(50, Math.max(1, parseInt(searchParams.get("limit") || "15")));
    const type      = searchParams.get("type"); // QUIZ | POLL
    const status    = searchParams.get("status"); // active | closed | deleted
    const privacy   = searchParams.get("privacy"); // anonymous | public
    const topicId   = searchParams.get("topicId"); // integer or "general"
    const sentById  = searchParams.get("sentById");
    const q         = searchParams.get("q")?.trim();
    const tags      = searchParams.get("tags");
    const sort      = searchParams.get("sort") || "newest"; // newest | oldest | most_responses | highest_rate | lowest_rate

    // Build where clause
    const where: Record<string, unknown> = { groupId, sentAt: { not: null } };
    if (type) where.type = type.toUpperCase();
    if (privacy === "anonymous") where.isAnonymous = true;
    else if (privacy === "public") where.isAnonymous = false;

    if (topicId) {
      if (topicId === "general" || topicId === "0" || topicId === "none") {
        where.topicId = null;
      } else {
        const parsedTopicId = parseInt(topicId);
        if (!isNaN(parsedTopicId)) where.topicId = parsedTopicId;
      }
    }
    if (sentById) where.sentById = sentById;

    if (q) {
      where.OR = [
        { question: { contains: q, mode: "insensitive" } },
        { explanation: { contains: q, mode: "insensitive" } },
        { topicName: { contains: q, mode: "insensitive" } },
        { sentBy: { firstName: { contains: q, mode: "insensitive" } } },
        { sentBy: { username: { contains: q, mode: "insensitive" } } },
        { tags: { has: q.toLowerCase() } },
        { options: { has: q } },
      ];
    }

    if (tags) {
      const tagsArray = tags.split(",").map((t) => t.trim().toLowerCase()).filter(Boolean);
      if (tagsArray.length > 0) {
        where.tags = { hasSome: tagsArray };
      }
    }

    if (status === "deleted") {
      where.deletedAt = { not: null };
    } else if (status === "closed") {
      where.deletedAt = null;
      where.pollClosed = true;
    } else if (status === "active") {
      where.deletedAt = null;
      where.pollClosed = false;
    }

    // Determine database-level orderBy
    let orderBy: Record<string, unknown> = { sentAt: "desc" };
    if (sort === "oldest") {
      orderBy = { sentAt: "asc" };
    } else if (sort === "most_responses") {
      orderBy = { answers: { _count: "desc" } };
    }

    // ── 2. Parallel Fetch: quizzes, total count, group KPIs, topics, tags, avg accuracy ────
    type AccuracyRow = { total_answers: bigint; total_correct: bigint };

    const [quizzes, total, summaryCounts, groupTopics, groupQuizzesTags, groupAccuracyRows] = await Promise.all([
      withRetry(() =>
        prisma.quiz.findMany({
          where,
          include: {
            sentBy: { select: { id: true, firstName: true, username: true, photoUrl: true } },
            _count: { select: { answers: true } },
          },
          orderBy,
          skip: (page - 1) * limit,
          take: limit,
        })
      ),
      withRetry(() => prisma.quiz.count({ where })),
      // Summary KPIs across the group (for active sent quizzes)
      Promise.all([
        withRetry(() => prisma.quiz.count({ where: { groupId, sentAt: { not: null }, type: "QUIZ", deletedAt: null } })),
        withRetry(() => prisma.quiz.count({ where: { groupId, sentAt: { not: null }, type: "POLL", deletedAt: null } })),
        withRetry(() => prisma.quiz.count({ where: { groupId, sentAt: { not: null }, pollClosed: false, deletedAt: null } })),
        withRetry(() => prisma.quiz.count({ where: { groupId, sentAt: { not: null }, pollClosed: true, deletedAt: null } })),
        withRetry(() => prisma.quiz.count({ where: { groupId, sentAt: { not: null }, isAnonymous: true, deletedAt: null } })),
        withRetry(() => prisma.quiz.count({ where: { groupId, sentAt: { not: null }, isAnonymous: false, deletedAt: null } })),
        withRetry(() => prisma.pollAnswer.count({ where: { quiz: { groupId, sentAt: { not: null } } } })),
        withRetry(() => prisma.quiz.count({ where: { groupId, sentAt: { not: null }, deletedAt: { not: null } } })),
      ]),
      withRetry(() =>
        prisma.topic.findMany({
          where: { groupId },
          select: { topicId: true, name: true, iconColor: true },
          orderBy: { name: "asc" },
        })
      ),
      withRetry(() =>
        prisma.quiz.findMany({
          where: { groupId, sentAt: { not: null } },
          select: { tags: true },
        })
      ),
      // Group overall accuracy calculation
      prisma.$queryRaw<AccuracyRow[]>`
        SELECT
          COUNT(pa.id) AS total_answers,
          COUNT(CASE WHEN q."correctOptionId" = ANY(pa."optionIds") THEN 1 END) AS total_correct
        FROM "poll_answers" pa
        JOIN "quizzes" q ON q.id = pa."quizId"
        WHERE q."groupId" = ${groupId}
          AND q."sentAt" IS NOT NULL
          AND q."deletedAt" IS NULL
          AND q."type" = 'QUIZ'
          AND q."correctOptionId" IS NOT NULL
      `.catch(() => [] as AccuracyRow[]),
    ]);

    // Unique tags across group
    const tagSet = new Set<string>();
    for (const item of groupQuizzesTags) {
      if (Array.isArray(item.tags)) {
        for (const t of item.tags) if (t) tagSet.add(t);
      }
    }
    const availableTags = Array.from(tagSet).sort();

    // Calculate group average accuracy
    let groupAvgAccuracy: number | null = null;
    if (groupAccuracyRows.length > 0) {
      const totAns = Number(groupAccuracyRows[0].total_answers);
      const totCorr = Number(groupAccuracyRows[0].total_correct);
      if (totAns > 0) {
        groupAvgAccuracy = Math.round((totCorr / totAns) * 100);
      }
    }

    // ── 3. Batch correct-rate in ONE raw SQL query ─────────────────────────────
    const quizIdsForRate = quizzes
      .filter((q) => q.type === "QUIZ" && q.correctOptionId !== null && q._count.answers > 0)
      .map((q) => q.id);

    const rateMap: Record<string, number | null> = {};
    for (const id of quizIdsForRate) {
      rateMap[id] = 0;
    }

    if (quizIdsForRate.length > 0) {
      type RateRow = { quiz_id: string; correct_count: bigint };
      const rows = await prisma.$queryRaw<RateRow[]>`
        SELECT
          pa."quizId"  AS quiz_id,
          COUNT(pa.id) AS correct_count
        FROM "poll_answers" pa
        JOIN "quizzes" q ON q.id = pa."quizId"
        WHERE pa."quizId" = ANY(${quizIdsForRate}::text[])
          AND q."correctOptionId" = ANY(pa."optionIds")
        GROUP BY pa."quizId"
      `.catch(() => [] as RateRow[]);

      for (const row of rows) {
        const quiz = quizzes.find((q) => q.id === row.quiz_id);
        if (quiz && quiz._count.answers > 0) {
          rateMap[row.quiz_id] = Math.round((Number(row.correct_count) / quiz._count.answers) * 100);
        }
      }
    }

    // ── 4. Batch option vote breakdown ──────────────────────────────────────────
    const allQuizIds = quizzes.map((q) => q.id);
    const optionVotesMap: Record<string, Record<number, number>> = {};

    if (allQuizIds.length > 0) {
      type OptionVoteRow = { quiz_id: string; opt_id: number; vote_count: bigint };
      const optionVoteRows = await prisma.$queryRaw<OptionVoteRow[]>`
        SELECT
          pa."quizId" AS quiz_id,
          opt.opt_id,
          COUNT(pa.id) AS vote_count
        FROM "poll_answers" pa,
        UNNEST(pa."optionIds") AS opt(opt_id)
        WHERE pa."quizId" = ANY(${allQuizIds}::text[])
        GROUP BY pa."quizId", opt.opt_id
      `.catch(() => [] as OptionVoteRow[]);

      for (const r of optionVoteRows) {
        if (!optionVotesMap[r.quiz_id]) optionVotesMap[r.quiz_id] = {};
        optionVotesMap[r.quiz_id][Number(r.opt_id)] = Number(r.vote_count);
      }
    }

    // ── 5. Fetch answers for non-anonymous quizzes (real respondents) ───────────
    const publicQuizIds = quizzes.filter((q) => !q.isAnonymous).map((q) => q.id);
    const publicAnswersMap: Record<string, Array<{
      id: string;
      firstName: string | null;
      username: string | null;
      telegramUserId: string;
      optionIds: number[];
      answeredAt: Date;
    }>> = {};

    if (publicQuizIds.length > 0) {
      const answersList = await withRetry(() =>
        prisma.pollAnswer.findMany({
          where: {
            quizId: { in: publicQuizIds },
            telegramUserId: { not: { startsWith: "anon_" } },
          },
          select: {
            id: true,
            quizId: true,
            firstName: true,
            username: true,
            telegramUserId: true,
            optionIds: true,
            answeredAt: true,
          },
          orderBy: { answeredAt: "desc" },
          take: 300,
        })
      ).catch(() => []);

      for (const ans of answersList) {
        if (!publicAnswersMap[ans.quizId]) publicAnswersMap[ans.quizId] = [];
        if (publicAnswersMap[ans.quizId].length < 50) {
          publicAnswersMap[ans.quizId].push(ans);
        }
      }
    }

    // ── 6. Build Telegram direct link helper ──────────────────────────────────
    const buildTelegramUrl = (messageId: number | null, topicThreadId: number | null) => {
      if (!messageId) return null;
      if (group?.username) {
        if (topicThreadId) {
          return `https://t.me/${group.username}/${topicThreadId}/${messageId}`;
        }
        return `https://t.me/${group.username}/${messageId}`;
      }
      if (group?.chatId) {
        if (group.chatId.startsWith("-100")) {
          const cleanChatId = group.chatId.slice(4);
          if (topicThreadId) {
            return `https://t.me/c/${cleanChatId}/${topicThreadId}/${messageId}`;
          }
          return `https://t.me/c/${cleanChatId}/${messageId}`;
        }
      }
      return null;
    };

    const now = Date.now();
    const enriched = quizzes.map((q) => {
      const isClosed = q.pollClosed;

      // Seconds left for active timer
      let secondsLeft: number | null = null;
      if (!isClosed && q.openPeriod && q.sentAt) {
        const expiryTime = new Date(q.sentAt).getTime() + q.openPeriod * 1000;
        secondsLeft = Math.max(0, Math.floor((expiryTime - now) / 1000));
      }

      return {
        ...q,
        pollClosed: isClosed,
        secondsLeft,
        correctRate: rateMap[q.id] ?? null,
        optionVotes: optionVotesMap[q.id] || {},
        telegramUrl: buildTelegramUrl(q.messageId, q.topicId),
        publicAnswers: publicAnswersMap[q.id] || [],
      };
    });

    // In-page sort for computed rate if requested
    if (sort === "highest_rate") {
      enriched.sort((a, b) => (b.correctRate ?? -1) - (a.correctRate ?? -1));
    } else if (sort === "lowest_rate") {
      enriched.sort((a, b) => (a.correctRate ?? 999) - (b.correctRate ?? 999));
    }

    const [
      totalQuizzesCount,
      totalPollsCount,
      activeCount,
      closedCount,
      anonymousCount,
      publicCount,
      totalResponsesCount,
      deletedCount,
    ] = summaryCounts;

    return NextResponse.json({
      quizzes: enriched,
      pagination: { page, limit, total, pages: Math.ceil(total / limit) },
      groupTitle: group?.title || null,
      group: {
        id: group?.id,
        title: group?.title,
        username: group?.username,
        chatId: group?.chatId,
        isForum: group?.isForum,
      },
      availableTopics: groupTopics,
      availableTags,
      summary: {
        totalQuizzes: totalQuizzesCount,
        totalPolls: totalPollsCount,
        activeCount,
        closedCount,
        anonymousCount,
        publicCount,
        totalResponses: totalResponsesCount,
        deletedCount,
        avgAccuracyRate: groupAvgAccuracy,
      },
    });
  } catch (error) {
    console.error("[history] GET error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
