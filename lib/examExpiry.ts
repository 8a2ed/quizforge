import { prisma, withRetry } from "@/lib/db";
import { randomUUID } from "node:crypto";
import { telegram } from "@/lib/telegram";
import {
  mapStudentAnswersToMaster,
  type StudentExamQuestion,
} from "@/lib/examConfig";
import { isRecord } from "@/lib/http";

export interface ExamQuestion {
  question: string;
  options: string[];
  correctOptionId: number;
  explanation?: string;
  imageUrl?: string;
  originalQIndex?: number;
  originalOptionIndices?: number[];
}

export interface ExamSession {
  resultId?: string;
  examId: string;
  examTitle: string;
  chatId: number;
  msgId: number;
  name: string;
  telegramId: string;
  questions: ExamQuestion[];
  answers: Record<number, number>;
  currentQ: number;
  startedAt: number;
  lastActiveAt?: number;
  warnedAt?: number | null;
  timeLimit: number | null;
  passingScore: number;
  maxAttempts?: number;
  showSolutionsImmediately?: boolean;
  completedAttemptsBefore?: number;
}

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
  lockSkipped?: boolean;
}

const EXAM_EXPIRY_LOCK_PREFIX = "exam-expiry";
const EXAM_EXPIRY_LOCK_LEASE_MS = 3 * 60 * 1000;

async function acquireExamExpiryLock(lockName: string): Promise<string | null> {
  const ownerToken = randomUUID();
  const rows = await prisma.$queryRaw<Array<{ ownerToken: string }>>`
    INSERT INTO "scheduled_job_locks" ("name", "ownerToken", "leaseUntil")
    VALUES (${lockName}, ${ownerToken}, NOW() + (${EXAM_EXPIRY_LOCK_LEASE_MS} * INTERVAL '1 millisecond'))
    ON CONFLICT ("name") DO UPDATE
      SET "ownerToken" = EXCLUDED."ownerToken", "leaseUntil" = EXCLUDED."leaseUntil"
      WHERE "scheduled_job_locks"."leaseUntil" <= NOW()
    RETURNING "ownerToken"
  `;
  return rows[0]?.ownerToken ?? null;
}

async function releaseExamExpiryLock(lockName: string, ownerToken: string): Promise<void> {
  await prisma.$executeRaw`
    DELETE FROM "scheduled_job_locks"
    WHERE "name" = ${lockName} AND "ownerToken" = ${ownerToken}
  `;
}

declare global {
  var __examSessions: Map<string, ExamSession> | undefined;
  var __examExpiryWatcherStarted: boolean | undefined;
}

export const examSessions: Map<string, ExamSession> = (globalThis.__examSessions ??= new Map());
export const sessionKey = (telegramId: string, examId: string) => `${telegramId}:${examId}`;

/**
 * Checks all in-progress exam sessions (score === -1):
 * 1. If overall elapsed time >= timeLimit, marks user as failed, sends 'Time is Over' to Telegram, and closes session.
 * The Durable Object scheduler calls this at the exact deadline for an active
 * result. General scans remain available only as a recovery/administrative path.
 */
export async function checkAndExpireExamSessions(
  targetExamId?: string,
  targetGroupId?: string,
  targetResultId?: string
): Promise<ExamExpiryStats> {
  const stats: ExamExpiryStats = {
    checkedCount: 0,
    expiredCount: 0,
    warnedCount: 0,
    activeCount: 0,
    timestamp: new Date().toISOString(),
  };

  const lockName = `${EXAM_EXPIRY_LOCK_PREFIX}:${targetResultId || targetExamId || targetGroupId || "sweep"}`;
  const lockOwner = await acquireExamExpiryLock(lockName);
  if (!lockOwner) {
    return { ...stats, lockSkipped: true };
  }

  try {
    const inProgressList = await withRetry(() =>
      prisma.examResult.findMany({
        where: {
          score: -1,
          ...(targetResultId ? { id: targetResultId } : {}),
          ...(targetExamId ? { examId: targetExamId } : {}),
          ...(targetGroupId ? { exam: { groupId: targetGroupId } } : {}),
        },
        select: {
          id: true,
          name: true,
          telegramId: true,
          answers: true,
          completedAt: true,
          exam: {
            select: {
              id: true,
              title: true,
              questions: true,
              timeLimit: true,
              passingScore: true,
            },
          },
        },
      })
    );

    stats.checkedCount = inProgressList.length;
    const now = Date.now();

    for (const record of inProgressList) {
      const exam = record.exam;
      if (!exam) continue;

      const rawData = isRecord(record.answers) ? record.answers : {};
      const startedAtValue = Number(rawData.startedAt);
      const startedAt = Number.isFinite(startedAtValue) && startedAtValue > 0
        ? startedAtValue
        : record.completedAt?.getTime() || now;
      const chatValue = Number(rawData.chatId);
      const chatId = Number.isFinite(chatValue) && chatValue !== 0
        ? chatValue
        : (record.telegramId ? Number(record.telegramId) : null);
      const msgValue = Number(rawData.msgId);
      const msgId = Number.isFinite(msgValue) ? msgValue : 0;

      const studentQuestions = (
        Array.isArray(rawData.questions) && rawData.questions.length > 0
          ? rawData.questions
          : Array.isArray(exam.questions)
          ? exam.questions
          : []
      ) as unknown as StudentExamQuestion[];

      const studentAnswers = isRecord(rawData.answers)
        ? Object.fromEntries(Object.entries(rawData.answers).filter((entry): entry is [string, number] => typeof entry[1] === "number"))
        : {};
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
        const finalised = await withRetry(() =>
          prisma.examResult.updateMany({
            // Guarding score makes concurrent Telegram callbacks and alarm
            // delivery idempotent: exactly one caller can finalise a result.
            where: { id: record.id, score: -1 },
            data: {
              score: finalScore,
              passed: false, // Explicitly marked as failed when time expires
              duration: timeLimitSeconds,
              answers: masterAnswers,
              completedAt: new Date(),
            },
          })
        );

        if (finalised.count !== 1) continue;

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

stats.activeCount++;
    }
  } catch (error) {
    console.error("[examExpiry] Error checking exam sessions:", error);
  } finally {
    try {
      await releaseExamExpiryLock(lockName, lockOwner);
    } catch (error) {
      console.error("[examExpiry] Failed to release shared lock:", error);
    }
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
