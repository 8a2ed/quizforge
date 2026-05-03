import { NextRequest, NextResponse } from "next/server";
import { jwtVerify } from "jose";
import { prisma, withRetry } from "@/lib/db";
import { telegram } from "@/lib/telegram";

const JWT_SECRET = new TextEncoder().encode(process.env.AUTH_SECRET || "secret");

// POST /api/groups/[groupId]/quiz/[quizId]/close
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ groupId: string; quizId: string }> }
) {
  const { groupId, quizId } = await params;
  const token = req.cookies.get("qf_session")?.value;
  if (!token) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const { payload } = await jwtVerify(token, JWT_SECRET);
    const userId = (payload as { sub: string }).sub;

    const membership = await withRetry(() => prisma.groupMember.findUnique({
      where: { userId_groupId: { userId, groupId } },
      include: { group: true },
    }));
    if (!membership || !membership.approved) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

    const quiz = await withRetry(() => prisma.quiz.findFirst({ where: { id: quizId, groupId } }));
    if (!quiz) return NextResponse.json({ error: "Quiz not found" }, { status: 404 });
    if (quiz.pollClosed) return NextResponse.json({ error: "Poll already closed" }, { status: 400 });
    if (!quiz.messageId) return NextResponse.json({ error: "No message ID — cannot close via API" }, { status: 400 });

    // Stop the poll in Telegram
    let telegramClosed = false;
    let telegramError: string | null = null;
    try {
      await telegram.sendPoll({
        chat_id: membership.group.chatId,
        question: quiz.question,
        options: quiz.options.map(o => ({ text: o })),
        is_closed: true,
        // We use stopPoll instead — add it to telegram lib
      } as Parameters<typeof telegram.sendPoll>[0]);
    } catch { /* ignore — use stopPoll method */ }

    // Use stopPoll Telegram API directly
    const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
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
      if (data.ok) telegramClosed = true;
      else telegramError = data.description || "Telegram error";
    } catch (err) {
      telegramError = err instanceof Error ? err.message : "Network error";
    }

    // Always mark as closed in DB
    await withRetry(() => prisma.quiz.update({
      where: { id: quizId },
      data: { pollClosed: true },
    }));

    return NextResponse.json({ ok: true, telegramClosed, telegramError });
  } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
}
