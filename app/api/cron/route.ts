import { NextResponse } from "next/server";
import { prisma, dbPing } from "@/lib/db";
import { telegram } from "@/lib/telegram";

/**
 * GET /api/cron
 * Hit periodically (e.g. every minute) by PM2/cron.
 * Sends due scheduled quizzes, clones recurring ones after sending.
 */
export async function GET(req: Request) {
  const authHeader = req.headers.get("Authorization");
  const urlParams = new URL(req.url).searchParams;
  const cronSecret = process.env.CRON_SECRET || "changeme";
  const token = authHeader?.split("Bearer ")[1] || urlParams.get("secret");

  if (token !== cronSecret) {
    return NextResponse.json({ error: "Unauthorized / Missing CRON_SECRET" }, { status: 401 });
  }

  // Keep-alive ping to prevent Neon from sleeping
  await dbPing().catch(() => {});

  try {
    const dueQuizzes = await prisma.quiz.findMany({
      where: {
        scheduledAt: { lte: new Date() },
        sentAt: null,
      },
      include: { group: true },
    });

    if (dueQuizzes.length === 0) {
      return NextResponse.json({ ok: true, processed: 0, message: "No pending quizzes." });
    }

    const processed: string[] = [];
    const errors: { id: string; error: string }[] = [];

    for (const quiz of dueQuizzes) {
      try {
        // ── Optional: send media image first ────────────────────────────────
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
          } catch (photoErr) {
            console.warn(`[Cron] Photo send failed for quiz ${quiz.id}:`, photoErr);
          }
        }

        // ── Send the poll ────────────────────────────────────────────────────
        const tgMessage = await telegram.sendPoll({
          chat_id: quiz.group.chatId,
          message_thread_id: quiz.topicId || undefined,
          question: quiz.question,
          options: quiz.options.map((t) => ({ text: t })),
          type: quiz.type === "QUIZ" ? "quiz" : "regular",
          is_anonymous: quiz.isAnonymous,
          allows_multiple_answers: quiz.allowsMultiple,
          correct_option_id: quiz.correctOptionId ?? undefined,
          explanation: quiz.explanation || undefined,
          open_period: quiz.openPeriod || undefined,
          reply_to_message_id: replyToMessageId,
        });

        // ── Mark this quiz as sent ───────────────────────────────────────────
        await prisma.quiz.update({
          where: { id: quiz.id },
          data: {
            pollId: tgMessage.poll?.id,
            messageId: tgMessage.message_id,
            sentAt: new Date(),
          },
        });

        // ── If recurring, schedule the next instance ─────────────────────────
        if (quiz.recurrence && quiz.scheduledAt) {
          const next = computeNextDate(quiz.scheduledAt, quiz.recurrence);
          if (next) {
            await prisma.quiz.create({
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
                scheduledAt: next,
                sentAt: null,
                groupId: quiz.groupId,
                sentById: quiz.sentById,
              },
            });
            console.log(`[Cron] Recurring quiz ${quiz.id} (${quiz.recurrence}) — next at ${next.toISOString()}`);
          }
        }

        processed.push(quiz.id);
      } catch (err) {
        console.error(`[Cron] Failed to send quiz ${quiz.id}:`, err);
        errors.push({ id: quiz.id, error: err instanceof Error ? err.message : String(err) });
      }
    }

    return NextResponse.json({
      ok: true,
      processed: processed.length,
      failed: errors.length,
      errors: errors.length ? errors : undefined,
    });
  } catch (error) {
    console.error("[Cron] Pipeline error:", error);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}

/**
 * Computes the next scheduled date based on recurrence type.
 */
function computeNextDate(from: Date, recurrence: string): Date | null {
  const next = new Date(from);
  switch (recurrence) {
    case "daily":
      next.setDate(next.getDate() + 1);
      break;
    case "weekly":
      next.setDate(next.getDate() + 7);
      break;
    case "biweekly":
      next.setDate(next.getDate() + 14);
      break;
    case "monthly":
      next.setMonth(next.getMonth() + 1);
      break;
    default:
      return null;
  }
  return next;
}
