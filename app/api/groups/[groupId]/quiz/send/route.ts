import { NextRequest, NextResponse } from "next/server";
import { jwtVerify } from "jose";
import { prisma, withRetry } from "@/lib/db";
import { telegram } from "@/lib/telegram";

const JWT_SECRET = new TextEncoder().encode(process.env.AUTH_SECRET || "secret");

async function getAuthorizedUser(req: NextRequest, groupId: string) {
  const token = req.cookies.get("qf_session")?.value;
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, JWT_SECRET);
    const userId = (payload as { sub: string }).sub;

    const membership = await prisma.groupMember.findUnique({
      where: { userId_groupId: { userId, groupId } },
      include: { group: true, user: true },
    });

    if (!membership || !membership.approved) return null;
    return { membership, userId, telegramId: (payload as { telegramId: string }).telegramId };
  } catch {
    return null;
  }
}

// POST /api/groups/[groupId]/quiz/send
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ groupId: string }> }
) {
  const { groupId } = await params;
  const auth = await getAuthorizedUser(req, groupId);
  if (!auth) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json();
  const {
    question,
    options,
    type = "quiz",
    isAnonymous = true,
    correctOptionId,
    explanation,
    allowsMultiple = false,
    openPeriod,
    topicId,
    topicName,
    scheduledAt,
  } = body;

  // Validations
  if (!question?.trim()) return NextResponse.json({ error: "Question is required" }, { status: 400 });
  if (!options || options.length < 2) return NextResponse.json({ error: "At least 2 options required" }, { status: 400 });
  if (type === "quiz" && (correctOptionId === undefined || correctOptionId === null)) {
    return NextResponse.json({ error: "Correct option required for quiz type" }, { status: 400 });
  }

  const chatId = auth.membership.group.chatId;

  const scheduledDate = scheduledAt ? new Date(scheduledAt) : null;
  const isFuture = scheduledDate && scheduledDate > new Date();

  if (isFuture) {
    // Save to DB for the cron job to pick up later
    const quiz = await withRetry(() => prisma.quiz.create({
      data: {
        question: question.trim(),
        options,
        correctOptionId: type === "quiz" ? correctOptionId : null,
        explanation: explanation?.trim() || null,
        type: type === "quiz" ? "QUIZ" : "POLL",
        isAnonymous,
        allowsMultiple: type === "poll" ? allowsMultiple : false,
        openPeriod: openPeriod || null,
        topicId: topicId || null,
        topicName: topicName || null,
        scheduledAt: scheduledDate,
        sentAt: null,
        groupId,
        sentById: auth.userId,
      },
      include: {
        sentBy: { select: { firstName: true, username: true } },
      },
    }));
    return NextResponse.json({ ok: true, quiz, scheduled: true });
  }

  // Send to Telegram immediately
  let message;
  try {
    message = await telegram.sendPoll({
      chat_id: chatId,
      message_thread_id: topicId || undefined,
      question: question.trim(),
      options: options.map((o: string) => ({ text: o.trim() })),
      type: type === "quiz" ? "quiz" : "regular",
      is_anonymous: isAnonymous,
      correct_option_id: type === "quiz" ? correctOptionId : undefined,
      explanation: explanation?.trim() || undefined,
      explanation_parse_mode: "HTML",
      allows_multiple_answers: type === "poll" ? allowsMultiple : undefined,
      open_period: openPeriod && openPeriod > 0 ? openPeriod : undefined,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Failed to send to Telegram";
    // Give a helpful hint for common local dev mistakes
    const hint = msg.includes("bot was kicked") || msg.includes("chat not found")
      ? " — Make sure @agridmu_bot is added as an admin to this group first!"
      : msg.includes("ETELEGRAM") || msg.includes("Telegram API error")
      ? " — Check that TELEGRAM_BOT_TOKEN in .env is correct."
      : "";
    return NextResponse.json({ error: msg + hint }, { status: 500 });
  }

  // Save to DB
  const quiz = await withRetry(() => prisma.quiz.create({
    data: {
      question: question.trim(),
      options,
      correctOptionId: type === "quiz" ? correctOptionId : null,
      explanation: explanation?.trim() || null,
      type: type === "quiz" ? "QUIZ" : "POLL",
      isAnonymous,
      allowsMultiple: type === "poll" ? allowsMultiple : false,
      openPeriod: openPeriod || null,
      topicId: topicId || null,
      topicName: topicName || null,
      sentAt: new Date(),
      messageId: message.message_id,
      pollId: message.poll?.id || null,
      groupId,
      sentById: auth.userId,
    },
    include: {
      sentBy: { select: { firstName: true, username: true } },
    },
  }));

  return NextResponse.json({ ok: true, quiz, scheduled: false });
}
