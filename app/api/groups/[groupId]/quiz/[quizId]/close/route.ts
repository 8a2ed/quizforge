import { NextRequest, NextResponse } from "next/server";
import { jwtVerify } from "jose";
import { prisma, withRetry } from "@/lib/db";
import { syncAnonymousPollAnswers, sendPollClosureSummary } from "@/lib/pollSync";

const JWT_SECRET = new TextEncoder().encode(process.env.AUTH_SECRET || "secret");
const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;

// POST /api/groups/[groupId]/quiz/[quizId]/close
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ groupId: string; quizId: string }> }
) {
  const { groupId, quizId } = await params;
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
    const membership = await withRetry(() =>
      prisma.groupMember.findUnique({
        where: { userId_groupId: { userId, groupId } },
        include: { group: true },
      })
    );
    if (!membership || !membership.approved)
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });

    const quiz = await withRetry(() =>
      prisma.quiz.findFirst({ where: { id: quizId, groupId } })
    );
    if (!quiz) return NextResponse.json({ error: "Quiz not found" }, { status: 404 });
    if (quiz.pollClosed) return NextResponse.json({ error: "Poll already closed" }, { status: 400 });

    let telegramClosed = false;
    let telegramError: string | null = null;
    let telegramResult: unknown = null;

    // If messageId exists, attempt Telegram stopPoll API call
    if (quiz.messageId && BOT_TOKEN) {
      try {
        const res = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/stopPoll`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            chat_id: membership.group.chatId,
            message_id: quiz.messageId,
          }),
        });
        const data = await res.json();
        if (data.ok) {
          telegramClosed = true;
          telegramResult = data.result;

          // If returned poll has options and is anonymous, sync voter counts
          if (data.result && Array.isArray(data.result.options)) {
            if (quiz.isAnonymous) {
              await syncAnonymousPollAnswers(quiz.id, data.result.options, data.result.total_voter_count || 0);
            }
            if ((data.result.total_voter_count || 0) > 0) {
              await sendPollClosureSummary({ ...quiz, group: membership.group }, data.result);
            }
          }
        } else {
          telegramError = data.description || "Telegram stopPoll failed";
        }
      } catch (err) {
        telegramError = err instanceof Error ? err.message : "Network error";
      }
    } else if (!quiz.messageId) {
      telegramError = "No Telegram message ID — closed in QuizForge database only";
    }

    // Always mark closed in DB so history and stats reflect completion
    await withRetry(() =>
      prisma.quiz.update({ where: { id: quizId }, data: { pollClosed: true } })
    );

    return NextResponse.json({ ok: true, telegramClosed, telegramError, poll: telegramResult });
  } catch (error) {
    console.error("[quiz/close] error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
