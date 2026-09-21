import { NextRequest, NextResponse } from "next/server";
import { jwtVerify } from "jose";
import { prisma, withRetry } from "@/lib/db";
import { Prisma } from "@prisma/client";
import { parseExamConfig, formatExamDescription } from "@/lib/examConfig";

const JWT_SECRET = new TextEncoder().encode(process.env.AUTH_SECRET || "secret");
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
    cleaned.push({ question, options, correctOptionId, explanation });
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
    };
  });

  return NextResponse.json({ exams: mappedExams });
}

// POST /api/groups/[groupId]/exams
export async function POST(req: NextRequest, { params }: { params: Promise<{ groupId: string }> }) {
  const { groupId } = await params;
  const auth = await authorize(req, groupId);
  if (!auth) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json();
  const { title, description, questions, timeLimit, passingScore, topicId, topicName, shuffleQuestions, shuffleOptions } = body;

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

// PATCH /api/groups/[groupId]/exams — update exam
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ groupId: string }> }) {
  const { groupId } = await params;
  const auth = await authorize(req, groupId);
  if (!auth) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json();
  const { id, title, description, questions, timeLimit, passingScore, isPublished, topicId, topicName, shuffleQuestions, shuffleOptions } = body;
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });

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
  if (description !== undefined || shuffleQuestions !== undefined || shuffleOptions !== undefined) {
    const current = await withRetry(() => prisma.exam.findUnique({ where: { id }, select: { description: true } }));
    const currentCfg = parseExamConfig(current?.description);
    const nextCleanDesc = description !== undefined ? description : currentCfg.cleanDescription;
    const nextShuffleQ = shuffleQuestions !== undefined ? Boolean(shuffleQuestions) : currentCfg.shuffleQuestions;
    const nextShuffleOpts = shuffleOptions !== undefined ? Boolean(shuffleOptions) : currentCfg.shuffleOptions;
    formattedDesc = formatExamDescription(nextCleanDesc, { shuffleQuestions: nextShuffleQ, shuffleOptions: nextShuffleOpts });
  }

  const updated = await withRetry(() => prisma.exam.updateMany({
    where: { id, groupId },
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

  // If publishing (or re-publishing), send/re-send launch announcement message to Telegram group
  if (isPublished === true && updated.count > 0) {
    const exam = await withRetry(() => prisma.exam.findFirst({ where: { id, groupId }, include: { group: true } }));
    if (exam?.group) {
      const qs = exam.questions as Array<Record<string, unknown>>;
      const cleanDesc = parseExamConfig(exam.description).cleanDescription;
      const msg = [
        `📋 <b>${escapeHtml(exam.title)}</b>`,
        cleanDesc ? `\n${escapeHtml(cleanDesc)}` : "",
        `\n\n📊 <b>${qs.length} question${qs.length !== 1 ? "s" : ""}</b>`,
        exam.timeLimit ? `\n⏱ <b>${Math.floor(exam.timeLimit / 60)} minute time limit</b>` : "",
        `\n✅ <b>Passing score: ${exam.passingScore}%</b>`,
        `\n\n👉 <i>Tap the button below to start the exam in your private chat.</i>`,
      ].filter(Boolean).join("");

      const launchTopicId = exam.topicId ?? (topicId ? Number(topicId) : null);

      // Inline button: If bot username is known, use direct URL deep-link; otherwise fallback to callback_data
      const startButton = BOT_USERNAME
        ? { text: "🚀 Start Exam", url: `https://t.me/${BOT_USERNAME}?start=exam_${exam.id}` }
        : { text: "🚀 Start Exam", callback_data: `exam_start:${exam.id}` };

      try {
        const ac = new AbortController();
        const t = setTimeout(() => ac.abort(), 15_000);
        const res = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          signal: ac.signal,
          body: JSON.stringify({
            chat_id: exam.group.chatId,
            ...(launchTopicId ? { message_thread_id: launchTopicId } : {}),
            text: msg,
            parse_mode: "HTML",
            reply_markup: {
              inline_keyboard: [[startButton]],
            },
          }),
        });
        clearTimeout(t);
        const data = await res.json();
        if (data.ok) {
          await withRetry(() => prisma.exam.update({ where: { id }, data: { launchMsgId: data.result.message_id } }));
        } else {
          console.error("[exam launch] Telegram error:", data);
        }
      } catch (e) { console.error("[exam launch] fetch error:", e); }
    }
  }

  return NextResponse.json({ ok: true });
}

// DELETE /api/groups/[groupId]/exams
export async function DELETE(req: NextRequest, { params }: { params: Promise<{ groupId: string }> }) {
  const { groupId } = await params;
  const auth = await authorize(req, groupId);
  if (!auth) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await req.json();
  await withRetry(() => prisma.exam.deleteMany({ where: { id, groupId } }));
  return NextResponse.json({ ok: true });
}
