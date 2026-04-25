import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { telegram } from "@/lib/telegram";

/**
 * GET /api/cron
 * This endpoint is hit periodically (e.g. every minute) by a cron job or Azure Timer.
 * It queries the database for any scheduled quizzes whose scheduled time has arrived or passed,
 * and which haven't been sent yet.
 */
export async function GET(req: Request) {
  // Use a secret token to secure the endpoint. Can be passed as Auth header or Query param.
  const authHeader = req.headers.get("Authorization");
  const urlParams = new URL(req.url).searchParams;
  const cronSecret = process.env.CRON_SECRET || "changeme";

  const token = authHeader?.split("Bearer ")[1] || urlParams.get("secret");
  
  if (token !== cronSecret) {
    return NextResponse.json({ error: "Unauthorized / Missing CRON_SECRET" }, { status: 401 });
  }

  try {
    // 1. Find all quizzes that are scheduled to send, haven't been sent, and are due.
    const dueQuizzes = await prisma.quiz.findMany({
      where: {
        scheduledAt: { lte: new Date() },
        sentAt: null, // this defines it hasn't been sent yet
      },
      include: { group: true },
    });

    if (dueQuizzes.length === 0) {
      return NextResponse.json({ ok: true, processed: 0, message: "No pending quizzes." });
    }

    const processed = [];
    const errors = [];

    // 2. Process them concurrently (or sequentially if rate limits apply, let's do sequentially to be safe)
    for (const quiz of dueQuizzes) {
      try {
        const params: {
          chat_id: string;
          message_thread_id?: number;
          question: string;
          options: { text: string }[];
          type: "regular" | "quiz";
          is_anonymous: boolean;
          allows_multiple_answers: boolean;
          correct_option_id?: number;
          explanation?: string;
          open_period?: number;
        } = {
          chat_id: quiz.group.chatId,
          message_thread_id: quiz.topicId || undefined,
          question: quiz.question,
          options: quiz.options.map((t) => ({ text: t })),
          type: "regular",
          is_anonymous: quiz.isAnonymous,
          allows_multiple_answers: quiz.allowsMultiple,
          correct_option_id: quiz.correctOptionId ?? undefined,
          explanation: quiz.explanation || undefined,
          open_period: quiz.openPeriod || undefined,
        };

        if (quiz.type === "QUIZ") {
          params.type = "quiz";
        }

        const tgMessage = await telegram.sendPoll(params);

        // 3. Mark as sent in the database
        await prisma.quiz.update({
          where: { id: quiz.id },
          data: {
            pollId: tgMessage.poll?.id,
            messageId: tgMessage.message_id,
            sentAt: new Date(),
          },
        });

        processed.push(quiz.id);
      } catch (err) {
        console.error(`Cron Failed to send quiz ${quiz.id}:`, err);
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
    console.error("Cron Error Pipeline:", error);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}
