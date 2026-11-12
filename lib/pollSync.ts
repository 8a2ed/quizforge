import { prisma, withRetry } from "@/lib/db";

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

/**
 * Synchronizes anonymous Telegram poll voter tallies into `poll_answers`.
 * This enables full analytics, option vote breakdown, and accurate pass rates
 * in QuizForge without exposing any real Telegram user identity.
 */
export async function syncAnonymousPollAnswers(
  quizId: string,
  options: Array<{ text: string; voter_count?: number }>,
  totalVoterCount: number
) {
  if (!quizId || !Array.isArray(options)) return;

  try {
    const optionCounts = options.map((option, optionId) => ({
      optionId,
      voterCount: Math.max(0, Math.floor(Number(option.voter_count) || 0)),
    }));
    const optionCountsJson = JSON.stringify(optionCounts);

    // Reconcile anonymous vote rows inside PostgreSQL. This avoids downloading
    // every synthetic voter ID and sending a potentially large createMany array
    // on each Telegram poll update. The unique key makes retries idempotent.
    await withRetry(() => prisma.$executeRaw`
      WITH option_counts AS (
        SELECT "optionId", "voterCount"
        FROM jsonb_to_recordset(${optionCountsJson}::jsonb)
          AS row_data("optionId" integer, "voterCount" integer)
      ),
      expected_answers AS (
        SELECT
          CONCAT('anon_', ${quizId}, '_opt', counts."optionId", '_', voter_num)::text AS telegram_user_id,
          counts."optionId" AS option_id
        FROM option_counts counts
        CROSS JOIN LATERAL generate_series(1, counts."voterCount") AS voter_num
      ),
      removed_answers AS (
        DELETE FROM "poll_answers" answer
        WHERE answer."quizId" = ${quizId}
          AND starts_with(answer."telegramUserId", CONCAT('anon_', ${quizId}, '_opt'))
          AND NOT EXISTS (
            SELECT 1 FROM expected_answers expected
            WHERE expected.telegram_user_id = answer."telegramUserId"
          )
        RETURNING 1
      )
      INSERT INTO "poll_answers" (
        "id", "optionIds", "answeredAt", "quizId", "telegramUserId", "firstName", "username"
      )
      SELECT
        gen_random_uuid()::text,
        ARRAY[expected.option_id],
        NOW(),
        ${quizId},
        expected.telegram_user_id,
        'طالب (مجهول)',
        NULL
      FROM expected_answers expected
      WHERE (SELECT COUNT(*) FROM removed_answers) >= 0
      ON CONFLICT ("quizId", "telegramUserId") DO NOTHING
    `);

    void totalVoterCount;
  } catch (error) {
    console.error("[pollSync] syncAnonymousPollAnswers error:", error);
  }
}

/**
 * Sends a polite, encouraging closure summary message to the Telegram group or forum thread.
 * Highlights the correct answer and explanation while protecting student privacy.
 */
export async function sendPollClosureSummary(
  quiz: {
    id: string;
    question: string;
    type: string;
    correctOptionId: number | null;
    explanation?: string | null;
    messageId?: number | null;
    topicId?: number | null;
    group: { chatId: string };
  },
  poll: {
    total_voter_count?: number;
    options?: Array<{ text: string; voter_count?: number }>;
  }
) {
  if (!BOT_TOKEN || !quiz.group?.chatId) return;

  const total = poll.total_voter_count || 0;
  const correctIdx = quiz.correctOptionId;
  let correctCount = 0;
  let correctText = "";

  if (
    correctIdx !== null &&
    correctIdx !== undefined &&
    poll.options &&
    poll.options[correctIdx]
  ) {
    correctCount = poll.options[correctIdx].voter_count || 0;
    correctText = poll.options[correctIdx].text;
  }

  const rate = total > 0 ? Math.round((correctCount / total) * 100) : 0;

  let text = `🏁 <b>انتهت فترة الإجابة على الكويز!</b>\n\n`;
  text += `❓ <b>السؤال:</b> ${escapeHtml(quiz.question)}\n\n`;
  text += `👥 <b>إجمالي المشاركين:</b> ${total} طالب (🔒 إجابات مجهولة الهوية)\n`;

  if (quiz.type === "QUIZ" && correctText) {
    text += `✅ <b>الإجابة الصحيحة:</b> ${escapeHtml(correctText)}\n`;
    text += `📈 <b>نسبة الإجابات الصحيحة:</b> ${rate}% (${correctCount} من ${total})\n`;
  }

  if (quiz.explanation && quiz.explanation.trim()) {
    text += `\n💡 <b>الشرح والتوضيح:</b>\n${escapeHtml(quiz.explanation.trim())}\n`;
  }

  text += `\n👏 <i>شكراً لكل من حاول وشارك! تم حفظ كافة الإحصائيات بسرية تامة دون كشف أسماء الطلاب.</i>`;

  try {
    await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: quiz.group.chatId,
        message_thread_id: quiz.topicId || undefined,
        reply_to_message_id: quiz.messageId || undefined,
        text,
        parse_mode: "HTML",
      }),
    });
  } catch (err) {
    console.error("[pollSync] sendPollClosureSummary error:", err);
  }
}
