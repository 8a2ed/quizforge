import { getAuthSecret } from "@/lib/auth";
import { NextRequest, NextResponse } from "next/server";
import { jwtVerify } from "jose";
import { prisma, withRetry } from "@/lib/db";
import { Prisma } from "@prisma/client";
import { telegram } from "@/lib/telegram";
import { parseExamConfig, formatExamDescription } from "@/lib/examConfig";
import { checkAndExpireExamSessions } from "@/lib/examExpiry";

const JWT_SECRET = getAuthSecret();
const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const BOT_USERNAME = (process.env.NEXT_PUBLIC_BOT_USERNAME || "").replace(/^@/, "");

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

interface SanitizedQuestion {
  question: string;
  options: string[];
  correctOptionId: number;
  explanation?: string;
  imageUrl?: string;
}

function sanitizeQuestions(raw: unknown): SanitizedQuestion[] | null {
  if (!Array.isArray(raw) || raw.length === 0) return null;
  const cleaned: SanitizedQuestion[] = [];

  for (let i = 0; i < raw.length; i++) {
    const item = raw[i];
    if (!item || typeof item !== "object") return null;
    const question = String(item.question || "").trim();
    if (!question || question.length > 500) return null;

    const rawOptions = Array.isArray(item.options) ? item.options : [];
    const options = rawOptions.map((o: unknown) => String(o).trim()).filter(Boolean);
    if (options.length < 2 || options.length > 10) return null;
    if (options.some((o: string) => o.length > 100)) return null;

    const lower = options.map((o: string) => o.toLowerCase());
    if (new Set(lower).size !== lower.length) return null;

    const correctOptionId = Number(item.correctOptionId);
    if (isNaN(correctOptionId) || correctOptionId < 0 || correctOptionId >= options.length) return null;

    const explanation = item.explanation ? String(item.explanation).trim().slice(0, 500) : undefined;
    const imageUrl = item.imageUrl && typeof item.imageUrl === "string" && item.imageUrl.trim().length > 0
      ? item.imageUrl.trim()
      : undefined;
    cleaned.push({ question, options, correctOptionId, explanation, imageUrl });
  }
  return cleaned;
}

async function authorize(req: NextRequest, groupId: string) {
  const token = req.cookies.get("qf_session")?.value;
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, JWT_SECRET);
    const userId = (payload as { sub: string }).sub;
    const m = await withRetry(() => prisma.groupMember.findUnique({
      where: { userId_groupId: { userId, groupId } },
      include: { group: true },
    }));
    if (!m || !m.approved) return null;
    return { userId, membership: m };
  } catch { return null; }
}

// GET /api/groups/[groupId]/exams
export async function GET(req: NextRequest, { params }: { params: Promise<{ groupId: string }> }) {
  const { groupId } = await params;
  const auth = await authorize(req, groupId);
  if (!auth) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (auth.membership.role !== "OWNER" && auth.membership.role !== "ADMIN") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  // Sweep and finalize any overdue or inactive sessions before listing
  await checkAndExpireExamSessions().catch((e) => console.error("[exams/GET] checkAndExpire error:", e));

  const exams = await withRetry(() => prisma.exam.findMany({
    where: { groupId },
    include: { _count: { select: { results: true } }, createdBy: { select: { firstName: true, username: true } } },
    orderBy: { createdAt: "desc" },
  }));

  const mappedExams = exams.map(e => {
    const cfg = parseExamConfig(e.description);
    return {
      ...e,
      description: cfg.cleanDescription || null,
      shuffleQuestions: cfg.shuffleQuestions,
      shuffleOptions: cfg.shuffleOptions,
      showSolutionsImmediately: cfg.showSolutionsImmediately,
      maxAttempts: cfg.maxAttempts ?? 1,
      isPaused: cfg.isPaused || false,
    };
  });

  return NextResponse.json({ exams: mappedExams });
}

// POST /api/groups/[groupId]/exams
export async function POST(req: NextRequest, { params }: { params: Promise<{ groupId: string }> }) {
  const { groupId } = await params;
  const auth = await authorize(req, groupId);
  if (!auth) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (auth.membership.role !== "OWNER" && auth.membership.role !== "ADMIN") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = await req.json();
  const { title, description, questions, timeLimit, passingScore, topicId, topicName, shuffleQuestions, shuffleOptions, showSolutionsImmediately, maxAttempts } = body;

  if (!title?.trim()) return NextResponse.json({ error: "Exam title is required" }, { status: 400 });
  const cleanedQuestions = sanitizeQuestions(questions);
  if (!cleanedQuestions) {
    return NextResponse.json({ error: "Each question must have text, at least 2 unique options (max 10), and a valid answer." }, { status: 400 });
  }

  const cleanPassingScore = Math.min(100, Math.max(1, Number(passingScore) || 60));
  const cleanTimeLimit = timeLimit && Number(timeLimit) > 0 ? Math.round(Number(timeLimit)) : null;

  const formattedDesc = formatExamDescription(description, {
    shuffleQuestions: shuffleQuestions !== false,
    shuffleOptions: shuffleOptions !== false,
    showSolutionsImmediately: showSolutionsImmediately !== false,
    maxAttempts: typeof maxAttempts === "number" ? Math.max(0, maxAttempts) : 1,
  });

  const exam = await withRetry(() => prisma.exam.create({
    data: {
      title: title.trim(),
      description: formattedDesc,
      questions: cleanedQuestions as unknown as Prisma.InputJsonValue,
      timeLimit: cleanTimeLimit,
      passingScore: cleanPassingScore,
      topicId: topicId ? Number(topicId) : null,
      topicName: topicName?.trim() || null,
      isPublished: false,
      groupId,
      createdById: auth.userId,
    },
  }));

  const cfg = parseExamConfig(exam.description);

  return NextResponse.json({
    ok: true,
    exam: {
      ...exam,
      description: cfg.cleanDescription || null,
      shuffleQuestions: cfg.shuffleQuestions,
      shuffleOptions: cfg.shuffleOptions,
    },
  });
}

// ─── Format & Sync Exam Announcement on Telegram ──────────────────────────────
function formatExamAnnouncementText(
  exam: { title: string; description: string | null; timeLimit: number | null; passingScore: number; isPublished: boolean },
  questionsCount: number,
  isPaused: boolean
): string {
  const cfg = parseExamConfig(exam.description);
  const cleanDesc = cfg.cleanDescription;
  const maxAttempts = cfg.maxAttempts ?? 1;

  if (!exam.isPublished) {
    return [
      `❌ <b>[تم إغلاق الاختبار] ${escapeHtml(exam.title)}</b>`,
      `\n\n⚠️ <i>تم إغلاق هذا الاختبار وإلغاء نشره بواسطة المعلم.</i>`,
    ].join("");
  }

  if (isPaused) {
    return [
      `⏸ <b>[متوقف مؤقتاً] ${escapeHtml(exam.title)}</b>`,
      cleanDesc ? `\n${escapeHtml(cleanDesc)}` : "",
      `\n\n📊 <b>${questionsCount} أسئلة</b>`,
      exam.timeLimit ? `\n⏱ <b>المدة الزمنية: ${Math.floor(exam.timeLimit / 60)} دقيقة</b>` : "",
      `\n✅ <b>درجة النجاح: ${exam.passingScore}%</b>`,
      maxAttempts === 1 ? "" : `\n🔄 <b>المحاولات المسموحة: ${maxAttempts === 0 ? "غير محدود" : maxAttempts}</b>`,
      cfg.shuffleQuestions || cfg.shuffleOptions ? `\n🛡 <b>مكافحة الغش: ترتيب عشوائي للأسئلة والخيارات</b>` : "",
      `\n\n⚠️ <i>هذا الاختبار متوقف مؤقتاً حالياً بقرار من المعلم. لا يمكن بدء محاولات جديدة في الوقت الحالي.</i>`,
    ].filter(Boolean).join("");
  }

  return [
    `📋 <b>${escapeHtml(exam.title)}</b>`,
    cleanDesc ? `\n${escapeHtml(cleanDesc)}` : "",
    `\n\n📊 <b>${questionsCount} أسئلة</b>`,
    exam.timeLimit ? `\n⏱ <b>المدة الزمنية: ${Math.floor(exam.timeLimit / 60)} دقيقة</b>` : "",
    `\n✅ <b>درجة النجاح: ${exam.passingScore}%</b>`,
    maxAttempts === 1 ? "" : `\n🔄 <b>المحاولات المسموحة: ${maxAttempts === 0 ? "غير محدود" : maxAttempts}</b>`,
    cfg.shuffleQuestions || cfg.shuffleOptions ? `\n🛡 <b>مكافحة الغش: ترتيب عشوائي للأسئلة والخيارات</b>` : "",
    `\n\n👉 <i>اضغط على الزر أدناه لبدء الامتحان في محادثة خاصة مع البوت (Telegram DM).</i>`,
  ].filter(Boolean).join("");
}

async function syncTelegramExamAnnouncement({
  exam,
  chatId,
  launchTopicId,
  relaunch = false,
}: {
  exam: {
    id: string;
    title: string;
    description: string | null;
    timeLimit: number | null;
    passingScore: number;
    questions: unknown;
    launchMsgId: number | null;
    topicId: number | null;
    isPublished: boolean;
  };
  chatId: string;
  launchTopicId?: number | null;
  relaunch?: boolean;
}): Promise<{ telegramUpdated: boolean; newLaunchMsgId?: number }> {
  if (!BOT_TOKEN) return { telegramUpdated: false };

  const qsCount = Array.isArray(exam.questions) ? exam.questions.length : 0;
  const cfg = parseExamConfig(exam.description);
  const isPaused = Boolean(cfg.isPaused);
  const text = formatExamAnnouncementText(exam, qsCount, isPaused);

  let botUsername = BOT_USERNAME;
  if (!botUsername) {
    try {
      const me = await telegram.getMe();
      if (me?.username) botUsername = me.username.replace(/^@/, "");
    } catch {}
  }

  const startButton = !exam.isPublished
    ? { text: "❌ الاختبار مغلق", callback_data: `exam_closed:${exam.id}` }
    : isPaused
    ? { text: "⏸ الاختبار متوقف مؤقتاً", callback_data: `exam_paused:${exam.id}` }
    : (botUsername
        ? { text: "🚀 بدء الامتحان (Start Exam)", url: `https://t.me/${botUsername}?start=exam_${exam.id}` }
        : { text: "🚀 بدء الامتحان (Start Exam)", callback_data: `exam_start:${exam.id}` });

  // If relaunch requested OR no launch message exists yet:
  if (relaunch || !exam.launchMsgId) {
    if (!exam.isPublished) return { telegramUpdated: false };
    try {
      const ac = new AbortController();
      const t = setTimeout(() => ac.abort(), 15_000);
      const res = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: ac.signal,
        body: JSON.stringify({
          chat_id: chatId,
          ...(launchTopicId ? { message_thread_id: launchTopicId } : {}),
          text,
          parse_mode: "HTML",
          reply_markup: {
            inline_keyboard: [[startButton]],
          },
        }),
      });
      clearTimeout(t);
      const data = await res.json();
      if (data.ok && data.result?.message_id) {
        return { telegramUpdated: true, newLaunchMsgId: data.result.message_id };
      }
      return { telegramUpdated: false };
    } catch (e) {
      console.error("[syncTelegramExamAnnouncement] sendMessage error:", e);
      return { telegramUpdated: false };
    }
  }

  // Otherwise, edit the existing launch message if found
  try {
    const ac = new AbortController();
    const t = setTimeout(() => ac.abort(), 15_000);
    const res = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/editMessageText`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal: ac.signal,
      body: JSON.stringify({
        chat_id: chatId,
        message_id: exam.launchMsgId,
        text,
        parse_mode: "HTML",
        reply_markup: {
          inline_keyboard: [[startButton]],
        },
      }),
    });
    clearTimeout(t);
    const data = await res.json();
    if (data.ok || data.description?.includes("message is not modified")) {
      return { telegramUpdated: true };
    }
    console.log("[syncTelegramExamAnnouncement] editMessageText note:", data.description);
    return { telegramUpdated: false };
  } catch (err) {
    console.error("[syncTelegramExamAnnouncement] editMessageText error:", err);
    return { telegramUpdated: false };
  }
}

// PATCH /api/groups/[groupId]/exams — update exam settings, publish/relaunch, or pause/resume
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ groupId: string }> }) {
  const { groupId } = await params;
  const auth = await authorize(req, groupId);
  if (!auth) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (auth.membership.role !== "OWNER" && auth.membership.role !== "ADMIN") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = await req.json();
  const {
    id,
    title,
    description,
    questions,
    timeLimit,
    passingScore,
    isPublished,
    isPaused,
    topicId,
    topicName,
    shuffleQuestions,
    shuffleOptions,
    showSolutionsImmediately,
    maxAttempts,
    relaunch,
  } = body;
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });

  const existingExam = await withRetry(() => prisma.exam.findFirst({
    where: { id, groupId },
    include: { group: true }
  }));
  if (!existingExam) {
    return NextResponse.json({ error: "Exam not found" }, { status: 404 });
  }

  let cleanedQuestions: SanitizedQuestion[] | undefined = undefined;
  if (questions !== undefined) {
    const res = sanitizeQuestions(questions);
    if (!res) {
      return NextResponse.json({ error: "Invalid questions format or options" }, { status: 400 });
    }
    cleanedQuestions = res;
  }

  const cleanPassingScore = passingScore !== undefined ? Math.min(100, Math.max(1, Number(passingScore) || 60)) : undefined;
  const cleanTimeLimit = timeLimit !== undefined ? (Number(timeLimit) > 0 ? Math.round(Number(timeLimit)) : null) : undefined;

  let formattedDesc: string | undefined = undefined;
  if (description !== undefined || shuffleQuestions !== undefined || shuffleOptions !== undefined || showSolutionsImmediately !== undefined || maxAttempts !== undefined || isPaused !== undefined) {
    const currentCfg = parseExamConfig(existingExam.description);
    const nextCleanDesc = description !== undefined ? description : currentCfg.cleanDescription;
    const nextShuffleQ = shuffleQuestions !== undefined ? Boolean(shuffleQuestions) : currentCfg.shuffleQuestions;
    const nextShuffleOpts = shuffleOptions !== undefined ? Boolean(shuffleOptions) : currentCfg.shuffleOptions;
    const nextSolutions = showSolutionsImmediately !== undefined ? Boolean(showSolutionsImmediately) : currentCfg.showSolutionsImmediately;
    const nextAttempts = maxAttempts !== undefined ? Math.max(0, Number(maxAttempts)) : currentCfg.maxAttempts;
    const nextPaused = isPaused !== undefined ? Boolean(isPaused) : currentCfg.isPaused;
    formattedDesc = formatExamDescription(nextCleanDesc, {
      shuffleQuestions: nextShuffleQ,
      shuffleOptions: nextShuffleOpts,
      showSolutionsImmediately: nextSolutions,
      maxAttempts: nextAttempts,
      isPaused: nextPaused,
    });
  }

  await withRetry(() => prisma.exam.update({
    where: { id },
    data: {
      ...(title !== undefined ? { title: title.trim() } : {}),
      ...(formattedDesc !== undefined ? { description: formattedDesc } : {}),
      ...(cleanedQuestions !== undefined ? { questions: cleanedQuestions as unknown as Prisma.InputJsonValue } : {}),
      ...(cleanTimeLimit !== undefined ? { timeLimit: cleanTimeLimit } : {}),
      ...(cleanPassingScore !== undefined ? { passingScore: cleanPassingScore } : {}),
      ...(isPublished !== undefined ? { isPublished } : {}),
      ...(topicId !== undefined ? { topicId: topicId ? Number(topicId) : null } : {}),
      ...(topicName !== undefined ? { topicName: topicName?.trim() || null } : {}),
    },
  }));

  const updatedExam = await withRetry(() => prisma.exam.findFirst({
    where: { id, groupId },
    include: { group: true }
  }));

  let telegramUpdated = false;
  if (updatedExam?.group) {
    const launchTopicId = updatedExam.topicId ?? (topicId ? Number(topicId) : null);
    // Sync to Telegram: edit announcement if message exists, or send new if first-time publish or relaunch requested
    const syncRes = await syncTelegramExamAnnouncement({
      exam: updatedExam,
      chatId: updatedExam.group.chatId,
      launchTopicId,
      relaunch: Boolean(relaunch) || (isPublished === true && !existingExam.isPublished),
    });

    telegramUpdated = syncRes.telegramUpdated;
    if (syncRes.newLaunchMsgId) {
      await withRetry(() => prisma.exam.update({
        where: { id },
        data: { launchMsgId: syncRes.newLaunchMsgId }
      })).catch(() => {});
    }
  }

  const finalCfg = parseExamConfig(updatedExam?.description);

  return NextResponse.json({
    ok: true,
    telegramUpdated,
    isPaused: finalCfg.isPaused,
    isPublished: updatedExam?.isPublished,
  });
}

// DELETE /api/groups/[groupId]/exams
export async function DELETE(req: NextRequest, { params }: { params: Promise<{ groupId: string }> }) {
  const { groupId } = await params;
  const auth = await authorize(req, groupId);
  if (!auth) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (auth.membership.role !== "OWNER" && auth.membership.role !== "ADMIN") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { id } = await req.json();
  await withRetry(() => prisma.exam.deleteMany({ where: { id, groupId } }));
  return NextResponse.json({ ok: true });
}
