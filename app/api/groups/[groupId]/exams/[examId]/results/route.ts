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
    }));
    return m?.approved ? { userId } : null;
  } catch { return null; }
}

// GET /api/groups/[groupId]/exams/[examId]/results
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ groupId: string; examId: string }> }
) {
  const { groupId, examId } = await params;
  const auth = await authorize(req, groupId);
  if (!auth) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const exam = await withRetry(() => prisma.exam.findFirst({
    where: { id: examId, groupId },
    include: {
      results: { orderBy: { completedAt: "desc" } },
      _count: { select: { results: true } },
    },
  }));
  if (!exam) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const results = exam.results;
  const completedResults = results.filter(r => r.score >= 0);
  const inProgressResults = results.filter(r => r.score < 0);
  const passCount = completedResults.filter(r => r.passed).length;
  const avgScore = completedResults.length > 0
    ? Math.round(completedResults.reduce((s, r) => s + r.score, 0) / completedResults.length)
    : 0;

  return NextResponse.json({
    exam: {
      id: exam.id, title: exam.title, passingScore: exam.passingScore,
      totalResults: completedResults.length,
      inProgressCount: inProgressResults.length,
      passCount,
      failCount: completedResults.length - passCount,
      avgScore,
    },
    results,
  });
}
