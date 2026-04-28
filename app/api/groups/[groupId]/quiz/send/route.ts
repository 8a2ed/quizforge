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
    options,         // already shuffled client-side if needed
    type = "quiz",
    isAnonymous = true,
    correctOptionId,
    explanation,
    allowsMultiple = false,
    openPeriod,
    topicId,
    topicName,
    scheduledAt,
    mediaUrl,
    mediaBase64,     // base64 image from file picker
    mediaMimeType,   // e.g. "image/jpeg"
    recurrence,
    tags,            // Array of tags
  } = body;

  // Validations
  if (!question?.trim())
    return NextResponse.json({ error: "Question is required" }, { status: 400 });
  if (!options || options.length < 2)
    return NextResponse.json({ error: "At least 2 options required" }, { status: 400 });
  if (type === "quiz" && (correctOptionId === undefined || correctOptionId === null))
    return NextResponse.json({ error: "Correct option required for quiz type" }, { status: 400 });

  const chatId = auth.membership.group.chatId;
  const scheduledDate = scheduledAt ? new Date(scheduledAt) : null;
  const isFuture = scheduledDate && scheduledDate > new Date();

  // Sanitize tags
  let sanitizedTags: string[] = [];
  if (Array.isArray(tags)) {
    sanitizedTags = tags
      .map(t => String(t).trim().toLowerCase())
      .filter(t => t.length > 0)
      .slice(0, 5); // max 5 tags
  }

  // Shared DB payload
  const quizData = {
    question: question.trim(),
    options,
    correctOptionId: type === "quiz" ? correctOptionId : null,
    explanation: explanation?.trim() || null,
    type: type === "quiz" ? "QUIZ" as const : "POLL" as const,
    isAnonymous,
    allowsMultiple: type === "poll" ? allowsMultiple : false,
    openPeriod: openPeriod || null,
    topicId: topicId || null,
    topicName: topicName || null,
    mediaUrl: mediaUrl?.trim() || null,
    recurrence: recurrence || null,
    tags: sanitizedTags,
    groupId,
    sentById: auth.userId,
  };

  // ── Scheduled: save for cron ──────────────────────────────────────────────
  if (isFuture) {
    const quiz = await withRetry(() => prisma.quiz.create({
      data: { ...quizData, scheduledAt: scheduledDate, sentAt: null },
      include: { sentBy: { select: { firstName: true, username: true } } },
    }));
    return NextResponse.json({ ok: true, quiz, scheduled: true });
  }

  // ── Send immediately ───────────────────────────────────────────────────────
  let replyToMessageId: number | undefined;

  // Step 1: Send image (URL or binary from gallery/camera)
  const hasMedia = mediaBase64 || mediaUrl?.trim();
  if (hasMedia) {
    try {
      if (mediaBase64) {
        // Upload base64 image from gallery/camera picker
        const photoMsg = await telegram.sendPhotoBase64({
          chat_id: chatId,
          message_thread_id: topicId || undefined,
          photoBase64: mediaBase64,
          mimeType: mediaMimeType || "image/jpeg",
          caption: question.trim(),
        });
        replyToMessageId = photoMsg.message_id;
      } else if (mediaUrl?.trim()) {
        const photoMsg = await telegram.sendPhoto({
          chat_id: chatId,
          message_thread_id: topicId || undefined,
          photo: mediaUrl.trim(),
          caption: question.trim(),
          parse_mode: "HTML",
        });
        replyToMessageId = photoMsg.message_id;
      }
    } catch (err) {
      console.warn("[Quiz Send] Photo upload failed:", err instanceof Error ? err.message : err);
      // Non-fatal — still send the poll without image
    }
  }

  // Step 2: Send the poll
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
      reply_to_message_id: replyToMessageId,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Failed to send to Telegram";
    const hint = msg.includes("bot was kicked") || msg.includes("chat not found")
      ? " — Make sure @agridmu_bot is added as an admin to this group!"
      : msg.includes("ETELEGRAM") || msg.includes("Telegram API error")
      ? " — Check TELEGRAM_BOT_TOKEN in .env."
      : "";
    return NextResponse.json({ error: msg + hint }, { status: 500 });
  }

  // Step 3: Save to DB
  const quiz = await withRetry(() => prisma.quiz.create({
    data: {
      ...quizData,
      scheduledAt: null,
      sentAt: new Date(),
      messageId: message.message_id,
      pollId: message.poll?.id || null,
    },
    include: { sentBy: { select: { firstName: true, username: true } } },
  }));

  return NextResponse.json({ ok: true, quiz, scheduled: false });
}
