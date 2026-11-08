import { prisma, withRetry } from "@/lib/db";
import { telegram } from "@/lib/telegram";

let tableEnsured = false;

/**
 * Ensures the `exam_feedbacks` table and its indexes exist in PostgreSQL.
 * Completely idempotent and safe across serverless instances.
 */
export async function ensureFeedbackTable() {
  if (tableEnsured) return;
  try {
    await prisma.$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS "exam_feedbacks" (
        "id" TEXT NOT NULL,
        "examId" TEXT NOT NULL,
        "groupId" TEXT,
        "telegramId" TEXT NOT NULL,
        "name" TEXT,
        "username" TEXT,
        "rating" INTEGER NOT NULL,
        "suggestion" TEXT,
        "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT "exam_feedbacks_pkey" PRIMARY KEY ("id")
      );
    `);

    await prisma.$executeRawUnsafe(`
      CREATE UNIQUE INDEX IF NOT EXISTS "exam_feedbacks_examId_telegramId_key" ON "exam_feedbacks"("examId", "telegramId");
    `);
    await prisma.$executeRawUnsafe(`
      CREATE INDEX IF NOT EXISTS "exam_feedbacks_examId_idx" ON "exam_feedbacks"("examId");
    `);
    await prisma.$executeRawUnsafe(`
      CREATE INDEX IF NOT EXISTS "exam_feedbacks_telegramId_idx" ON "exam_feedbacks"("telegramId");
    `);
    await prisma.$executeRawUnsafe(`
      CREATE INDEX IF NOT EXISTS "exam_feedbacks_groupId_idx" ON "exam_feedbacks"("groupId");
    `);
    await prisma.$executeRawUnsafe(`
      CREATE INDEX IF NOT EXISTS "exam_feedbacks_createdAt_idx" ON "exam_feedbacks"("createdAt");
    `);
    await prisma.$executeRawUnsafe(`
      CREATE INDEX IF NOT EXISTS "exam_feedbacks_rating_idx" ON "exam_feedbacks"("rating");
    `);

    tableEnsured = true;
  } catch (err) {
    console.error("[ensureFeedbackTable] error:", err);
  }
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

export interface NotifyFeedbackParams {
  examId: string;
  examTitle: string;
  groupTitle?: string;
  groupId?: string | null;
  studentName: string;
  username?: string | null;
  rating: number;
  suggestion?: string | null;
  teacherTelegramId?: string | null;
}

/**
 * Sends a real-time notification to the exam creator or group admins on Telegram.
 */
export async function notifyAdminsFeedback(params: NotifyFeedbackParams) {
  try {
    const stars = "⭐".repeat(Math.min(10, Math.max(1, params.rating)));
    const text = [
      `📢 <b>تقييم واقتراح جديد للاختبار!</b> 🎓`,
      ``,
      `📝 <b>الاختبار:</b> ${escapeHtml(params.examTitle)}`,
      params.groupTitle ? `👥 <b>المجموعة:</b> ${escapeHtml(params.groupTitle)}` : "",
      `👤 <b>الطالب:</b> <b>${escapeHtml(params.studentName)}</b>${params.username ? ` (@${escapeHtml(params.username)})` : ""}`,
      `⭐ <b>التقييم:</b> <b>${params.rating}/10</b> ${stars}`,
      params.suggestion
        ? `\n💡 <b>الاقتراح المكتوب:</b>\n<i>"${escapeHtml(params.suggestion)}"</i>`
        : `\n<i>(تقييم رقمي فقط بدون اقتراح كتابي)</i>`,
      ``,
      `🕒 <i>${new Date().toLocaleString("ar-EG", { timeZone: "Africa/Cairo" })}</i>`,
    ].filter(Boolean).join("\n");

    const notifiedTelegramIds = new Set<string>();

    // 1. Notify exam creator directly if they have telegramId
    if (params.teacherTelegramId) {
      notifiedTelegramIds.add(params.teacherTelegramId);
      await telegram.sendMessage({
        chat_id: params.teacherTelegramId,
        text,
        parse_mode: "HTML",
      }).catch(() => {});
    }

    // 2. Also notify group admins who have linked telegram accounts
    if (params.groupId) {
      const adminMembers = await withRetry(() => prisma.groupMember.findMany({
        where: {
          groupId: params.groupId!,
          role: { in: ["ADMIN", "OWNER"] },
          user: { telegramId: { not: null } },
        },
        include: { user: true },
        take: 3,
      })).catch(() => []);

      for (const m of adminMembers) {
        if (m.user?.telegramId && !notifiedTelegramIds.has(m.user.telegramId)) {
          notifiedTelegramIds.add(m.user.telegramId);
          await telegram.sendMessage({
            chat_id: m.user.telegramId,
            text,
            parse_mode: "HTML",
          }).catch(() => {});
        }
      }
    }
  } catch (err) {
    console.error("[notifyAdminsFeedback] error:", err);
  }
}
