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
    allowAddingOptions = false,
    allowRevoting = false,
    collectionIds,
    collectionId,
  } = body;

  // Validations & Human-Error Prevention
  const cleanQuestion = question?.trim();
  if (!cleanQuestion)
    return NextResponse.json({ error: "Question is required" }, { status: 400 });
  if (cleanQuestion.length > 300)
    return NextResponse.json({ error: "Question cannot exceed 300 characters." }, { status: 400 });

  if (!Array.isArray(options) || options.length < 2)
    return NextResponse.json({ error: "At least 2 options are required." }, { status: 400 });
  if (options.length > 10)
    return NextResponse.json({ error: "Telegram polls support a maximum of 10 options." }, { status: 400 });

  const cleanOptions: string[] = options.map((o: string) => String(o || "").trim());
  if (cleanOptions.some((o) => !o))
    return NextResponse.json({ error: "Options cannot be empty." }, { status: 400 });
  if (cleanOptions.some((o) => o.length > 100))
    return NextResponse.json({ error: "Each option must be 100 characters or less." }, { status: 400 });

  // Prevent duplicate options (causes POLL_ANSWERS_DUPLICATE in Telegram)
  const lowerOptions = cleanOptions.map((o) => o.toLowerCase());
  if (new Set(lowerOptions).size !== lowerOptions.length) {
    return NextResponse.json({ error: "Options must be unique. Duplicate answers are not allowed by Telegram." }, { status: 400 });
  }

  if (type === "quiz") {
    if (correctOptionId === undefined || correctOptionId === null || correctOptionId < 0 || correctOptionId >= cleanOptions.length) {
      return NextResponse.json({ error: "A valid correct option must be selected for quiz mode." }, { status: 400 });
    }
  }

  // Explanation only allowed for quiz and max 200 chars
  const cleanExplanation = type === "quiz" && explanation?.trim() ? explanation.trim() : null;
  if (cleanExplanation && cleanExplanation.length > 200) {
    return NextResponse.json({ error: "Explanation cannot exceed 200 characters." }, { status: 400 });
  }

  const chatId = auth.membership.group.chatId;
  const scheduledDate = scheduledAt ? new Date(scheduledAt) : null;
  const isFuture = scheduledDate && scheduledDate.getTime() > Date.now();

  if (scheduledAt) {
    if (!scheduledDate || isNaN(scheduledDate.getTime())) {
      return NextResponse.json({ error: "Invalid scheduled date/time." }, { status: 400 });
    }
    if (scheduledDate.getTime() < Date.now() + 30_000) {
      return NextResponse.json({ error: "Scheduled time must be at least 1 minute in the future." }, { status: 400 });
    }
  }

  // Sanitize tags
  let sanitizedTags: string[] = [];
  if (Array.isArray(tags)) {
    sanitizedTags = tags
      .map(t => String(t).trim().toLowerCase())
      .filter(t => t.length > 0)
      .slice(0, 5); // max 5 tags
  }

  // Telegram open_period must be between 5 and 600 seconds
  let telegramOpenPeriod: number | undefined = undefined;
  if (openPeriod && Number(openPeriod) > 0) {
    const parsedPeriod = Number(openPeriod);
    if (!isNaN(parsedPeriod)) {
      telegramOpenPeriod = Math.min(600, Math.max(5, Math.round(parsedPeriod)));
    }
  }

  // Shared DB payload
  const effectiveMediaUrl = mediaUrl?.trim() || (mediaBase64 ? `data:${mediaMimeType || "image/jpeg"};base64,${mediaBase64}` : null);

  const quizData = {
    question: cleanQuestion,
    options: cleanOptions,
    correctOptionId: type === "quiz" ? correctOptionId : null,
    explanation: cleanExplanation,
    type: type === "quiz" ? "QUIZ" as const : "POLL" as const,
    isAnonymous: Boolean(isAnonymous),
    allowsMultiple: type === "poll" ? Boolean(allowsMultiple) : false,
    openPeriod: telegramOpenPeriod || null,
    topicId: topicId || null,
    topicName: topicName || null,
    mediaUrl: effectiveMediaUrl,
    recurrence: recurrence || null,
    tags: sanitizedTags,
    allowAddingOptions: type === "poll" ? Boolean(allowAddingOptions) : false,
    allowRevoting: type === "poll" ? Boolean(allowRevoting) : false,
    groupId,
    sentById: auth.userId,
  };

  // ── Scheduled: save for cron ──────────────────────────────────────────────
  if (isFuture && scheduledDate) {
    const quiz = await withRetry(() => prisma.quiz.create({
      data: { ...quizData, scheduledAt: scheduledDate, sentAt: null },
      include: { sentBy: { select: { firstName: true, username: true } } },
    }));

    const targetCids: string[] = Array.isArray(collectionIds)
      ? collectionIds.filter((cid: any) => typeof cid === "string" && cid.trim().length > 0)
      : collectionId && typeof collectionId === "string" && collectionId.trim().length > 0
      ? [collectionId.trim()]
      : [];

    if (targetCids.length > 0) {
      await withRetry(() =>
        prisma.collectionQuiz.createMany({
          data: targetCids.map((cid: string) => ({
            collectionId: cid,
            quizId: quiz.id,
          })),
          skipDuplicates: true,
        })
      );
    }

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
          caption: cleanQuestion,
        });
        replyToMessageId = photoMsg.message_id;
      } else if (mediaUrl?.trim()) {
        const photoMsg = await telegram.sendPhoto({
          chat_id: chatId,
          message_thread_id: topicId || undefined,
          photo: mediaUrl.trim(),
          caption: cleanQuestion,
        });
        replyToMessageId = photoMsg.message_id;
      }
    } catch (err) {
      console.warn("[Quiz Send] Photo upload failed:", err instanceof Error ? err.message : err);
      // Non-fatal — still send the poll without image
    }
  }

  // Step 2: Send the poll with resilience against parse mode failures
  let message;
  const wantsHtmlExplanation = Boolean(cleanExplanation && /<[a-z][\s\S]*>/i.test(cleanExplanation));
  const basePollPayload = {
    chat_id: chatId,
    message_thread_id: topicId || undefined,
    question: cleanQuestion,
    options: cleanOptions.map((o: string) => ({ text: o })),
    type: type === "quiz" ? ("quiz" as const) : ("regular" as const),
    is_anonymous: Boolean(isAnonymous),
    correct_option_id: type === "quiz" ? correctOptionId : undefined,
    explanation: cleanExplanation || undefined,
    explanation_parse_mode: wantsHtmlExplanation ? ("HTML" as const) : undefined,
    allows_multiple_answers: type === "poll" ? Boolean(allowsMultiple) : false,
    open_period: telegramOpenPeriod,
    reply_to_message_id: replyToMessageId,
  };

  try {
    try {
      message = await telegram.sendPoll(basePollPayload);
    } catch (pollErr: any) {
      // If Telegram failed due to unescaped HTML tags in explanation, retry as plain text
      if (basePollPayload.explanation_parse_mode && String(pollErr?.message || "").includes("parse entities")) {
        const fallbackPayload = { ...basePollPayload };
        delete fallbackPayload.explanation_parse_mode;
        message = await telegram.sendPoll(fallbackPayload);
      } else {
        throw pollErr;
      }
    }
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

  const targetCids: string[] = Array.isArray(collectionIds)
    ? collectionIds.filter((cid: any) => typeof cid === "string" && cid.trim().length > 0)
    : collectionId && typeof collectionId === "string" && collectionId.trim().length > 0
    ? [collectionId.trim()]
    : [];

  if (targetCids.length > 0) {
    await withRetry(() =>
      prisma.collectionQuiz.createMany({
        data: targetCids.map((cid: string) => ({
          collectionId: cid,
          quizId: quiz.id,
        })),
        skipDuplicates: true,
      })
    );
  }

  return NextResponse.json({ ok: true, quiz, scheduled: false });
}
