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
    // 1. Fetch current anonymous answers for this quiz
    const existingAnswers = await withRetry(() =>
      prisma.pollAnswer.findMany({
        where: {
          quizId,
          telegramUserId: { startsWith: `anon_${quizId}_` },
        },
        select: { id: true, telegramUserId: true },
      })
    );

    const existingSet = new Set(existingAnswers.map((a) => a.telegramUserId));
    const neededKeys = new Set<string>();

    const toCreate: Array<{
      quizId: string;
      telegramUserId: string;
      firstName: string;
      username: null;
      optionIds: number[];
      answeredAt: Date;
    }> = [];

    // 2. Determine required records per option
    for (let optIdx = 0; optIdx < options.length; optIdx++) {
      const voterCount = options[optIdx].voter_count || 0;
      for (let voterNum = 1; voterNum <= voterCount; voterNum++) {
        const key = `anon_${quizId}_opt${optIdx}_${voterNum}`;
        neededKeys.add(key);

        if (!existingSet.has(key)) {
          toCreate.push({
            quizId,
            telegramUserId: key,
            firstName: "طالب (مجهول)",
            username: null,
            optionIds: [optIdx],
            answeredAt: new Date(),
          });
        }
      }
    }

    // 3. Find excess records to delete (e.g., if a vote was removed or revoted)
    const toDeleteIds = existingAnswers
      .filter((a) => !neededKeys.has(a.telegramUserId))
      .map((a) => a.id);

    if (toDeleteIds.length > 0) {
      await withRetry(() =>
        prisma.pollAnswer.deleteMany({
          where: { id: { in: toDeleteIds } },
        })
      ).catch((err) => console.error("[pollSync] Delete error:", err));
    }

    if (toCreate.length > 0) {
      await withRetry(() =>
        prisma.pollAnswer.createMany({
          data: toCreate,
          skipDuplicates: true,
        })
      ).catch((err) => console.error("[pollSync] Create error:", err));
    }
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
