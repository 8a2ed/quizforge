import { NextRequest, NextResponse } from "next/server";
import { jwtVerify } from "jose";
import { prisma, withRetry } from "@/lib/db";
import { telegram } from "@/lib/telegram";

const JWT_SECRET = new TextEncoder().encode(process.env.AUTH_SECRET || "secret");

async function authorize(req: NextRequest, groupId: string) {
  const token = req.cookies.get("qf_session")?.value;
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, JWT_SECRET);
    const userId = (payload as { sub: string }).sub;
    const m = await withRetry(() => prisma.groupMember.findUnique({
      where: { userId_groupId: { userId, groupId } },
      include: { group: true },
    }));
    if (!m || !m.approved) return null;
    return { userId, membership: m };
  } catch { return null; }
}

// GET — list pending scheduled quizzes for this group
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ groupId: string }> }
) {
  const { groupId } = await params;
  const auth = await authorize(req, groupId);
  if (!auth) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const quizzes = await withRetry(() => prisma.quiz.findMany({
    where: { groupId, sentAt: null, scheduledAt: { not: null } },
    orderBy: { scheduledAt: "asc" },
    select: {
      id: true,
      question: true,
      options: true,
      type: true,
      isAnonymous: true,
      correctOptionId: true,
      explanation: true,
      topicId: true,
      topicName: true,
      scheduledAt: true,
      recurrence: true,
      tags: true,
      openPeriod: true,
      allowsMultiple: true,
      createdAt: true,
    },
  }));

  return NextResponse.json({ quizzes });
}

// PATCH — update scheduledAt or other fields
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ groupId: string }> }
) {
  const { groupId } = await params;
  const auth = await authorize(req, groupId);
  if (!auth) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id, scheduledAt, recurrence, topicId, topicName } = await req.json();
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });

  const updated = await withRetry(() => prisma.quiz.updateMany({
    where: { id, groupId, sentAt: null },
    data: {
      ...(scheduledAt !== undefined ? { scheduledAt: scheduledAt ? new Date(scheduledAt) : null } : {}),
      ...(recurrence !== undefined ? { recurrence } : {}),
      ...(topicId !== undefined ? { topicId: topicId ? Number(topicId) : null } : {}),
      ...(topicName !== undefined ? { topicName: topicName || null } : {}),
    },
  }));

  return NextResponse.json({ ok: true, count: updated.count });
}

// DELETE — cancel a scheduled quiz
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ groupId: string }> }
) {
  const { groupId } = await params;
  const auth = await authorize(req, groupId);
  if (!auth) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await req.json();
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });

  await withRetry(() => prisma.quiz.deleteMany({
    where: { id, groupId, sentAt: null },
  }));

  return NextResponse.json({ ok: true });
}

// POST — send scheduled quiz immediately ("Send Now")
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ groupId: string }> }
) {
  const { groupId } = await params;
  const auth = await authorize(req, groupId);
  if (!auth) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json();
  const id = body?.id || body?.quizId;
  if (!id) return NextResponse.json({ error: "id is required" }, { status: 400 });

  const quiz = await withRetry(() => prisma.quiz.findFirst({
    where: { id, groupId, sentAt: null },
    include: { group: true },
  }));
  if (!quiz) return NextResponse.json({ error: "Scheduled quiz not found or already sent" }, { status: 404 });

  let replyToMessageId: number | undefined;
  if (quiz.mediaUrl) {
    try {
      let photoMsg;
      if (quiz.mediaUrl.startsWith("data:")) {
        const match = quiz.mediaUrl.match(/^data:([^;]+);base64,(.+)$/);
        if (match) {
          photoMsg = await telegram.sendPhotoBase64({
            chat_id: quiz.group.chatId,
            message_thread_id: quiz.topicId || undefined,
            photoBase64: match[2],
            mimeType: match[1],
            caption: quiz.question,
          });
        }
      } else {
        photoMsg = await telegram.sendPhoto({
          chat_id: quiz.group.chatId,
          message_thread_id: quiz.topicId || undefined,
          photo: quiz.mediaUrl,
          caption: quiz.question,
          parse_mode: "HTML",
        });
      }
      if (photoMsg) replyToMessageId = photoMsg.message_id;
    } catch (e) {
      console.warn(`[Send Now] Photo failed for ${quiz.id}:`, e);
    }
  }

  let openPeriodVal: number | undefined = undefined;
  let closeDateVal: number | undefined = undefined;
  if (quiz.openPeriod && quiz.openPeriod > 0) {
    if (quiz.openPeriod <= 600) {
      openPeriodVal = Math.max(5, quiz.openPeriod);
    } else {
      closeDateVal = Math.floor(Date.now() / 1000) + quiz.openPeriod;
    }
  }

  const isQuiz = quiz.type === "QUIZ";
  const wantsHtmlExplanation = Boolean(isQuiz && quiz.explanation && /<[a-z][\s\S]*>/i.test(quiz.explanation));

  const basePollPayload = {
    chat_id: quiz.group.chatId,
    message_thread_id: quiz.topicId || undefined,
    question: quiz.question,
    options: quiz.options.map(t => ({ text: t })),
    type: isQuiz ? ("quiz" as const) : ("regular" as const),
    is_anonymous: quiz.isAnonymous,
    allows_multiple_answers: !isQuiz ? Boolean(quiz.allowsMultiple) : false,
    correct_option_id: isQuiz && quiz.correctOptionId !== null ? quiz.correctOptionId : undefined,
    explanation: isQuiz && quiz.explanation ? quiz.explanation : undefined,
    explanation_parse_mode: wantsHtmlExplanation ? ("HTML" as const) : undefined,
    allows_adding_options: !isQuiz ? Boolean(quiz.allowAddingOptions) : false,
    allows_revoting: !isQuiz ? Boolean(quiz.allowRevoting) : false,
    open_period: openPeriodVal,
    close_date: closeDateVal,
    reply_to_message_id: replyToMessageId,
  };

  const sentNow = new Date();

  // Optimistic lock to prevent concurrent dispatch
  const locked = await withRetry(() => prisma.quiz.updateMany({
    where: { id: quiz.id, sentAt: null },
    data: { sentAt: sentNow },
  }));
  if (locked.count === 0) {
    return NextResponse.json({ error: "Quiz was already sent or is currently being sent" }, { status: 409 });
  }

  let tgMessage;
  try {
    try {
      tgMessage = await telegram.sendPoll(basePollPayload);
    } catch (pollErr: any) {
      if (basePollPayload.explanation_parse_mode && String(pollErr?.message || "").includes("parse entities")) {
        const fallbackPayload = { ...basePollPayload };
        delete fallbackPayload.explanation_parse_mode;
        tgMessage = await telegram.sendPoll(fallbackPayload);
      } else {
        throw pollErr;
      }
    }
  } catch (err: any) {
    // Revert sentAt lock on failure so it can be retried or sent by cron
    await withRetry(() => prisma.quiz.update({
      where: { id: quiz.id },
      data: { sentAt: null },
    })).catch(() => {});

    const msg = err instanceof Error ? err.message : "Failed to dispatch scheduled quiz to Telegram";
    return NextResponse.json({ error: msg }, { status: 500 });
  }

  await withRetry(() => prisma.quiz.update({
    where: { id: quiz.id },
    data: {
      scheduledAt: null,
      sentAt: sentNow,
      pollId: tgMessage.poll?.id || null,
      messageId: tgMessage.message_id,
    },
  }));

  // Handle recurrence if recurring
  if (quiz.recurrence) {
    const baseDate = quiz.scheduledAt || sentNow;
    const next = computeNextDate(baseDate, quiz.recurrence);
    if (next) {
      await withRetry(() => prisma.quiz.create({
        data: {
          question: quiz.question,
          options: quiz.options,
          correctOptionId: quiz.correctOptionId,
          explanation: quiz.explanation,
          type: quiz.type,
          isAnonymous: quiz.isAnonymous,
          allowsMultiple: quiz.allowsMultiple,
          openPeriod: quiz.openPeriod,
          topicId: quiz.topicId,
          topicName: quiz.topicName,
          mediaUrl: quiz.mediaUrl,
          recurrence: quiz.recurrence,
          tags: quiz.tags,
          allowAddingOptions: quiz.allowAddingOptions,
          allowRevoting: quiz.allowRevoting,
          scheduledAt: next,
          sentAt: null,
          groupId: quiz.groupId,
          sentById: quiz.sentById,
        },
      }));
    }
  }

  return NextResponse.json({ ok: true, messageId: tgMessage.message_id, sentAt: sentNow });
}

function computeNextDate(from: Date, recurrence: string): Date | null {
  const next = new Date(from);
  switch (recurrence) {
    case "daily":    next.setDate(next.getDate() + 1); break;
    case "weekly":   next.setDate(next.getDate() + 7); break;
    case "biweekly": next.setDate(next.getDate() + 14); break;
    case "monthly":  next.setMonth(next.getMonth() + 1); break;
    default: return null;
  }
  return next;
}

