import { prisma, withRetry } from "@/lib/db";
import { telegram, TelegramMessage } from "@/lib/telegram";
import {
  getAllCurriculumMaterials,
  getMaterialById,
  getGroupAISettings,
  CurriculumMaterial,
  recordGenerationLog,
} from "@/lib/aiStorage";
import { generateCurriculumQuestions } from "@/lib/gemini";
import { ValidatedQuestion } from "@/lib/questionValidator";

// ─── Rate Limiting & Cooldown Configuration ───────────────────────────────────
// 90 seconds cooldown between consecutive quiz generations per student
// 45 seconds cooldown between consecutive quiz generations per student for smoother learning
const GENERATION_COOLDOWN_SECONDS = 45;
// Maximum 12 generations per user per 60 minutes
const MAX_GENERATIONS_PER_HOUR = 12;
// Wizard session expiration: 10 minutes
const SESSION_TTL_MS = 10 * 60 * 1000;

export interface StudentQuizSession {
  userId: string;
  userName: string;
  userUsername?: string;
  userPhoto?: string;
  chatId: number | string;
  messageThreadId?: number;
  messageId?: number;
  groupId?: string;
  groupTitle?: string;
  step: "material" | "count" | "difficulty" | "section" | "generating";
  materialId?: string;
  materialTitle?: string;
  questionCount?: number;
  difficulty?: "mixed" | "easy" | "medium" | "hard";
  sectionId?: string;
  sectionTitle?: string;
  sectionPage?: number;
  materialPage?: number;
  isBoost?: boolean;
  createdAt: number;
  updatedAt: number;
}

declare global {
  var __studentQuizSessions: Map<string, StudentQuizSession> | undefined;
  var __studentRateLimits: Map<string, { lastGeneratedAt: number; history: number[] }> | undefined;
}

const quizSessions: Map<string, StudentQuizSession> =
  (globalThis.__studentQuizSessions ??= new Map());

const rateLimits: Map<string, { lastGeneratedAt: number; history: number[] }> =
  (globalThis.__studentRateLimits ??= new Map());

function getSessionKey(userId: string, chatId: number | string): string {
  return `${userId}:${chatId}`;
}

function escapeHtml(s: string): string {
  return String(s || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function truncateText(s: string, maxLen: number): string {
  if (!s) return "";
  return s.length > maxLen ? `${s.substring(0, maxLen - 1)}…` : s;
}

/**
 * Formats question explanation ensuring strict adherence to Telegram's 200-char explanation limit
 * and appends citation / source reference if available and not already present.
 */
export function formatExplanationWithCitation(
  rawExplanation?: string,
  topic?: string,
  sectionTitle?: string
): string | undefined {
  let baseText = (rawExplanation || "").trim();
  const citationCandidate = (topic || sectionTitle || "").trim();
  const hasCitationTag = /\[(?:المرجع|المصدر|مرجع|مصدر):/i.test(baseText);

  if (citationCandidate && !hasCitationTag) {
    const cleanCitation = truncateText(citationCandidate, 60);
    const citationTag = ` 📍 [المرجع: ${cleanCitation}]`;

    if (baseText) {
      const allowedBaseLength = 195 - citationTag.length;
      if (allowedBaseLength >= 25) {
        if (baseText.length > allowedBaseLength) {
          baseText = truncateText(baseText, allowedBaseLength);
        }
        baseText = `${baseText}${citationTag}`.trim();
      } else {
        baseText = truncateText(baseText, 195);
      }
    } else {
      baseText = truncateText(citationTag.trim(), 195);
    }
  } else if (baseText) {
    baseText = truncateText(baseText, 195);
  }

  return baseText.length > 0 ? baseText : undefined;
}

/**
 * Checks if a user is within the allowed rate limits.
 */
function checkUserRateLimit(userId: string): {
  allowed: boolean;
  remainingCooldownSeconds?: number;
  hourlyLimitReached?: boolean;
} {
  const now = Date.now();
  const record = rateLimits.get(userId);
  if (!record) return { allowed: true };

  // 1. Cooldown check
  const elapsedCooldown = (now - record.lastGeneratedAt) / 1000;
  if (elapsedCooldown < GENERATION_COOLDOWN_SECONDS) {
    const remaining = Math.ceil(GENERATION_COOLDOWN_SECONDS - elapsedCooldown);
    return { allowed: false, remainingCooldownSeconds: remaining };
  }

  // 2. Hourly frequency check
  const oneHourAgo = now - 60 * 60 * 1000;
  const recentHistory = record.history.filter((t) => t > oneHourAgo);
  record.history = recentHistory;

  if (recentHistory.length >= MAX_GENERATIONS_PER_HOUR) {
    return { allowed: false, hourlyLimitReached: true };
  }

  return { allowed: true };
}

function recordUserGeneration(userId: string): void {
  const now = Date.now();
  const record = rateLimits.get(userId) || { lastGeneratedAt: 0, history: [] };
  record.lastGeneratedAt = now;
  record.history.push(now);
  rateLimits.set(userId, record);
}

/**
 * Periodically cleans up expired wizard sessions from memory.
 */
export function cleanupExpiredSessions(): void {
  const now = Date.now();
  for (const [key, sess] of quizSessions.entries()) {
    if (now - sess.updatedAt > SESSION_TTL_MS) {
      quizSessions.delete(key);
    }
  }
}

/**
 * Parses user arguments from /boost or /qs command (e.g. /boost 10 hard physics).
 */
export function parseQuizCommandArgs(rawArgs?: string): {
  parsedCount?: number;
  parsedDifficulty?: "mixed" | "easy" | "medium" | "hard";
  searchKeyword?: string;
} {
  if (!rawArgs || !rawArgs.trim()) return {};

  const clean = rawArgs.trim();
  let parsedCount: number | undefined;
  let parsedDifficulty: "mixed" | "easy" | "medium" | "hard" | undefined;

  // Check for number of questions (1 to 20)
  const countMatch = clean.match(/\b([1-9]|1[0-9]|20)\b/);
  if (countMatch) {
    const num = parseInt(countMatch[1], 10);
    if (num >= 1 && num <= 20) {
      parsedCount = num;
    }
  }

  // Check for difficulty keywords
  if (/(?:سهل|بسيط|مباشر|easy)/i.test(clean)) {
    parsedDifficulty = "easy";
  } else if (/(?:صعب|متقدم|تحدي|hard|advanced)/i.test(clean)) {
    parsedDifficulty = "hard";
  } else if (/(?:متوسط|متوازن|medium|mixed)/i.test(clean)) {
    parsedDifficulty = /(?:متوسط|medium)/i.test(clean) ? "medium" : "mixed";
  }

  // Any remaining text is candidate for material or topic search
  const remaining = clean
    .replace(/\b([1-9]|1[0-9]|20)\b/g, "")
    .replace(/(?:سهل|بسيط|مباشر|easy|صعب|متقدم|تحدي|hard|advanced|متوسط|متوازن|medium|mixed)/gi, "")
    .trim();

  return {
    parsedCount,
    parsedDifficulty,
    searchKeyword: remaining.length >= 2 ? remaining : undefined,
  };
}

/**
 * Builds a balanced, representative excerpt from the curriculum material.
 * If the material is large, samples across sections or chapters to ensure comprehensive question coverage
 * while keeping token latency low (3-5s response time).
 */
export function buildBalancedCurriculumExcerpt(
  material: CurriculumMaterial,
  sectionId?: string,
  maxChars: number = 36000
): { excerpt: string; title: string } {
  // If a specific section is chosen, return its content
  if (sectionId && sectionId !== "all" && material.sections && material.sections.length > 0) {
    const sec = material.sections.find((s) => s.id === sectionId);
    if (sec && sec.content && sec.content.trim()) {
      const trimmed = sec.content.length > maxChars ? sec.content.slice(0, maxChars) : sec.content;
      return {
        excerpt: trimmed,
        title: `${material.title} (${sec.title})`,
      };
    }
  }

  // If "all" (whole curriculum) is selected:
  const rawCleaned = material.cleanedText || "";

  // If text is within reasonable size, return directly
  if (rawCleaned.length <= maxChars) {
    return {
      excerpt: rawCleaned,
      title: material.title,
    };
  }

  // If material has multiple sections, sample evenly across all sections
  if (material.sections && material.sections.length > 1) {
    const sectionsCount = material.sections.length;
    const perSectionChars = Math.max(800, Math.floor(maxChars / sectionsCount));
    const sampledParts: string[] = [];

    for (const sec of material.sections) {
      if (!sec.content || !sec.content.trim()) continue;
      const snippet = sec.content.slice(0, perSectionChars).trim();
      sampledParts.push(`### ${sec.title}\n${snippet}`);
    }

    const combined = sampledParts.join("\n\n");
    if (combined.length >= 100) {
      return {
        excerpt: combined,
        title: material.title,
      };
    }
  }

  // Fallback: take beginning, middle, and end chunks
  const third = Math.floor(maxChars / 3);
  const beginning = rawCleaned.slice(0, third);
  const midStart = Math.floor((rawCleaned.length - third) / 2);
  const middle = rawCleaned.slice(midStart, midStart + third);
  const end = rawCleaned.slice(rawCleaned.length - third);

  return {
    excerpt: `${beginning}\n\n[...مقتطف من منتصف المنهج...]\n\n${middle}\n\n[...مقتطف من خاتمة المنهج...]\n\n${end}`,
    title: material.title,
  };
}

/**
 * Sends a high-priority alert to the group admins and bot owner when Gemini quota is exhausted.
 */
async function notifyAdminsOfQuotaExhaustion(params: {
  groupId?: string;
  chatId: number | string;
  groupTitle?: string;
  studentName: string;
  studentId: string;
  errorMessage: string;
}): Promise<void> {
  const { groupId, groupTitle, studentName, errorMessage } = params;

  const alertMessage =
    `🚨 <b>تنبيه عاجل من QuizForge: نفاد كوتا الذكاء الاصطناعي (Gemini Quota Exceeded)</b>\n\n` +
    `⚠️ تم استنفاد حصة التوليد اليومية المجانية أثناء محاولة الطالب <b>${escapeHtml(studentName)}</b> ` +
    `طلب كويز عبر أمر <code>/qs</code> في ${groupTitle ? `<b>${escapeHtml(groupTitle)}</b>` : "المحادثة الخاصة"}.\n\n` +
    `📌 <b>تفاصيل الخطأ:</b>\n<code>${escapeHtml(truncateText(errorMessage, 200))}</code>\n\n` +
    `💡 <b>الحل المطلوب:</b>\n` +
    `• افتح لوحة التحكم > إعدادات الذكاء الاصطناعي لتحديث مفتاح Google Gemini API Key بمفتاح جديد.\n` +
    `• أو انتظر تجديد الكوتا اليومية من Google AI Studio.\n\n` +
    `<i>تم إيقاف طلبات التوليد مؤقتاً لحماية النظام وتنبيه الإدارة.</i>`;

  try {
    if (groupId) {
      const admins = await withRetry(() =>
        prisma.groupMember.findMany({
          where: {
            groupId,
            role: { in: ["OWNER", "ADMIN"] },
          },
          include: { user: true },
        })
      );

      for (const admin of admins) {
        if (admin.user?.telegramId) {
          await telegram.sendMessage({
            chat_id: admin.user.telegramId,
            text: alertMessage,
            parse_mode: "HTML",
          }).catch(() => {});
        }
      }
    }
  } catch (err) {
    console.warn("[StudentQuizWizard] Failed to notify admins of quota exhaustion:", err);
  }
}

// ─── Step Renderers ───────────────────────────────────────────────────────────

export const MATERIALS_PER_PAGE = 6;

export function getMaterialKeyboard(
  materials: CurriculumMaterial[],
  page: number = 0,
  isBoost: boolean = false
): Array<Array<{ text: string; callback_data: string }>> {
  const keyboard: Array<Array<{ text: string; callback_data: string }>> = [];

  // If turbo boost mode and materials exist, offer an instant quick start button at the very top!
  if (isBoost && materials.length > 0) {
    keyboard.push([
      { text: "⚡ كويز سريع فوري (5 أسئلة متوازنة)", callback_data: `qs_quick:${materials[0].id}` },
    ]);
  }

  const totalPages = Math.max(1, Math.ceil(materials.length / MATERIALS_PER_PAGE));
  const currentPage = Math.max(0, Math.min(page, totalPages - 1));
  const start = currentPage * MATERIALS_PER_PAGE;
  const slice = materials.slice(start, start + MATERIALS_PER_PAGE);

  // Group materials 1 or 2 per row
  for (let i = 0; i < slice.length; i += 2) {
    const row: Array<{ text: string; callback_data: string }> = [];
    const m1 = slice[i];
    row.push({
      text: `📚 ${truncateText(m1.title, 26)}`,
      callback_data: `qs_mat:${m1.id}`,
    });
    if (i + 1 < slice.length) {
      const m2 = slice[i + 1];
      row.push({
        text: `📚 ${truncateText(m2.title, 26)}`,
        callback_data: `qs_mat:${m2.id}`,
      });
    }
    keyboard.push(row);
  }

  // Pagination navigation row if multiple pages exist
  if (totalPages > 1) {
    const navRow: Array<{ text: string; callback_data: string }> = [];
    if (currentPage > 0) {
      navRow.push({ text: "◀️ السابق", callback_data: `qs_mat_p:${currentPage - 1}` });
    }
    navRow.push({ text: `📄 ${currentPage + 1}/${totalPages}`, callback_data: "qs_mat_noop" });
    if (currentPage < totalPages - 1) {
      navRow.push({ text: "التالي ▶️", callback_data: `qs_mat_p:${currentPage + 1}` });
    }
    keyboard.push(navRow);
  }

  // Cancel row
  keyboard.push([{ text: "❌ إلغاء الطلب", callback_data: "qs_cancel" }]);
  return keyboard;
}

function getCountKeyboard(defaultCount = 5): Array<Array<{ text: string; callback_data: string }>> {
  const counts = [3, 5, 10];
  if (!counts.includes(defaultCount) && defaultCount > 0 && defaultCount <= 20) {
    counts.push(defaultCount);
    counts.sort((a, b) => a - b);
  }
  const buttons = counts.map((cnt) => ({
    text: cnt === defaultCount
      ? `🎯 ${cnt} أسئلة (موصى به)`
      : cnt === 3
      ? `⚡ 3 أسئلة (سريع)`
      : cnt === 10
      ? `📝 10 أسئلة (شامل)`
      : `📄 ${cnt} أسئلة`,
    callback_data: `qs_cnt:${cnt}`,
  }));

  const rows: Array<Array<{ text: string; callback_data: string }>> = [];
  for (let i = 0; i < buttons.length; i += 2) {
    rows.push(buttons.slice(i, i + 2));
  }
  rows.push([
    { text: "🔙 رجوع للمواد", callback_data: "qs_back:material" },
    { text: "❌ إلغاء", callback_data: "qs_cancel" },
  ]);
  return rows;
}

function getDifficultyKeyboard(defaultDifficulty = "mixed"): Array<Array<{ text: string; callback_data: string }>> {
  const isMixed = defaultDifficulty === "mixed";
  const isEasy = defaultDifficulty === "easy";
  const isMedium = defaultDifficulty === "medium";
  const isHard = defaultDifficulty === "hard";

  return [
    [
      { text: `⚖️ متوازن (شامل وتدريجي)${isMixed ? " ★" : ""}`, callback_data: "qs_dif:mixed" },
    ],
    [
      { text: `🟢 مباشر وسهل (تذكر ومفاهيم)${isEasy ? " ★" : ""}`, callback_data: "qs_dif:easy" },
      { text: `🟡 متوسط (فهم وتطبيق)${isMedium ? " ★" : ""}`, callback_data: "qs_dif:medium" },
    ],
    [
      { text: `🔴 متقدم (تحليل ومهارات عليا)${isHard ? " ★" : ""}`, callback_data: "qs_dif:hard" },
    ],
    [
      { text: "🔙 رجوع", callback_data: "qs_back:count" },
      { text: "❌ إلغاء", callback_data: "qs_cancel" },
    ],
  ];
}

export const SECTIONS_PER_PAGE = 6;

export function getSectionKeyboard(
  sections: Array<{ id: string; title: string }>,
  page: number = 0
): Array<Array<{ text: string; callback_data: string }>> {
  const keyboard: Array<Array<{ text: string; callback_data: string }>> = [
    [{ text: "📖 كامل المنهج / الكتاب", callback_data: "qs_sec:all" }],
  ];

  const totalPages = Math.max(1, Math.ceil(sections.length / SECTIONS_PER_PAGE));
  const currentPage = Math.max(0, Math.min(page, totalPages - 1));
  const start = currentPage * SECTIONS_PER_PAGE;
  const slice = sections.slice(start, start + SECTIONS_PER_PAGE);

  for (let i = 0; i < slice.length; i += 2) {
    const row: Array<{ text: string; callback_data: string }> = [];
    row.push({
      text: `📑 ${truncateText(slice[i].title, 22)}`,
      callback_data: `qs_sec:${slice[i].id}`,
    });
    if (i + 1 < slice.length) {
      row.push({
        text: `📑 ${truncateText(slice[i + 1].title, 22)}`,
        callback_data: `qs_sec:${slice[i + 1].id}`,
      });
    }
    keyboard.push(row);
  }

  // Pagination navigation row if multiple pages exist
  if (totalPages > 1) {
    const navRow: Array<{ text: string; callback_data: string }> = [];
    if (currentPage > 0) {
      navRow.push({ text: "◀️ السابق", callback_data: `qs_sec_p:${currentPage - 1}` });
    }
    navRow.push({ text: `📄 ${currentPage + 1}/${totalPages}`, callback_data: "qs_sec_noop" });
    if (currentPage < totalPages - 1) {
      navRow.push({ text: "التالي ▶️", callback_data: `qs_sec_p:${currentPage + 1}` });
    }
    keyboard.push(navRow);
  }

  keyboard.push([
    { text: "🔙 رجوع", callback_data: "qs_back:difficulty" },
    { text: "❌ إلغاء", callback_data: "qs_cancel" },
  ]);
  return keyboard;
}

const DIFFICULTY_NAMES: Record<string, string> = {
  mixed: "متوازن (مزيج تعليمي متدرج ⚖️)",
  easy: "مباشر وسهل (تذكر ومفاهيم 🟢)",
  medium: "متوسط (فهم وتطبيق 🟡)",
  hard: "متقدم (تحليل وتفكير نقدي 🔴)",
};

// ─── Command Entry Point: /qs & /boost ─────────────────────────────────────────

export interface StudentQuizCommandParams {
  chatId: number | string;
  userId: string;
  userName: string;
  userUsername?: string;
  userPhoto?: string;
  messageId: number;
  messageThreadId?: number;
  groupId?: string;
  groupTitle?: string;
  commandName?: string;
  rawArgs?: string;
}

export async function handleStudentQuizCommand(params: StudentQuizCommandParams): Promise<void> {
  const {
    chatId,
    userId,
    userName,
    userUsername,
    userPhoto,
    messageId,
    messageThreadId,
    groupId,
    groupTitle,
    commandName,
    rawArgs,
  } = params;

  // 0. Periodic cleanup of expired sessions
  cleanupExpiredSessions();

  // 1. Check Rate Limit
  const limitCheck = checkUserRateLimit(userId);
  if (!limitCheck.allowed) {
    if (limitCheck.hourlyLimitReached) {
      await telegram.sendMessage({
        chat_id: chatId,
        message_thread_id: messageThreadId,
        reply_to_message_id: messageId,
        text:
          `⏳ <b>تم بلوغ الحد الأقصى للطلبات في هذه الساعة:</b>\n\n` +
          `عزيزي <b>${escapeHtml(userName)}</b>، يمكنك إنشاء حتى ${MAX_GENERATIONS_PER_HOUR} كويزات كل ساعة للحفاظ على استقرار وسرعة البوت لجميع زملائك.\n` +
          `يرجى المحاولة بعد قليل أو مراجعة الأسئلة السابقة 🎯`,
        parse_mode: "HTML",
      });
      return;
    }

    await telegram.sendMessage({
      chat_id: chatId,
      message_thread_id: messageThreadId,
      reply_to_message_id: messageId,
      text:
        `⏳ <b>مهلة تهدئة الطلبات:</b>\n\n` +
        `يرجى الانتظار <b>${limitCheck.remainingCooldownSeconds} ثانية</b> قبل طلب كويز جديد للحفاظ على كفاءة وجودة التوليد بالذكاء الاصطناعي 🤖\n` +
        `<i>💡 يمكنك مراجعة الكويز السابق وقراءة شروحات الإجابات لحين انتهاء الثواني.</i>`,
      parse_mode: "HTML",
    });
    return;
  }

  // 2. Check if user already has an active generating session
  const sKey = getSessionKey(userId, chatId);
  const existing = quizSessions.get(sKey);
  if (existing && existing.step === "generating" && Date.now() - existing.updatedAt < 90_000) {
    await telegram.sendMessage({
      chat_id: chatId,
      message_thread_id: messageThreadId,
      reply_to_message_id: messageId,
      text: `⚠️ <b>لديك كويز قيد الإنشاء حالياً:</b>\nيرجى الانتظار ثوانٍ معدودة حتى تكتمل الأسئلة الحالية.`,
      parse_mode: "HTML",
    });
    return;
  }

  // 3. Load available materials
  const materials = await getAllCurriculumMaterials(groupId);
  if (!materials || materials.length === 0) {
    await telegram.sendMessage({
      chat_id: chatId,
      message_thread_id: messageThreadId,
      reply_to_message_id: messageId,
      text:
        `📚 <b>لا توجد مناهج أو كتب دراسية متوفرة حالياً:</b>\n\n` +
        `يرجى من معلم أو مشرف المجموعة إضافة المواد والكتب الدراسية عبر لوحة التحكم أولاً لتفعيل التوليد الذكي.`,
      parse_mode: "HTML",
    });
    return;
  }

  // 4. Parse command arguments and detect Turbo Boost mode
  const isBoost = commandName === "boost" || (rawArgs && /boost/i.test(rawArgs)) || false;
  const { parsedCount, parsedDifficulty, searchKeyword } = parseQuizCommandArgs(rawArgs);

  // Check if keyword matches a material in this group
  let matchedMaterial = searchKeyword
    ? materials.find(
        (m) =>
          m.title.toLowerCase().includes(searchKeyword.toLowerCase()) ||
          (m.subject && m.subject.toLowerCase().includes(searchKeyword.toLowerCase()))
      )
    : undefined;

  // If only 1 material exists in the whole group, auto-bind to it
  if (!matchedMaterial && materials.length === 1) {
    matchedMaterial = materials[0];
  }

  // 5. Initialize or reset session
  const session: StudentQuizSession = {
    userId,
    userName,
    userUsername,
    userPhoto,
    chatId,
    messageThreadId,
    groupId,
    groupTitle,
    step: "material",
    materialId: matchedMaterial?.id,
    materialTitle: matchedMaterial?.title,
    questionCount: parsedCount,
    difficulty: parsedDifficulty,
    materialPage: 0,
    isBoost,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };

  const aiSettings = await getGroupAISettings(groupId || "global");

  // Shortcut 1: If material was matched and user provided count & difficulty in command arguments
  if (matchedMaterial && parsedCount && parsedDifficulty) {
    const sections = matchedMaterial.sections || [];
    if (sections.length > 1) {
      session.step = "section";
      session.sectionPage = 0;
      const sent = await telegram.sendMessage({
        chat_id: chatId,
        message_thread_id: messageThreadId,
        reply_to_message_id: messageId,
        text:
          `🎓 <b>${isBoost ? "الدفعة الذكية (Turbo Boost)" : "مولد الكويزات الذكي"}</b>\n\n` +
          `📚 <b>المادة:</b> ${escapeHtml(matchedMaterial.title)}\n` +
          `🔢 <b>العدد:</b> ${parsedCount} أسئلة\n` +
          `🎯 <b>الصعوبة:</b> ${DIFFICULTY_NAMES[parsedDifficulty] || parsedDifficulty}\n\n` +
          `📑 <b>حدد الجزئية أو الفصل المطلوب لبدء الاختبار:</b>`,
        parse_mode: "HTML",
        reply_markup: { inline_keyboard: getSectionKeyboard(sections, 0) },
      });
      session.messageId = sent.message_id;
      quizSessions.set(sKey, session);
      return;
    }

    // Material has single/no sections -> Start Generation immediately!
    session.sectionId = "all";
    session.sectionTitle = "كامل المنهج / الكتاب";
    const sent = await telegram.sendMessage({
      chat_id: chatId,
      message_thread_id: messageThreadId,
      reply_to_message_id: messageId,
      text: `⏳ <i>جاري إطلاق الكويز الفوري المباشر...</i>`,
      parse_mode: "HTML",
    });
    session.messageId = sent.message_id;
    quizSessions.set(sKey, session);
    await executeGeneration(session, sent.message_id, "");
    return;
  }

  // Shortcut 2: Material was matched, but count or difficulty is missing
  if (matchedMaterial) {
    if (!parsedCount) {
      session.step = "count";
      const sent = await telegram.sendMessage({
        chat_id: chatId,
        message_thread_id: messageThreadId,
        reply_to_message_id: messageId,
        text:
          `🎓 <b>${isBoost ? "الدفعة الذكية (Turbo Boost)" : "مولد الكويزات الذكي"}</b>\n\n` +
          `📚 <b>المادة المختارة:</b> ${escapeHtml(matchedMaterial.title)}\n` +
          `📖 <b>الموضوع:</b> ${escapeHtml(matchedMaterial.subject || "عام")}\n\n` +
          `🔢 <b>الخطوة 2: كم عدد الأسئلة التي تريد اختبار نفسك بها؟</b>`,
        parse_mode: "HTML",
        reply_markup: { inline_keyboard: getCountKeyboard(aiSettings.defaultCount) },
      });
      session.messageId = sent.message_id;
      quizSessions.set(sKey, session);
      return;
    }

    if (!parsedDifficulty) {
      session.step = "difficulty";
      const sent = await telegram.sendMessage({
        chat_id: chatId,
        message_thread_id: messageThreadId,
        reply_to_message_id: messageId,
        text:
          `🎓 <b>${isBoost ? "الدفعة الذكية (Turbo Boost)" : "مولد الكويزات الذكي"}</b>\n\n` +
          `📚 <b>المادة:</b> ${escapeHtml(matchedMaterial.title)}\n` +
          `🔢 <b>العدد:</b> ${parsedCount} أسئلة\n\n` +
          `🎯 <b>الخطوة 3: اختر مستوى الصعوبة الأكاديمي:</b>`,
        parse_mode: "HTML",
        reply_markup: { inline_keyboard: getDifficultyKeyboard(aiSettings.defaultDifficulty) },
      });
      session.messageId = sent.message_id;
      quizSessions.set(sKey, session);
      return;
    }
  }

  // Standard Entry: Step 1 Material Selection (with Turbo Boost if isBoost)
  const headerText = isBoost
    ? `🚀 <b>الدفعة الذكية السريعة (QuizForge Turbo Boost)</b>\n\n` +
      `مرحباً <b>${escapeHtml(userName)}</b> ⚡\n` +
      `اضغط على <b>كويز سريع فوري</b> للبدء فوراً بأحدث مادة، أو اختر مادة محددة للتخصيص:`
    : `🎓 <b>مولد الكويزات الذكي (QuizForge AI)</b>\n\n` +
      `مرحباً <b>${escapeHtml(userName)}</b> 👋\n` +
      `📚 <b>الخطوة 1: اختر المادة الدراسية أو الكتاب:</b>\n\n` +
      `حدد المنهج الذي ترغب في توليد كويز فوري ومخصص له:`;

  const sent = await telegram.sendMessage({
    chat_id: chatId,
    message_thread_id: messageThreadId,
    reply_to_message_id: messageId,
    text: headerText,
    parse_mode: "HTML",
    reply_markup: {
      inline_keyboard: getMaterialKeyboard(materials, 0, isBoost),
    },
  });

  session.messageId = sent.message_id;
  quizSessions.set(sKey, session);
}

// ─── Callback Query Handler ───────────────────────────────────────────────────

export async function handleStudentQuizCallback(cb: Record<string, unknown>): Promise<boolean> {
  const data = (cb.data as string) || "";
  if (!data.startsWith("qs_")) return false;

  const cbId = cb.id as string;
  const user = cb.from as { id: number; first_name?: string; username?: string };
  const userId = String(user.id);
  const msg = cb.message as { chat: { id: number }; message_id: number; message_thread_id?: number };
  const chatId = msg?.chat?.id;

  if (!chatId) {
    await telegram.answerCallbackQuery(cbId, "Invalid request", true);
    return true;
  }

  const sKey = getSessionKey(userId, chatId);
  const session = quizSessions.get(sKey);

  // Ownership verification: ensure only the student who initiated /qs or /boost can click
  if (!session || session.userId !== userId) {
    await telegram.answerCallbackQuery(
      cbId,
      "⛔ هذا الكويز مخصص للطالب الذي طلبه فقط. اكتب /qs أو /boost لبدء كويز خاص بك.",
      true
    );
    return true;
  }

  // Concurrency & double-click guard during active generation
  if (session.step === "generating") {
    await telegram.answerCallbackQuery(
      cbId,
      "⏳ جاري تجهيز وتوليد الكويز بالفعل، لحظات قليلة...",
      true
    );
    return true;
  }

  // Session TTL check
  if (Date.now() - session.updatedAt > SESSION_TTL_MS) {
    quizSessions.delete(sKey);
    await telegram.answerCallbackQuery(cbId, "⏰ انتهت مهلة الجلسة. اكتب /qs أو /boost للبدء من جديد.", true);
    try {
      await telegram.editMessageText({
        chat_id: chatId,
        message_id: msg.message_id,
        text: "⏰ <i>انتهت مهلة الجلسة لعدم التفاعل. اكتب <code>/qs</code> أو <code>/boost</code> للبدء مجدداً.</i>",
        parse_mode: "HTML",
        reply_markup: { inline_keyboard: [] },
      }).catch(() => {});
    } catch {}
    return true;
  }

  session.updatedAt = Date.now();

  // ── Action: Cancel ──
  if (data === "qs_cancel") {
    quizSessions.delete(sKey);
    await telegram.answerCallbackQuery(cbId, "تم إلغاء الكويز");
    try {
      await telegram.editMessageText({
        chat_id: chatId,
        message_id: msg.message_id,
        text: `❌ <i>تم إلغاء طلب الكويز الذكي بواسطة الطالب <b>${escapeHtml(session.userName)}</b>.</i>`,
        parse_mode: "HTML",
        reply_markup: { inline_keyboard: [] },
      });
    } catch {}
    return true;
  }

  // ── Action: Back buttons ──
  if (data.startsWith("qs_back:")) {
    const to = data.slice("qs_back:".length);
    await telegram.answerCallbackQuery(cbId);

    if (to === "material") {
      session.step = "material";
      const materials = await getAllCurriculumMaterials(session.groupId);
      await telegram.editMessageText({
        chat_id: chatId,
        message_id: msg.message_id,
        text: session.isBoost
          ? `🚀 <b>الدفعة الذكية (QuizForge Turbo Boost)</b>\n\nاختر مادة أو اضغط <b>كويز سريع فوري</b>:`
          : `🎓 <b>مولد الكويزات الذكي (QuizForge AI)</b>\n\n📚 <b>الخطوة 1: اختر المادة الدراسية أو الكتاب:</b>\n\nحدد المنهج الذي ترغب في توليد كويز فوري له:`,
        parse_mode: "HTML",
        reply_markup: { inline_keyboard: getMaterialKeyboard(materials, session.materialPage || 0, session.isBoost || false) },
      });
      return true;
    }

    if (to === "count") {
      session.step = "count";
      const aiSettings = await getGroupAISettings(session.groupId || "global");
      await telegram.editMessageText({
        chat_id: chatId,
        message_id: msg.message_id,
        text:
          `🎓 <b>مولد الكويزات الذكي (QuizForge AI)</b>\n\n` +
          `📚 <b>المادة المختارة:</b> ${escapeHtml(session.materialTitle || "")}\n\n` +
          `🔢 <b>الخطوة 2: كم عدد الأسئلة التي تريد اختبار نفسك بها؟</b>`,
        parse_mode: "HTML",
        reply_markup: { inline_keyboard: getCountKeyboard(aiSettings.defaultCount) },
      });
      return true;
    }

    if (to === "difficulty") {
      session.step = "difficulty";
      const aiSettings = await getGroupAISettings(session.groupId || "global");
      await telegram.editMessageText({
        chat_id: chatId,
        message_id: msg.message_id,
        text:
          `🎓 <b>مولد الكويزات الذكي (QuizForge AI)</b>\n\n` +
          `📚 <b>المادة:</b> ${escapeHtml(session.materialTitle || "")}\n` +
          `🔢 <b>العدد:</b> ${session.questionCount || 5} أسئلة\n\n` +
          `🎯 <b>الخطوة 3: اختر مستوى الصعوبة الأكاديمي:</b>`,
        parse_mode: "HTML",
        reply_markup: { inline_keyboard: getDifficultyKeyboard(aiSettings.defaultDifficulty) },
      });
      return true;
    }
  }

  // ── Step 1 -> 2: Material Selected ──
  if (data.startsWith("qs_mat:")) {
    const matId = data.slice("qs_mat:".length);
    const material = await getMaterialById(session.groupId || "global", matId);

    if (!material) {
      await telegram.answerCallbackQuery(cbId, "⚠️ المادة المحددة لم تعد متاحة.", true);
      return true;
    }

    if (!session.groupId && material.groupId && material.groupId !== "global") {
      session.groupId = material.groupId;
    }

    session.materialId = material.id;
    session.materialTitle = material.title;
    session.step = "count";
    await telegram.answerCallbackQuery(cbId, `تم اختيار: ${material.title}`);

    const aiSettings = await getGroupAISettings(session.groupId || "global");
    await telegram.editMessageText({
      chat_id: chatId,
      message_id: msg.message_id,
      text:
        `🎓 <b>مولد الكويزات الذكي (QuizForge AI)</b>\n\n` +
        `📚 <b>المادة المختارة:</b> ${escapeHtml(material.title)}\n` +
        `📖 <b>الموضوع:</b> ${escapeHtml(material.subject || "عام")}\n\n` +
        `🔢 <b>الخطوة 2: كم عدد الأسئلة التي تريد اختبار نفسك بها؟</b>`,
      parse_mode: "HTML",
      reply_markup: { inline_keyboard: getCountKeyboard(aiSettings.defaultCount) },
    });
    return true;
  }

  // ── Step 2 -> 3: Question Count Selected ──
  if (data.startsWith("qs_cnt:")) {
    const count = parseInt(data.slice("qs_cnt:".length), 10) || 5;
    session.questionCount = count;
    session.step = "difficulty";
    await telegram.answerCallbackQuery(cbId, `${count} أسئلة`);

    const aiSettings = await getGroupAISettings(session.groupId || "global");
    await telegram.editMessageText({
      chat_id: chatId,
      message_id: msg.message_id,
      text:
        `🎓 <b>مولد الكويزات الذكي (QuizForge AI)</b>\n\n` +
        `📚 <b>المادة:</b> ${escapeHtml(session.materialTitle || "")}\n` +
        `🔢 <b>العدد:</b> ${count} أسئلة\n\n` +
        `🎯 <b>الخطوة 3: اختر مستوى الصعوبة الأكاديمي:</b>`,
      parse_mode: "HTML",
      reply_markup: { inline_keyboard: getDifficultyKeyboard(aiSettings.defaultDifficulty) },
    });
    return true;
  }

  // ── Step 3 -> 4: Difficulty Selected ──
  if (data.startsWith("qs_dif:")) {
    const diff = data.slice("qs_dif:".length) as "mixed" | "easy" | "medium" | "hard";
    session.difficulty = diff;
    await telegram.answerCallbackQuery(cbId, DIFFICULTY_NAMES[diff] || diff);

    const material = await getMaterialById(session.groupId || "global", session.materialId!);
    const sections = material?.sections || [];

    // If material has multiple sections, let user choose section
    if (sections.length > 1) {
      session.step = "section";
      session.sectionPage = 0;
      await telegram.editMessageText({
        chat_id: chatId,
        message_id: msg.message_id,
        text:
          `🎓 <b>مولد الكويزات الذكي (QuizForge AI)</b>\n\n` +
          `📚 <b>المادة:</b> ${escapeHtml(session.materialTitle || "")}\n` +
          `🔢 <b>العدد:</b> ${session.questionCount || 5} أسئلة\n` +
          `🎯 <b>الصعوبة:</b> ${DIFFICULTY_NAMES[diff]}\n\n` +
          `📑 <b>الخطوة 4: حدد الجزئية أو الفصل المطلوب:</b>`,
        parse_mode: "HTML",
        reply_markup: { inline_keyboard: getSectionKeyboard(sections, 0) },
      }).catch(() => {});
      return true;
    }

    // Single section or no sections -> Proceed directly to Generation
    session.sectionId = "all";
    session.sectionTitle = "كامل المنهج";
    await executeGeneration(session, msg.message_id, cbId);
    return true;
  }

  // ── Material Page Indicator Click (no-op info toast) ──
  if (data === "qs_mat_noop") {
    const materials = await getAllCurriculumMaterials(session.groupId);
    const totalPages = Math.max(1, Math.ceil(materials.length / MATERIALS_PER_PAGE));
    await telegram.answerCallbackQuery(cbId, `📄 صفحة ${(session.materialPage || 0) + 1} من ${totalPages}`);
    return true;
  }

  // ── Material Page Switch ──
  if (data.startsWith("qs_mat_p:")) {
    const targetPage = parseInt(data.slice("qs_mat_p:".length), 10) || 0;
    session.materialPage = targetPage;
    const materials = await getAllCurriculumMaterials(session.groupId);
    await telegram.answerCallbackQuery(cbId);
    await telegram.editMessageText({
      chat_id: chatId,
      message_id: msg.message_id,
      text: session.isBoost
        ? `🚀 <b>الدفعة الذكية (QuizForge Turbo Boost)</b>\n\nاختر مادة أو اضغط <b>كويز سريع فوري</b>:`
        : `🎓 <b>مولد الكويزات الذكي (QuizForge AI)</b>\n\n📚 <b>الخطوة 1: اختر المادة الدراسية أو الكتاب:</b>`,
      parse_mode: "HTML",
      reply_markup: { inline_keyboard: getMaterialKeyboard(materials, targetPage, session.isBoost || false) },
    }).catch(() => {});
    return true;
  }

  // ── Turbo Quick Quiz ──
  if (data.startsWith("qs_quick:")) {
    const matId = data.slice("qs_quick:".length);
    const material = await getMaterialById(session.groupId || "global", matId);
    if (!material) {
      await telegram.answerCallbackQuery(cbId, "⚠️ المادة غير متاحة حالياً.", true);
      return true;
    }
    if (!session.groupId && material.groupId && material.groupId !== "global") {
      session.groupId = material.groupId;
    }
    session.materialId = material.id;
    session.materialTitle = material.title;
    session.questionCount = 5;
    session.difficulty = "mixed";
    session.sectionId = "all";
    session.sectionTitle = "كامل المنهج / الكتاب";
    await telegram.answerCallbackQuery(cbId, "⚡ جاري إطلاق الكويز السريع...");
    await executeGeneration(session, msg.message_id, cbId);
    return true;
  }

  // ── Step 4: Page Indicator Click (No-op info toast) ──
  if (data === "qs_sec_noop") {
    const material = await getMaterialById(session.groupId || "global", session.materialId!);
    const sections = material?.sections || [];
    const totalPages = Math.max(1, Math.ceil(sections.length / SECTIONS_PER_PAGE));
    const curPage = (session.sectionPage || 0) + 1;
    await telegram.answerCallbackQuery(cbId, `📄 صفحة ${curPage} من ${totalPages}`);
    return true;
  }

  // ── Step 4: Switch Section Page ──
  if (data.startsWith("qs_sec_p:")) {
    const targetPage = parseInt(data.slice("qs_sec_p:".length), 10) || 0;
    session.sectionPage = targetPage;
    const material = await getMaterialById(session.groupId || "global", session.materialId!);
    const sections = material?.sections || [];
    const totalPages = Math.max(1, Math.ceil(sections.length / SECTIONS_PER_PAGE));
    const safePage = Math.max(0, Math.min(targetPage, totalPages - 1));

    await telegram.answerCallbackQuery(cbId, `الانتقال إلى صفحة ${safePage + 1}`);

    const difficultyLabel = DIFFICULTY_NAMES[session.difficulty || "mixed"] || "متوازن";
    await telegram.editMessageText({
      chat_id: chatId,
      message_id: msg.message_id,
      text:
        `🎓 <b>مولد الكويزات الذكي (QuizForge AI)</b>\n\n` +
        `📚 <b>المادة:</b> ${escapeHtml(session.materialTitle || "")}\n` +
        `🔢 <b>العدد:</b> ${session.questionCount || 5} أسئلة\n` +
        `🎯 <b>الصعوبة:</b> ${difficultyLabel}\n\n` +
        `📑 <b>الخطوة 4: حدد الجزئية أو الفصل المطلوب:</b>`,
      parse_mode: "HTML",
      reply_markup: { inline_keyboard: getSectionKeyboard(sections, safePage) },
    }).catch(() => {});
    return true;
  }

  // ── Step 4 -> 5: Section Selected -> Trigger Generation ──
  if (data.startsWith("qs_sec:")) {
    const secId = data.slice("qs_sec:".length);
    session.sectionId = secId;

    if (secId === "all") {
      session.sectionTitle = "كامل المنهج / الكتاب";
    } else {
      const material = await getMaterialById(session.groupId || "global", session.materialId!);
      const sec = material?.sections?.find((s) => s.id === secId);
      session.sectionTitle = sec?.title || "قسم محدد";
    }

    await telegram.answerCallbackQuery(cbId, `القسم: ${session.sectionTitle}`);
    await executeGeneration(session, msg.message_id, cbId);
    return true;
  }

  return false;
}

// ─── Execution & AI Generation Engine ─────────────────────────────────────────

async function executeGeneration(
  session: StudentQuizSession,
  wizardMessageId: number,
  cbId: string
): Promise<void> {
  const sKey = getSessionKey(session.userId, session.chatId);
  session.step = "generating";
  session.updatedAt = Date.now();

  const difficultyLabel = DIFFICULTY_NAMES[session.difficulty || "mixed"] || "متوازن";
  const targetCount = session.questionCount || 5;

  // 1. Live Progress Feedback Stages (تحديث حي لمراحل التوليد)
  const progressStages = [
    "📖 <b>المرحلة 1/3:</b> قراءة وتدقيق محتوى المنهج المستهدف... 🔍",
    "🧠 <b>المرحلة 2/3:</b> استنباط الأسئلة وصياغة المشتتات الأكاديمية الذكية... ⚡",
    "🎯 <b>المرحلة 3/3:</b> تدقيق الإجابات وتوثيق المراجع والشروحات التفسيرية... ✨",
  ];

  let currentStageIdx = 0;
  let isGenerationDone = false;
  let progressTimer: NodeJS.Timeout | null = null;

  const updateProgressMessage = async (stageText: string) => {
    if (isGenerationDone) return;
    await telegram.editMessageText({
      chat_id: session.chatId,
      message_id: wizardMessageId,
      text:
        `⏳ <b>جاري إعداد وتوليد الكويز الذكي...</b>\n\n` +
        `📚 <b>المادة:</b> ${escapeHtml(session.materialTitle || "")}\n` +
        `📑 <b>القسم:</b> ${escapeHtml(session.sectionTitle || "كامل المنهج")}\n` +
        `🎯 <b>المستوى:</b> ${difficultyLabel}\n` +
        `🔢 <b>العدد:</b> ${targetCount} أسئلة\n\n` +
        `${stageText}\n` +
        `<i>جاري المعالجة السحابية بالذكاء الاصطناعي... لحظات من فضلك</i> 🤖`,
      parse_mode: "HTML",
      reply_markup: { inline_keyboard: [] },
    }).catch(() => {});
  };

  // 1. Show live loading state on wizard message (Stage 1/3)
  await updateProgressMessage(progressStages[0]);

  // Periodic stage update every 3.8 seconds if generation is still in flight
  progressTimer = setInterval(() => {
    if (isGenerationDone) {
      if (progressTimer) clearInterval(progressTimer);
      progressTimer = null;
      return;
    }
    currentStageIdx++;
    if (currentStageIdx < progressStages.length) {
      updateProgressMessage(progressStages[currentStageIdx]);
    } else {
      if (progressTimer) clearInterval(progressTimer);
      progressTimer = null;
    }
  }, 3800);

  try {
    // 2. Fetch Material & Text
    const material = await getMaterialById(session.groupId || "global", session.materialId!);
    if (!material) {
      throw new Error("تعذر الوصول إلى محتوى المادة الدراسية.");
    }

    // Auto-bind group if material belongs to a specific group
    if (!session.groupId && material.groupId && material.groupId !== "global") {
      session.groupId = material.groupId;
    }

    const excerptResult = buildBalancedCurriculumExcerpt(material, session.sectionId, 36000);
    let textExcerpt = excerptResult.excerpt;
    let materialTitle = excerptResult.title;

    if (!textExcerpt || textExcerpt.length < 30) {
      throw new Error("نص المنهج المحدد قصير جداً لتوليد أسئلة دقيقة منه.");
    }

    // 3. Resolve API settings & keys
    const settings = await getGroupAISettings(session.groupId || "global");
    const apiKey = settings.geminiApiKey || process.env.GEMINI_API_KEY;
    if (!apiKey) {
      throw new Error("لم يتم ضبط مفتاح Gemini API Key في النظام بعد. يرجى إدخال المفتاح في لوحة التحكم.");
    }

    const resolvedCount = session.questionCount || settings.defaultCount || 5;
    const resolvedDifficulty = session.difficulty || settings.defaultDifficulty || "mixed";

    // 4. Generate with Auto-Fallback and transient retry
    let genResult: { questions: ValidatedQuestion[]; modelUsed: string; estimatedTokens: number } | null = null;
    let lastGenError: any = null;

    for (let attempt = 1; attempt <= 2; attempt++) {
      try {
        genResult = await generateCurriculumQuestions({
          apiKey,
          model: settings.defaultModel || "gemini-3.8-flash",
          textExcerpt,
          materialTitle,
          questionCount: resolvedCount,
          difficulty: resolvedDifficulty,
          strictGrounding: settings.strictGrounding ?? true,
          systemInstruction: settings.systemInstruction || undefined,
        });

        if (genResult && genResult.questions && genResult.questions.length > 0) {
          break;
        }
        throw new Error("لم يتمكن المحرك من استخراج أسئلة صالحة من النص المحدد.");
      } catch (attemptErr: any) {
        lastGenError = attemptErr;
        if (attempt >= 2) {
          break;
        }
        await new Promise((r) => setTimeout(r, 1500));
      }
    }

    if (!genResult || !genResult.questions || genResult.questions.length === 0) {
      throw lastGenError || new Error("لم يتمكن المحرك من توليد أسئلة مطابقة للشروط من هذا النص.");
    }

    const questions: ValidatedQuestion[] = genResult.questions;

    // Stop live progress timer before showing success message
    isGenerationDone = true;
    if (progressTimer) {
      clearInterval(progressTimer);
      progressTimer = null;
    }

    // 5. Update Wizard Message with Success Banner
    await telegram.editMessageText({
      chat_id: session.chatId,
      message_id: wizardMessageId,
      text:
        `🎉 <b>تم إنشاء الكويز الذكي بنجاح!</b>\n\n` +
        `📚 <b>المادة:</b> ${escapeHtml(session.materialTitle || "")}\n` +
        `🔢 <b>العدد:</b> ${questions.length} أسئلة\n` +
        `👤 <b>الممتحن:</b> <b>${escapeHtml(session.userName)}</b>\n\n` +
        `🚀 <b>الأسئلة تنطلق أدناه مباشرة... ركز وبالتوفيق!</b> ✍️`,
      parse_mode: "HTML",
      reply_markup: { inline_keyboard: [] },
    }).catch(() => {});

    // Record user rate limit
    recordUserGeneration(session.userId);

    // 6. Send Each Question as a Native Telegram Quiz Poll
    let instructorUserId: string | null = null;
    if (session.groupId) {
      try {
        const adminMember = await withRetry(() =>
          prisma.groupMember.findFirst({
            where: { groupId: session.groupId, role: { in: ["OWNER", "ADMIN"] } },
            select: { userId: true },
          })
        );
        instructorUserId = adminMember?.userId || null;
        if (!instructorUserId) {
          const anyMember = await withRetry(() =>
            prisma.groupMember.findFirst({
              where: { groupId: session.groupId },
              select: { userId: true },
            })
          );
          instructorUserId = anyMember?.userId || null;
        }
        if (!instructorUserId) {
          const anyUser = await withRetry(() =>
            prisma.user.findFirst({ select: { id: true } })
          );
          instructorUserId = anyUser?.id || null;
        }
      } catch {}
    }

    for (let i = 0; i < questions.length; i++) {
      const q = questions[i];

      // Safe option truncation & uniqueness guarantee for Telegram
      const seenOpts = new Set<string>();
      const sanitizedOptions: string[] = q.options.map((opt: string, optIdx: number) => {
        let t = truncateText(opt, 98);
        if (seenOpts.has(t.toLowerCase())) {
          t = truncateText(`${t} (${optIdx + 1})`, 98);
        }
        seenOpts.add(t.toLowerCase());
        return t;
      });

      // Format explanation with source citation strictly within Telegram 200-char limit
      const cleanExplanation = formatExplanationWithCitation(
        q.explanation,
        q.topic,
        session.sectionTitle
      );

      try {
        const sentPoll = await telegram.sendPoll({
          chat_id: session.chatId,
          message_thread_id: session.messageThreadId,
          question: `[سؤال ${i + 1}/${questions.length}] ${truncateText(q.question, 280)}`,
          options: sanitizedOptions.map((o: string) => ({ text: o })),
          type: "quiz",
          correct_option_id: q.correctOptionId,
          explanation: cleanExplanation,
          is_anonymous: false, // Students see instant grading & answers track
        });

        // If in a QuizForge registered group, save to database to track answers & analytics
        if (session.groupId && sentPoll.poll && instructorUserId) {
          await withRetry(() =>
            prisma.quiz.create({
              data: {
                groupId: session.groupId!,
                sentById: instructorUserId!,
                question: q.question,
                options: sanitizedOptions,
                correctOptionId: q.correctOptionId,
                explanation: cleanExplanation,
                type: "QUIZ",
                isAnonymous: false,
                topicId: session.messageThreadId || null,
                topicName: session.sectionTitle || null,
                pollId: sentPoll.poll?.id || null,
                messageId: sentPoll.message_id,
                sentAt: new Date(),
                tags: ["AI_CURRICULUM", "qs-bot", resolvedDifficulty],
              },
            })
          ).catch((e) => console.warn("[StudentQuizWizard] DB save quiz warning:", e));
        }

        // Slight 600ms delay to keep chronological order and prevent Telegram flood limits
        if (i < questions.length - 1) {
          await new Promise((r) => setTimeout(r, 650));
        }
      } catch (pollErr: any) {
        console.error(`[StudentQuizWizard] Failed to send poll ${i + 1}:`, pollErr);
      }
    }

    // 7. Audit log (always record to ensure curriculum & group analytics reflect all generations)
    const logGroupId = session.groupId || (material.groupId && material.groupId !== "global" ? material.groupId : "") || "global";
    await recordGenerationLog({
      id: `gen_bot_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
      groupId: logGroupId,
      userId: session.userId,
      userName: session.userName,
      userUsername: session.userUsername,
      userPhoto: session.userPhoto,
      materialId: session.materialId,
      materialTitle: session.materialTitle || material.title || "مادة دراسية",
      questionCount: questions.length,
      modelUsed: genResult.modelUsed,
      estimatedTokens: genResult.estimatedTokens,
      difficulty: resolvedDifficulty,
      timestamp: new Date().toISOString(),
      success: true,
      questionsSummary: questions.map((q) => ({
        question: q.question,
        difficulty: q.difficulty,
        topic: q.topic,
      })),
    }).catch(() => {});

    quizSessions.delete(sKey);
  } catch (err: any) {
    isGenerationDone = true;
    if (progressTimer) {
      clearInterval(progressTimer);
      progressTimer = null;
    }

    const errorMsg = String(err?.message || err || "حدث خطأ غير متوقع");
    console.error("[StudentQuizWizard] Generation error:", err);

    // Apply generation cooldown to prevent immediate repeated spam
    recordUserGeneration(session.userId);

    // Record audit log for failed bot generation attempt
    await recordGenerationLog({
      id: `gen_bot_err_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
      groupId: session.groupId || "global",
      userId: session.userId,
      userName: session.userName,
      userUsername: session.userUsername,
      userPhoto: session.userPhoto,
      materialId: session.materialId,
      materialTitle: session.materialTitle || "طلب كويز عبر البوت",
      questionCount: 0,
      modelUsed: "gemini",
      estimatedTokens: 0,
      difficulty: session.difficulty || "mixed",
      timestamp: new Date().toISOString(),
      success: false,
    }).catch(() => {});

    const isQuotaExhausted =
      /quota|429|resource_exhausted|limit:\s*20|free_tier_requests|retry in/i.test(errorMsg);

    if (isQuotaExhausted) {
      // Friendly message to student
      await telegram.editMessageText({
        chat_id: session.chatId,
        message_id: wizardMessageId,
        text:
          `⚠️ <b>عذراً، تم استهلاك الحصة اليومية للذكاء الاصطناعي حالياً (Quota Exceeded):</b>\n\n` +
          `تم إرسال إشعار فوري وتلقائي لإدارة المجموعة لتحديث الكوتا أو المفتاح عبر لوحة التحكم.\n` +
          `يرجى المحاولة في وقت لاحق 🤍`,
        parse_mode: "HTML",
        reply_markup: { inline_keyboard: [] },
      }).catch(() => {});

      // Dispatch urgent notification to group admins
      await notifyAdminsOfQuotaExhaustion({
        groupId: session.groupId,
        chatId: session.chatId,
        groupTitle: session.groupTitle,
        studentName: session.userName,
        studentId: session.userId,
        errorMessage: errorMsg,
      });
    } else {
      await telegram.editMessageText({
        chat_id: session.chatId,
        message_id: wizardMessageId,
        text:
          `❌ <b>تعذر إنشاء الكويز:</b>\n\n` +
          `${escapeHtml(errorMsg)}\n\n` +
          `<i>يمكنك المحاولة مجدداً بكتابة <code>/qs</code> أو <code>/boost</code> واختيار قسم أو عدد أسئلة مختلف.</i>`,
        parse_mode: "HTML",
        reply_markup: { inline_keyboard: [] },
      }).catch(() => {});
    }

    quizSessions.delete(sKey);
  } finally {
    isGenerationDone = true;
    if (progressTimer) {
      clearInterval(progressTimer);
      progressTimer = null;
    }
  }
}
