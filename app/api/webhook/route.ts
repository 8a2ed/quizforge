import { NextRequest, NextResponse } from "next/server";
import { prisma, withRetry } from "@/lib/db";

const WEBHOOK_SECRET = process.env.WEBHOOK_SECRET || "";
const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN!;

// ─── In-memory exam session store ──────────────────────────────────────────
interface ExamQuestion {
  question: string;
  options: string[];
  correctOptionId: number;
  explanation?: string;
}

interface ExamSession {
  examId: string;
  examTitle: string;
  chatId: number;
  msgId: number;
  name: string;
  telegramId: string;
  questions: ExamQuestion[];
  answers: Record<number, number>; // qIndex → selectedOptionId
  currentQ: number;
  startedAt: number; // Date.now()
  timeLimit: number | null; // seconds
  passingScore: number;
}

// Persist across serverless invocations within same process
declare global { var __examSessions: Map<string, ExamSession> | undefined; }
const examSessions: Map<string, ExamSession> = (globalThis.__examSessions ??= new Map());

const sessionKey = (telegramId: string, examId: string) => `${telegramId}:${examId}`;

// ─── Telegram API helpers ───────────────────────────────────────────────────
async function tgCall(method: string, body: Record<string, unknown>): Promise<Record<string, unknown>> {
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), 15_000);
  try {
    const res = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/${method}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: ac.signal,
    });
    return res.json();
  } finally {
    clearTimeout(t);
  }
}

async function ackCb(id: string, text?: string, alert = false) {
  return tgCall("answerCallbackQuery", {
    callback_query_id: id,
    ...(text ? { text, show_alert: alert } : {}),
  });
}

// ─── Exam question renderer ─────────────────────────────────────────────────
async function sendQuestion(session: ExamSession, cbId: string) {
  const q = session.questions[session.currentQ];
  const total = session.questions.length;
  const qNum = session.currentQ + 1;

  // Time remaining check
  if (session.timeLimit) {
    const elapsed = Math.floor((Date.now() - session.startedAt) / 1000);
    if (elapsed >= session.timeLimit) {
      await ackCb(cbId, "⏰ Time's up!", true);
      await finishExam(session, true);
      return;
    }
  }

  const progress = "▓".repeat(qNum) + "░".repeat(total - qNum);
  const text = [
    `📋 *${session.examTitle}*`,
    `\`${progress}\` ${qNum}/${total}`,
    "",
    `*Q${qNum}. ${escapeMarkdown(q.question)}*`,
  ].join("\n");

  const keyboard = q.options.map((opt, i) => ([{
    text: `${String.fromCharCode(65 + i)}. ${opt}`,
    callback_data: `exam_answer:${session.examId}:${session.currentQ}:${i}`,
  }]));

  await ackCb(cbId);
  await tgCall("editMessageText", {
    chat_id: session.chatId,
    message_id: session.msgId,
    text,
    parse_mode: "Markdown",
    reply_markup: { inline_keyboard: keyboard },
  });
}

// ─── Finish exam & save result ──────────────────────────────────────────────
async function finishExam(session: ExamSession, timedOut = false) {
  const { questions, answers, examId, passingScore, name, telegramId, chatId, msgId, startedAt, examTitle } = session;
  examSessions.delete(sessionKey(telegramId, examId));

  let correct = 0;
  const breakdown: string[] = [];

  questions.forEach((q, i) => {
    const chosen = answers[i] ?? -1;
    const isCorrect = chosen === q.correctOptionId;
    if (isCorrect) correct++;
    const icon = isCorrect ? "✅" : "❌";
    const chosenLabel = chosen >= 0 ? `${String.fromCharCode(65 + chosen)}` : "—";
    const correctLabel = String.fromCharCode(65 + q.correctOptionId);
    breakdown.push(`${icon} Q${i + 1}: You chose *${chosenLabel}* (correct: *${correctLabel}*)`);
    if (!isCorrect && q.explanation) breakdown.push(`  💡 ${escapeMarkdown(q.explanation)}`);
  });

  const score = Math.round((correct / questions.length) * 100);
  const passed = score >= passingScore;
  const duration = Math.floor((Date.now() - startedAt) / 1000);

  // Persist result
  try {
    await withRetry(() => prisma.examResult.create({
      data: { examId, name, telegramId, answers, score, passed, duration },
    }));
  } catch (e) { console.error("[exam] save result error:", e); }

  const resultIcon = timedOut ? "⏰" : passed ? "🏆" : "📋";
  const resultText = [
    `${resultIcon} *Exam Complete: ${examTitle}*`,
    "",
    timedOut ? "⏰ _Time ran out!_\n" : "",
    `*Score: ${score}% — ${passed ? "PASSED ✅" : "FAILED ❌"}*`,
    `Correct: ${correct}/${questions.length}`,
    `Time: ${Math.floor(duration / 60)}m ${duration % 60}s`,
    "",
    "─────────────────",
    ...breakdown,
  ].filter(s => s !== undefined).join("\n");

  await tgCall("editMessageText", {
    chat_id: chatId,
    message_id: msgId,
    text: resultText,
    parse_mode: "Markdown",
    reply_markup: { inline_keyboard: [] },
  });
}

// ─── Exam callback handlers ─────────────────────────────────────────────────
async function handleExamStart(cb: Record<string, unknown>, examId: string) {
  const user = cb.from as Record<string, unknown>;
  const telegramId = String((user as { id: number }).id);
  const firstName = String((user as { first_name: string }).first_name || "Student");
  const cbId = cb.id as string;

  try {
    const exam = await withRetry(() => prisma.exam.findUnique({ where: { id: examId } }));
    if (!exam || !exam.isPublished) {
      return ackCb(cbId, "This exam is not available.", true);
    }

    const existing = await withRetry(() => prisma.examResult.findFirst({ where: { examId, telegramId } }));
    if (existing) {
      return ackCb(cbId, `You already completed this exam with ${existing.score}%. Contact your instructor to retake.`, true);
    }

    const questions = exam.questions as unknown as ExamQuestion[];
    const info = [
      `📋 *${escapeMarkdown(exam.title)}*`,
      exam.description ? `\n${escapeMarkdown(exam.description)}` : "",
      `\n\n📊 *${questions.length} questions*`,
      exam.timeLimit ? `\n⏱ *Time limit: ${Math.floor(exam.timeLimit / 60)} minutes*` : "",
      `\n✅ *Passing score: ${exam.passingScore}%*`,
      "\n\nPress *Begin* to start. Answer each question by tapping an option.",
    ].filter(Boolean).join("");

    await ackCb(cbId);
    await tgCall("sendMessage", {
      chat_id: telegramId,
      text: info,
      parse_mode: "Markdown",
      reply_markup: {
        inline_keyboard: [[
          { text: "🚀 Begin Exam", callback_data: `exam_begin:${examId}` },
          { text: "❌ Cancel", callback_data: `exam_cancel:${examId}` },
        ]],
      },
    });
  } catch (e) {
    console.error("[exam] handleExamStart error:", e);
    await ackCb(cbId, "Something went wrong. Try again.", true);
  }
}

async function handleExamBegin(cb: Record<string, unknown>, examId: string) {
  const user = cb.from as Record<string, unknown>;
  const telegramId = String((user as { id: number }).id);
  const cbId = cb.id as string;
  const chatId = (cb.message as { chat: { id: number } }).chat.id;
  const msgId = (cb.message as { message_id: number }).message_id;
  const firstName = String((user as { first_name: string }).first_name || "Student");
  const lastName = String((user as { last_name?: string }).last_name || "");
  const name = [firstName, lastName].filter(Boolean).join(" ");

  try {
    const exam = await withRetry(() => prisma.exam.findUnique({ where: { id: examId } }));
    if (!exam || !exam.isPublished) {
      return ackCb(cbId, "Exam not available.", true);
    }

    const existing = await withRetry(() => prisma.examResult.findFirst({ where: { examId, telegramId } }));
    if (existing) {
      return ackCb(cbId, `You already completed this exam (${existing.score}%).`, true);
    }

    // Create session
    const session: ExamSession = {
      examId,
      examTitle: exam.title,
      chatId,
      msgId,
      name,
      telegramId,
      questions: exam.questions as unknown as ExamQuestion[],
      answers: {},
      currentQ: 0,
      startedAt: Date.now(),
      timeLimit: exam.timeLimit,
      passingScore: exam.passingScore,
    };
    examSessions.set(sessionKey(telegramId, examId), session);

    await sendQuestion(session, cbId);
  } catch (e) {
    console.error("[exam] handleExamBegin error:", e);
    await ackCb(cbId, "Could not start exam. Try again.", true);
  }
}

async function handleExamAnswer(cb: Record<string, unknown>, examId: string, qIndex: number, optionId: number) {
  const user = cb.from as Record<string, unknown>;
  const telegramId = String((user as { id: number }).id);
  const cbId = cb.id as string;

  const key = sessionKey(telegramId, examId);
  const session = examSessions.get(key);

  if (!session) {
    return ackCb(cbId, "Session expired. Please start the exam again.", true);
  }

  // Prevent answering already-passed questions
  if (qIndex !== session.currentQ) {
    return ackCb(cbId, "Please answer the current question.", true);
  }

  // Record answer
  session.answers[qIndex] = optionId;
  session.currentQ++;

  if (session.currentQ >= session.questions.length) {
    // Exam complete
    await finishExam(session);
  } else {
    await sendQuestion(session, cbId);
  }
}

async function handleExamCancel(cb: Record<string, unknown>, examId: string) {
  const user = cb.from as Record<string, unknown>;
  const telegramId = String((user as { id: number }).id);
  const cbId = cb.id as string;

  examSessions.delete(sessionKey(telegramId, examId));

  await ackCb(cbId, "Exam cancelled.", false);
  try {
    await tgCall("editMessageReplyMarkup", {
      chat_id: (cb.message as { chat: { id: number } }).chat.id,
      message_id: (cb.message as { message_id: number }).message_id,
      reply_markup: { inline_keyboard: [] },
    });
  } catch { /* ignore if already edited */ }
}

// ─── Markdown escape helper ─────────────────────────────────────────────────
function escapeMarkdown(s: string): string {
  return s.replace(/([_*[\]()~`>#+\-=|{}.!])/g, "\\$1");
}

// ─── Main webhook handler ───────────────────────────────────────────────────
export async function POST(req: NextRequest) {
  try {
    if (WEBHOOK_SECRET) {
      const secret = req.headers.get("x-telegram-bot-api-secret-token");
      if (secret !== WEBHOOK_SECRET) return NextResponse.json({ ok: false }, { status: 401 });
    }

    const update = await req.json();

    // ─── Poll answer ────────────────────────────────────────────────────────
    if (update.poll_answer) {
      const { poll_id, user, option_ids } = update.poll_answer;
      const quiz = await withRetry(() => prisma.quiz.findFirst({ where: { pollId: poll_id } }));
      if (quiz) {
        await withRetry(() => prisma.pollAnswer.upsert({
          where: { quizId_telegramUserId: { quizId: quiz.id, telegramUserId: String(user.id) } },
          update: { optionIds: option_ids, answeredAt: new Date(), firstName: user.first_name, username: user.username },
          create: { quizId: quiz.id, telegramUserId: String(user.id), optionIds: option_ids, firstName: user.first_name, username: user.username },
        }));
      }
    }

    // ─── Poll closed ────────────────────────────────────────────────────────
    if (update.poll?.is_closed) {
      await prisma.quiz.updateMany({ where: { pollId: update.poll.id }, data: { pollClosed: true } }).catch(() => {});
    }

    // ─── Message events ─────────────────────────────────────────────────────
    if (update.message) {
      const msg = update.message;
      const chatId = String(msg.chat?.id);

      const resolveGroup = () => prisma.group.findFirst({
        where: { OR: [{ chatId }, { chatId: `-100${chatId.replace(/^-/, "")}` }] },
      });

      if (msg.forum_topic_created && msg.message_thread_id) {
        const group = await resolveGroup();
        if (group) {
          await prisma.topic.upsert({
            where: { groupId_topicId: { groupId: group.id, topicId: msg.message_thread_id } },
            update: { name: msg.forum_topic_created.name },
            create: { groupId: group.id, topicId: msg.message_thread_id, name: msg.forum_topic_created.name, iconColor: msg.forum_topic_created.icon_color || 0, iconCustomEmojiId: msg.forum_topic_created.icon_custom_emoji_id || null, isClosed: false },
          }).catch(() => {});
        }
      }

      if (msg.forum_topic_closed && msg.message_thread_id) {
        const group = await resolveGroup();
        if (group) await prisma.topic.updateMany({ where: { groupId: group.id, topicId: msg.message_thread_id }, data: { isClosed: true } }).catch(() => {});
      }

      if (msg.forum_topic_reopened && msg.message_thread_id) {
        const group = await resolveGroup();
        if (group) await prisma.topic.updateMany({ where: { groupId: group.id, topicId: msg.message_thread_id }, data: { isClosed: false } }).catch(() => {});
      }
    }

    // ─── Callback queries ────────────────────────────────────────────────────
    if (update.callback_query) {
      const cb = update.callback_query as Record<string, unknown>;
      const data: string = (cb.data as string) || "";

      if (data.startsWith("exam_start:")) {
        await handleExamStart(cb, data.slice("exam_start:".length));

      } else if (data.startsWith("exam_begin:")) {
        await handleExamBegin(cb, data.slice("exam_begin:".length));

      } else if (data.startsWith("exam_answer:")) {
        // exam_answer:{examId}:{qIndex}:{optionId}
        const parts = data.split(":");
        if (parts.length === 4) {
          await handleExamAnswer(cb, parts[1], Number(parts[2]), Number(parts[3]));
        }

      } else if (data.startsWith("exam_cancel:")) {
        await handleExamCancel(cb, data.slice("exam_cancel:".length));

      } else if (data === "exam_cancel") {
        // Legacy cancel without examId
        const cbId = cb.id as string;
        await ackCb(cbId, "Cancelled.", false);
      }
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("Webhook error:", err);
    return NextResponse.json({ ok: false }, { status: 500 });
  }
}
