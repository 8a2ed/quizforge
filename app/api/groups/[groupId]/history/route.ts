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

    // Auth check + group title in one query
    const [membership, group] = await Promise.all([
      withRetry(() => prisma.groupMember.findUnique({
        where: { userId_groupId: { userId, groupId } },
      })),
      withRetry(() => prisma.group.findUnique({
        where: { id: groupId },
        select: { id: true, title: true },
      })),
    ]);

    if (!membership) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

    const { searchParams } = req.nextUrl;
    const page    = Math.max(1, parseInt(searchParams.get("page")  || "1"));
    const limit   = Math.min(50, Math.max(1, parseInt(searchParams.get("limit") || "20")));
    const type     = searchParams.get("type");
    const status   = searchParams.get("status"); // active | closed | deleted
    const topicId  = searchParams.get("topicId");
    const sentById = searchParams.get("sentById");
    const q        = searchParams.get("q");

    // Build where clause
    const where: Record<string, unknown> = { groupId, sentAt: { not: null } };
    if (type)     where.type    = type.toUpperCase();
    if (topicId)  where.topicId = parseInt(topicId);
    if (sentById) where.sentById = sentById;
    if (q)        where.question = { contains: q, mode: "insensitive" };
    if (status === "deleted")      where.deletedAt = { not: null };
    else if (status === "closed")  { where.deletedAt = null; where.pollClosed = true; }
    else if (status === "active")  { where.deletedAt = null; where.pollClosed = false; }

    // Fetch quizzes + total count in parallel
    const [quizzes, total] = await Promise.all([
      withRetry(() => prisma.quiz.findMany({
        where,
        include: {
          sentBy: { select: { id: true, firstName: true, username: true, photoUrl: true } },
          _count: { select: { answers: true } },
        },
        orderBy: { sentAt: "desc" },
        skip: (page - 1) * limit,
        take: limit,
      })),
      withRetry(() => prisma.quiz.count({ where })),
    ]);

    // ── Batch correct-rate in ONE raw SQL query (eliminates N+1) ─────────────
    // Counts rows where the correct option is in the user's selected options array.
    const quizIdsForRate = quizzes
      .filter((q) => q.type === "QUIZ" && q.correctOptionId !== null && q._count.answers > 0)
      .map((q) => q.id);

    const rateMap: Record<string, number | null> = {};

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
      `;

      for (const row of rows) {
        const quiz = quizzes.find((q) => q.id === row.quiz_id);
        if (quiz && quiz._count.answers > 0) {
          rateMap[row.quiz_id] = Math.round((Number(row.correct_count) / quiz._count.answers) * 100);
        }
      }
    }

    const enriched = quizzes.map((q) => ({
      ...q,
      correctRate: rateMap[q.id] ?? null,
    }));

    return NextResponse.json({
      quizzes: enriched,
      pagination: { page, limit, total, pages: Math.ceil(total / limit) },
      groupTitle: group?.title || null,
    });
  } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
}
