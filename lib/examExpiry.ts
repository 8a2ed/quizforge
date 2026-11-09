import { prisma, withRetry } from "@/lib/db";
import { telegram } from "@/lib/telegram";
import {
  mapStudentAnswersToMaster,
  type StudentExamQuestion,
} from "@/lib/examConfig";

function escapeHtml(s: string): string {
  return String(s || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

export interface ExamExpiryStats {
  checkedCount: number;
  expiredCount: number;
  warnedCount: number;
  activeCount: number;
  timestamp: string;
}

declare global {
  var __examSessions: Map<string, any> | undefined;
  var __examExpiryWatcherStarted: boolean | undefined;
}

export const examSessions: Map<string, any> = (globalThis.__examSessions ??= new Map());
export const sessionKey = (telegramId: string, examId: string) => `${telegramId}:${examId}`;

/**
 * Silence required to trigger inactivity warning: exactly 1 hour (60 minutes) from last interaction
 */
export const INACTIVITY_SILENCE_MS = 60 * 60 * 1000;

/**
 * Grace period given to the student after the 1-hour warning: 5 minutes
 */
export const INACTIVITY_GRACE_PERIOD_MS = 5 * 60 * 1000;

/**
 * Checks all in-progress exam sessions (score === -1):
 * 1. If overall elapsed time >= timeLimit, marks user as failed, sends 'Time is Over' to Telegram, and closes session.
 * 2. If user is inactive >= INACTIVITY_SILENCE_MS (1 hour), sends a warning message with an interactive resume button.
 * 3. If user remains inactive after warning for >= INACTIVITY_GRACE_PERIOD_MS (5 minutes), marks as failed with partial score.
 */
export async function checkAndExpireExamSessions(targetExamId?: string, targetGroupId?: string): Promise<ExamExpiryStats> {
  const stats: ExamExpiryStats = {
    checkedCount: 0,
    expiredCount: 0,
    warnedCount: 0,
    activeCount: 0,
    timestamp: new Date().toISOString(),
  };

  try {
    const inProgressList = await withRetry(() =>
      prisma.examResult.findMany({
        where: {
          score: -1,
          ...(targetExamId ? { examId: targetExamId } : {}),
          ...(targetGroupId ? { exam: { groupId: targetGroupId } } : {}),
        },
        include: { exam: true },
      })
    );

    stats.checkedCount = inProgressList.length;
    const now = Date.now();

    for (const record of inProgressList) {
      const exam = record.exam;
      if (!exam) continue;

      const rawData = (record.answers as Record<string, any>) || {};
      const startedAt = Number(rawData.startedAt) || record.completedAt?.getTime() || now;
      const lastActiveAt = Number(rawData.lastActiveAt) || startedAt;
      const warnedAt = rawData.warnedAt ? Number(rawData.warnedAt) : null;
      const chatId = Number(rawData.chatId) || (record.telegramId ? Number(record.telegramId) : null);
      const msgId = Number(rawData.msgId) || 0;

      const studentQuestions = (
        Array.isArray(rawData.questions) && rawData.questions.length > 0
          ? rawData.questions
          : Array.isArray(exam.questions)
          ? exam.questions
          : []
      ) as unknown as StudentExamQuestion[];

      const studentAnswers = (rawData.answers as Record<string, number>) || {};
      const timeLimitSeconds = exam.timeLimit ? Number(exam.timeLimit) : null;
      const passingScore = Number(exam.passingScore) || 60;
      const studentName = record.name || "طالب";
      const elapsedSeconds = Math.max(1, Math.floor((now - startedAt) / 1000));

      // ─── 1. Check if exam overall time is over ───────────────────────────
      if (timeLimitSeconds && elapsedSeconds >= timeLimitSeconds) {
        let correctCount = 0;
        for (let i = 0; i < studentQuestions.length; i++) {
          const chosen = studentAnswers[i] ?? studentAnswers[String(i)] ?? -1;
          if (chosen === studentQuestions[i].correctOptionId) {
            correctCount++;
          }
        }
        const totalQ = Math.max(1, studentQuestions.length);
        const finalScore = Math.round((correctCount / totalQ) * 100);
        const masterAnswers = mapStudentAnswersToMaster(studentQuestions, studentAnswers);

        // Mark as failed due to time over
        await withRetry(() =>
          prisma.examResult.update({
            where: { id: record.id },
            data: {
              score: finalScore,
              passed: false, // Explicitly marked as failed when time expires
              duration: timeLimitSeconds,
              answers: masterAnswers,
              completedAt: new Date(),
            },
          })
        );

        // Delete from in-memory session store
        if (record.telegramId) {
          examSessions.delete(sessionKey(record.telegramId, exam.id));
        }

        // Send Telegram notification
        if (chatId) {
          const timeOverText = [
            `⏰ <b>انتهى الوقت المحدد للاختبار! (Time is Over)</b>`,
            "",
            `عذراً <b>${escapeHtml(studentName)}</b>، لقد تجاوزت الوقت المخصص (${Math.floor(timeLimitSeconds / 60)} دقيقة) لاختبار:`,
            `📋 <b>${escapeHtml(exam.title)}</b>`,
            "",
            `❌ <b>النتيجة النهائية: راسب (انتهاء الوقت المحدد)</b>`,
            `📊 الدرجة المحققة: <b>${finalScore}%</b> (${correctCount}/${totalQ} إجابة صحيحة)`,
            `⏱ الحد الأدنى للنجاح: <b>${passingScore}%</b>`,
            "",
            `<i>تم إغلاق الاختبار تلقائياً واحتساب النتيجة بالرسوب لتجاوز الوقت قبل إكمال الإجابات.</i>`,
          ].join("\n");

          try {
            if (msgId) {
              await telegram.editMessageText({
                chat_id: chatId,
                message_id: msgId,
                text: timeOverText,
                parse_mode: "HTML",
                reply_markup: { inline_keyboard: [] },
              }).catch(async () => {
                await telegram.sendMessage({ chat_id: chatId, text: timeOverText, parse_mode: "HTML" });
              });
            } else {
              await telegram.sendMessage({ chat_id: chatId, text: timeOverText, parse_mode: "HTML" });
            }
          } catch (tgErr) {
            console.error("[examExpiry] Failed to send time-over telegram notice:", tgErr);
          }
        }

        stats.expiredCount++;
        continue;
      }

      // ─── 2. Inactivity Tracking (1-Hour Silence + 5-Minute Grace) ───────
      const inactiveMs = now - lastActiveAt;

      // Case 2A: User has been inactive for 1 hour and has NOT been warned yet
      if (inactiveMs >= INACTIVITY_SILENCE_MS && !warnedAt) {
        rawData.warnedAt = now;

        await withRetry(() =>
          prisma.examResult.update({
            where: { id: record.id },
            data: { answers: rawData },
          })
        );

        const memSession = record.telegramId ? examSessions.get(sessionKey(record.telegramId, exam.id)) : null;
        if (memSession) {
          memSession.warnedAt = now;
        }

        if (chatId) {
          const warnText = [
            `⚠️ <b>تنبيه عدم التفاعل: اختبار ${escapeHtml(exam.title)}</b>`,
            "",
            `مرحباً <b>${escapeHtml(studentName)}</b>، نلاحظ توقفك عن الإجابة في الاختبار لمدة <b>ساعة كاملة (60 دقيقة)</b>!`,
            "",
            `⏱ <b>لديك مهلة 5 دقائق</b> للضغط على زر متابعة الاختبار أدناه أو إرسال إجابة السؤال، وإلا سيتم إغلاق الاختبار تلقائياً واحتساب النتيجة بالرسوب ❌.`,
            "",
            `👉 <i>اضغط على الزر بالأسفل لتأكيد تواجدك ومتابعة الاختبار:</i>`,
          ].join("\n");

          await telegram.sendMessage({
            chat_id: chatId,
            text: warnText,
            parse_mode: "HTML",
            reply_markup: {
              inline_keyboard: [
                [
                  {
                    text: "▶️ متابعة الاختبار (أنا هنا)",
                    callback_data: `exam_resume:${exam.id}`,
                  },
                ],
              ],
            },
          }).catch((tgErr) => {
            console.error("[examExpiry] Failed to send inactive warning:", tgErr);
          });
        }

        stats.warnedCount++;
        stats.activeCount++;
        continue;
      }

      // Case 2B: User was already warned and the 5-minute grace period expired with no response
      if (warnedAt && now - warnedAt >= INACTIVITY_GRACE_PERIOD_MS) {
        let correctCount = 0;
        for (let i = 0; i < studentQuestions.length; i++) {
          const chosen = studentAnswers[i] ?? studentAnswers[String(i)] ?? -1;
          if (chosen === studentQuestions[i].correctOptionId) {
            correctCount++;
          }
        }
        const totalQ = Math.max(1, studentQuestions.length);
        const finalScore = Math.round((correctCount / totalQ) * 100);
        const masterAnswers = mapStudentAnswersToMaster(studentQuestions, studentAnswers);

        // Mark as failed due to inactivity
        await withRetry(() =>
          prisma.examResult.update({
            where: { id: record.id },
            data: {
              score: finalScore,
              passed: false,
              duration: elapsedSeconds,
              answers: masterAnswers,
              completedAt: new Date(),
            },
          })
        );

        if (record.telegramId) {
          examSessions.delete(sessionKey(record.telegramId, exam.id));
        }

        if (chatId) {
          const inactiveFailText = [
            `🛑 <b>انتهى الاختبار بسبب عدم التفاعل (Inactivity Timeout)</b>`,
            "",
            `عذراً <b>${escapeHtml(studentName)}</b>، تم إنهاء جلستك في اختبار:`,
            `📋 <b>${escapeHtml(exam.title)}</b>`,
            `نظراً لعدم التفاعل لمدة ساعة وتجاوز مهلة الـ 5 دقائق الإضافية دون استجابة.`,
            "",
            `❌ <b>النتيجة النهائية: راسب (عدم استجابة)</b>`,
            `📊 الدرجة المحتسبة للأسئلة المنجزة: <b>${finalScore}%</b> (${correctCount}/${totalQ} إجابة صحيحة)`,
            `⏱ الوقت المنقضي: <b>${Math.floor(elapsedSeconds / 60)}د ${elapsedSeconds % 60}ث</b>`,
            "",
            `<i>إذا واجهتك مشكلة تقنية، يرجى التواصل مع مشرف المادة لإعادة تعيين المحاولة.</i>`,
          ].join("\n");

          try {
            if (msgId) {
              await telegram.editMessageText({
                chat_id: chatId,
                message_id: msgId,
                text: inactiveFailText,
                parse_mode: "HTML",
                reply_markup: { inline_keyboard: [] },
              }).catch(async () => {
                await telegram.sendMessage({ chat_id: chatId, text: inactiveFailText, parse_mode: "HTML" });
              });
            } else {
              await telegram.sendMessage({ chat_id: chatId, text: inactiveFailText, parse_mode: "HTML" });
            }
          } catch (tgErr) {
            console.error("[examExpiry] Failed to send inactive telegram notice:", tgErr);
          }
        }

        stats.expiredCount++;
        continue;
      }
stats.activeCount++;
    }
  } catch (error) {
    console.error("[examExpiry] Error checking exam sessions:", error);
  }

  return stats;
}

/**
 * Starts a background periodic watcher in long-running Node.js environments.
 */
export function startExamExpiryWatcher(intervalMs = 30_000) {
  if (globalThis.__examExpiryWatcherStarted) return;
  globalThis.__examExpiryWatcherStarted = true;

  setInterval(() => {
    checkAndExpireExamSessions().catch((err) => {
      console.error("[examExpiryWatcher] Periodic check error:", err);
    });
  }, intervalMs);
}
