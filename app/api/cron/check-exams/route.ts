import { NextRequest, NextResponse } from "next/server";
import { checkAndExpireExamSessions } from "@/lib/examExpiry";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const examId = searchParams.get("examId") || undefined;
    const stats = await checkAndExpireExamSessions(examId);

    return NextResponse.json({
      ok: true,
      message: `Exam status check completed: ${stats.expiredCount} expired/failed, ${stats.warnedCount} warned, ${stats.activeCount} active.`,
      stats,
    });
  } catch (error) {
    console.error("[api/cron/check-exams] Error:", error);
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 }
    );
  }
}

export async function POST(req: NextRequest) {
  return GET(req);
}
