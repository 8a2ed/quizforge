import { NextRequest, NextResponse } from "next/server";
import { jwtVerify } from "jose";
import { prisma, withRetry } from "@/lib/db";

const JWT_SECRET = new TextEncoder().encode(process.env.AUTH_SECRET || "secret");

async function authorize(req: NextRequest, groupId: string) {
  const token = req.cookies.get("qf_session")?.value;
  if (!token) return null;
  const { payload } = await jwtVerify(token, JWT_SECRET).catch(() => ({ payload: null }));
  if (!payload) return null;
  const userId = (payload as { sub: string }).sub;
  return withRetry(() => prisma.groupMember.findUnique({
    where: { userId_groupId: { userId, groupId } },
    include: { group: true },
  }));
}

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
    const page = parseInt(searchParams.get("page") || "1");
    const limit = parseInt(searchParams.get("limit") || "20");
    const type = searchParams.get("type");
    const topicId = searchParams.get("topicId");
    const sentById = searchParams.get("sentById");
    const q = searchParams.get("q");

    // Only fetch quizzes that have been sent (not pending scheduled ones)
    const where: Record<string, unknown> = { groupId, sentAt: { not: null } };
    if (type) where.type = type.toUpperCase();
    if (topicId) where.topicId = parseInt(topicId);
    if (sentById) where.sentById = sentById;
    if (q) where.question = { contains: q, mode: "insensitive" };

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

    // Batch correct-rate calculation (one query instead of N queries)
    const quizIds = quizzes.filter(q => q.type === "QUIZ" && q.correctOptionId !== null).map(q => q.id);
    const correctCounts = quizIds.length > 0
      ? await withRetry(() => prisma.pollAnswer.groupBy({
          by: ["quizId"],
          where: {
            quizId: { in: quizIds },
          },
          _count: { id: true },
        }))
      : [];

    // Build a map: quizId -> correct count (note: groupBy doesn't filter by optionIds easily)
    // So we use a simpler per-quiz approach but run in parallel
    const correctRates = await Promise.all(
      quizzes.map(async (quiz) => {
        if (quiz.type !== "QUIZ" || quiz.correctOptionId === null || quiz._count.answers === 0) {
          return { id: quiz.id, rate: null };
        }
        const correct = await withRetry(() => prisma.pollAnswer.count({
          where: { quizId: quiz.id, optionIds: { has: quiz.correctOptionId! } },
        }));
        return { id: quiz.id, rate: Math.round((correct / quiz._count.answers) * 100) };
      })
    );
    const rateMap = Object.fromEntries(correctRates.map(r => [r.id, r.rate]));

    const enriched = quizzes.map(q => ({ ...q, correctRate: rateMap[q.id] ?? null }));

    return NextResponse.json({
      quizzes: enriched,
      pagination: { page, limit, total, pages: Math.ceil(total / limit) },
    });
  } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
}
