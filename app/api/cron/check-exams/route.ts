import { NextRequest, NextResponse } from "next/server";
import { checkAndExpireExamSessions } from "@/lib/examExpiry";
import { jwtVerify } from "jose";
import { prisma } from "@/lib/db";
import { getAuthSecret } from "@/lib/auth";
import { safeSecretEquals } from "@/lib/crypto";

export const dynamic = "force-dynamic";

async function isAuthorized(req: NextRequest, groupId: string | null): Promise<boolean> {
  const cronSecret = process.env.CRON_SECRET;
  const bearer = /^Bearer\s+(\S+)$/i.exec(req.headers.get("authorization") || "")?.[1];
  if (safeSecretEquals(bearer, cronSecret)) return true;

  if (!groupId) return false;
  const token = req.cookies.get("qf_session")?.value;
  if (!token) return false;

  try {
    const { payload } = await jwtVerify(token, getAuthSecret());
    if (typeof payload.sub !== "string") return false;
    const membership = await prisma.groupMember.findUnique({
      where: { userId_groupId: { userId: payload.sub, groupId } },
      select: { role: true, approved: true },
    });
    return Boolean(membership?.approved && (membership.role === "OWNER" || membership.role === "ADMIN"));
  } catch {
    return false;
  }
}

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const examId = searchParams.get("examId") || undefined;
    const groupId = searchParams.get("groupId");
    if (!(await isAuthorized(req, groupId))) {
      return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
    }

    if (examId && groupId) {
      const exam = await prisma.exam.findFirst({ where: { id: examId, groupId }, select: { id: true } });
      if (!exam) return NextResponse.json({ ok: false, error: "Exam not found" }, { status: 404 });
    }

    const stats = await checkAndExpireExamSessions(examId, groupId || undefined);

    return NextResponse.json({
      ok: true,
      message: `Exam status check completed: ${stats.expiredCount} expired/failed, ${stats.warnedCount} warned, ${stats.activeCount} active.`,
      stats,
    });
  } catch (error) {
    console.error("[api/cron/check-exams] Error:", error);
    return NextResponse.json(
      { ok: false, error: "Failed to check exam sessions" },
      { status: 500 }
    );
  }
}

export async function POST(req: NextRequest) {
  return GET(req);
}
