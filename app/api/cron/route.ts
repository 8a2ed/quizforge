import { NextResponse } from "next/server";
import { prisma, dbPing } from "@/lib/db";
import { telegram } from "@/lib/telegram";

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;

async function tgCall(method: string, body: Record<string, unknown>) {
  await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

/**
 * GET /api/cron
 * Runs every minute. Does three things:
 * 1. Keeps the DB alive (Neon ping)
 * 2. Sends due scheduled quizzes (with dedup guard)
 * 3. Detects quizzes deleted from Telegram (stopPoll → message not found → mark deletedAt)
 */
export async function GET(req: Request) {
  const authHeader = req.headers.get("Authorization");
  const urlParams = new URL(req.url).searchParams;
  const cronSecret = process.env.CRON_SECRET || "changeme";
  const token = authHeader?.split("Bearer ")[1] || urlParams.get("secret");
  if (token !== cronSecret) {
    return NextResponse.json({ error: "Unauthorized / Missing CRON_SECRET" }, { status: 401 });
  }

  await dbPing().catch(() => {});

  const processed: string[] = [];
  const errors: { id: string; error: string }[] = [];
  const deletionChecks: string[] = [];

  try {
    // ── 1. Send due scheduled quizzes ─────────────────────────────────────────
    // Lock: select with a processing sentinel — we use sentAt null + scheduledAt lte now
    // Dedup: immediately mark sentAt = "processing" timestamp then update with real sentAt
    const dueQuizzes = await prisma.quiz.findMany({
      where: { scheduledAt: { lte: new Date() }, sentAt: null },
      include: { group: true },
    });

    for (const quiz of dueQuizzes) {
      try {
        // Dedup guard: re-read and check sentAt still null before sending
        const fresh = await prisma.quiz.findUnique({ where: { id: quiz.id }, select: { sentAt: true } });
        if (fresh?.sentAt) continue; // already sent by another process

        // Optimistically mark processing
        await prisma.quiz.update({ where: { id: quiz.id }, data: { sentAt: new Date() } });

        let replyToMessageId: number | undefined;
        if (quiz.mediaUrl) {
          try {
            const photoMsg = await telegram.sendPhoto({
              chat_id: quiz.group.chatId,
              message_thread_id: quiz.topicId || undefined,
              photo: quiz.mediaUrl,
              caption: quiz.question,
              parse_mode: "HTML",
            });
            replyToMessageId = photoMsg.message_id;
          } catch (e) { console.warn(`[Cron] Photo failed for ${quiz.id}:`, e); }
        }

        const tgMessage = await telegram.sendPoll({
          chat_id: quiz.group.chatId,
          message_thread_id: quiz.topicId || undefined,
          question: quiz.question,
          options: quiz.options.map(t => ({ text: t })),
          type: quiz.type === "QUIZ" ? "quiz" : "regular",
          is_anonymous: quiz.isAnonymous,
          allows_multiple_answers: quiz.allowsMultiple,
          correct_option_id: quiz.type === "QUIZ" && quiz.correctOptionId !== null ? quiz.correctOptionId : undefined,
          explanation: quiz.explanation || undefined,
          explanation_parse_mode: quiz.explanation ? "HTML" : undefined,
          allows_adding_options: quiz.allowAddingOptions,
          allows_revoting: quiz.allowRevoting,
          open_period: quiz.openPeriod || undefined,
          reply_to_message_id: replyToMessageId,
        });

        await prisma.quiz.update({
          where: { id: quiz.id },
          data: { pollId: tgMessage.poll?.id, messageId: tgMessage.message_id, sentAt: new Date() },
        });

        // Schedule next occurrence for recurring quizzes
        if (quiz.recurrence && quiz.scheduledAt) {
          const next = computeNextDate(quiz.scheduledAt, quiz.recurrence);
          if (next) {
            await prisma.quiz.create({
              data: {
                question: quiz.question, options: quiz.options,
                correctOptionId: quiz.correctOptionId, explanation: quiz.explanation,
                type: quiz.type, isAnonymous: quiz.isAnonymous,
                allowsMultiple: quiz.allowsMultiple, openPeriod: quiz.openPeriod,
                topicId: quiz.topicId, topicName: quiz.topicName,
                mediaUrl: quiz.mediaUrl, recurrence: quiz.recurrence,
                tags: quiz.tags, allowAddingOptions: quiz.allowAddingOptions,
                allowRevoting: quiz.allowRevoting,
                scheduledAt: next, sentAt: null,
                groupId: quiz.groupId, sentById: quiz.sentById,
              },
            });
          }
        }

        processed.push(quiz.id);
      } catch (err) {
        // If sending failed, revert sentAt so it retries next minute
        await prisma.quiz.update({ where: { id: quiz.id }, data: { sentAt: null } }).catch(() => {});
        errors.push({ id: quiz.id, error: err instanceof Error ? err.message : String(err) });
      }
    }

    // ── 2. Deletion checker (runs on recently-sent non-deleted quizzes) ────────
    // Check quizzes sent in last 7 days that aren't marked deleted — try stopPoll
    // If Telegram says "message not found" → quiz was deleted from Telegram
    const recentQuizzes = await prisma.quiz.findMany({
      where: {
        sentAt: { gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000), not: null },
        deletedAt: null,
        pollClosed: false,
        messageId: { not: null },
        pollId: { not: null },
      },
      include: { group: true },
      take: 30, // limit per cron run
    });

    for (const quiz of recentQuizzes) {
      try {
        const res = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/stopPoll`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ chat_id: quiz.group.chatId, message_id: quiz.messageId }),
        });
        const data = await res.json();
        if (!data.ok) {
          const desc: string = data.description || "";
          if (desc.includes("message not found") || desc.includes("message to stop poll not found")) {
            await prisma.quiz.update({ where: { id: quiz.id }, data: { deletedAt: new Date() } });
            deletionChecks.push(quiz.id);
          } else if (data.ok) {
            // Poll was still open — it's now closed; mark it
            await prisma.quiz.update({ where: { id: quiz.id }, data: { pollClosed: true } });
          }
        } else {
          // stopPoll succeeded → mark closed
          await prisma.quiz.update({ where: { id: quiz.id }, data: { pollClosed: true } });
        }
      } catch { /* ignore individual check errors */ }
    }

    return NextResponse.json({
      ok: true,
      processed: processed.length,
      failed: errors.length,
      deletionMarked: deletionChecks.length,
      errors: errors.length ? errors : undefined,
    });
  } catch (error) {
    console.error("[Cron] Pipeline error:", error);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
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
