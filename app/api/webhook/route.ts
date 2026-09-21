import { NextRequest, NextResponse } from "next/server";
import { prisma, withRetry } from "@/lib/db";

const WEBHOOK_SECRET  = process.env.WEBHOOK_SECRET  || "";
const BOT_TOKEN       = process.env.TELEGRAM_BOT_TOKEN!;
const BOT_USERNAME    = process.env.NEXT_PUBLIC_BOT_USERNAME || "";

// ─── Exam session store & persistent fallback ──────────────────────────────
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
  answers: Record<number, number>;
  currentQ: number;
  startedAt: number;
  timeLimit: number | null;
  passingScore: number;
}

declare global { var __examSessions: Map<string, ExamSession> | undefined; }
const examSessions: Map<string, ExamSession> = (globalThis.__examSessions ??= new Map());
const sessionKey = (telegramId: string, examId: string) => `${telegramId}:${examId}`;

// ─── Telegram helpers ───────────────────────────────────────────────────────
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
  } finally { clearTimeout(t); }
}

async function ackCb(id: string, text?: string, alert = false) {
  return tgCall("answerCallbackQuery", {
    callback_query_id: id,
    ...(text ? { text, show_alert: alert } : {}),
  });
}

function escapeHtml(s: string): string {
  return String(s || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

// ─── Send exam preview into a DM ────────────────────────────────────────────
async function sendExamPreview(chatId: number | string, examId: string, telegramId: string) {
  const exam = await withRetry(() => prisma.exam.findUnique({ where: { id: examId } }));
  if (!exam || !exam.isPublished) {
    await tgCall("sendMessage", { chat_id: chatId, text: "❌ This exam is not available or has been unpublished." });
    return;
  }

  // Check if student completed already
  const existingCompleted = await withRetry(() => prisma.examResult.findFirst({
    where: { examId, telegramId, score: { gte: 0 } }
  }));
  if (existingCompleted) {
    await tgCall("sendMessage", {
      chat_id: chatId,
      text: `✅ You already completed <b>${escapeHtml(exam.title)}</b>.\n\n📊 Your final score: <b>${existingCompleted.score}%</b> (${existingCompleted.passed ? "PASSED" : "FAILED"})\n\n<i>Contact your instructor if you need to retake.</i>`,
      parse_mode: "HTML",
    });
    return;
  }

  // Check for in-progress session
  const inProgress = await withRetry(() => prisma.examResult.findFirst({
    where: { examId, telegramId, score: -1 }
  }));

  const questions = exam.questions as unknown as ExamQuestion[];
  const text = [
    `📋 <b>${escapeHtml(exam.title)}</b>`,
    exam.description ? `\n${escapeHtml(exam.description)}` : "",
    `\n\n📊 <b>${questions.length} question${questions.length !== 1 ? "s" : ""}</b>`,
    exam.timeLimit ? `\n⏱ <b>Time limit: ${Math.floor(exam.timeLimit / 60)} minutes</b>` : "",
    `\n✅ <b>Passing score: ${exam.passingScore}%</b>`,
    inProgress ? "\n\n⚠️ <i>You have an exam session in progress! Tap Resume to continue.</i>" : "\n\n👉 <i>Tap Begin to start — questions arrive one by one.</i>",
  ].filter(Boolean).join("");

  await tgCall("sendMessage", {
    chat_id: chatId,
    text,
    parse_mode: "HTML",
    reply_markup: {
      inline_keyboard: [[
        { text: inProgress ? "▶️ Resume Exam" : "🚀 Begin Exam", callback_data: `exam_begin:${examId}` },
        { text: "❌ Cancel", callback_data: `exam_cancel:${examId}` },
      ]],
    },
  });
}

// ─── Send one question ────────────────────────────────────────────────────────
async function sendQuestion(session: ExamSession, cbId?: string) {
  if (session.timeLimit) {
    const elapsed = Math.floor((Date.now() - session.startedAt) / 1000);
    if (elapsed >= session.timeLimit) {
      if (cbId) await ackCb(cbId, "⏰ Time's up!", true);
      await finishExam(session, true);
      return;
    }
  }

  const q     = session.questions[session.currentQ];
  const total = session.questions.length;
  const qNum  = session.currentQ + 1;

  // Visual progress bar normalized to 10 blocks
  const filled = Math.min(10, Math.max(1, Math.round((qNum / total) * 10)));
  const bar    = "▓".repeat(filled) + "░".repeat(10 - filled);

  // Remaining time indicator if limited
  let timeStr = "";
  if (session.timeLimit) {
    const remaining = Math.max(0, session.timeLimit - Math.floor((Date.now() - session.startedAt) / 1000));
    const mins = Math.floor(remaining / 60);
    const secs = remaining % 60;
    timeStr = ` · ⏱ ${mins}:${secs < 10 ? "0" : ""}${secs}`;
  }

  // Format options in message text so long options are never cut off
  const optionsList = q.options.map((opt, i) => `<b>${String.fromCharCode(65 + i)}.</b> ${escapeHtml(opt)}`).join("\n");

  const text = [
    `📋 <b>${escapeHtml(session.examTitle)}</b>`,
    `<code>${bar}</code> Question ${qNum}/${total}${timeStr}`,
    "",
    `<b>Q${qNum}. ${escapeHtml(q.question)}</b>`,
    "",
    optionsList,
  ].join("\n");

  // Format buttons: if all options are short (<= 25 chars), show full option; else 2x2 letter grid
  const allShort = q.options.every(o => o.length <= 25);
  const keyboard: Array<Array<{ text: string; callback_data: string }>> = [];

  if (allShort) {
    for (let i = 0; i < q.options.length; i++) {
      keyboard.push([{
        text: `${String.fromCharCode(65 + i)}. ${q.options[i]}`,
        callback_data: `exam_answer:${session.examId}:${session.currentQ}:${i}`,
      }]);
    }
  } else {
    let row: Array<{ text: string; callback_data: string }> = [];
    for (let i = 0; i < q.options.length; i++) {
      row.push({
        text: `${String.fromCharCode(65 + i)}`,
        callback_data: `exam_answer:${session.examId}:${session.currentQ}:${i}`,
      });
      if (row.length === 2 || i === q.options.length - 1) {
        keyboard.push([...row]);
        row = [];
      }
    }
  }

  if (cbId) await ackCb(cbId);

  await tgCall("editMessageText", {
    chat_id: session.chatId,
    message_id: session.msgId,
    text,
    parse_mode: "HTML",
    reply_markup: { inline_keyboard: keyboard },
  });
}

// ─── Finish exam ─────────────────────────────────────────────────────────────
async function finishExam(session: ExamSession, timedOut = false) {
  const { questions, answers, examId, passingScore, name, telegramId, chatId, msgId, startedAt, examTitle } = session;
  examSessions.delete(sessionKey(telegramId, examId));

  let correct = 0;
  const breakdown: string[] = [];
  questions.forEach((q, i) => {
    const chosen    = answers[i] ?? -1;
    const isCorrect = chosen === q.correctOptionId;
    if (isCorrect) correct++;
    const icon         = isCorrect ? "✅" : "❌";
    const chosenLabel  = chosen >= 0 ? `${String.fromCharCode(65 + chosen)}` : "None";
    const correctLabel = `${String.fromCharCode(65 + q.correctOptionId)}`;
    breakdown.push(`${icon} <b>Q${i + 1}:</b> Selected <b>${chosenLabel}</b> (Correct: <b>${correctLabel}</b>)`);
    if (!isCorrect && q.explanation) {
      breakdown.push(`   💡 <i>${escapeHtml(q.explanation)}</i>`);
    }
  });

  const score    = Math.round((correct / questions.length) * 100);
  const passed   = score >= passingScore;
  const duration = Math.floor((Date.now() - startedAt) / 1000);

  try {
    const existing = await withRetry(() => prisma.examResult.findFirst({ where: { examId, telegramId } }));
    if (existing) {
      await withRetry(() => prisma.examResult.update({
        where: { id: existing.id },
        data: { name, answers, score, passed, duration, completedAt: new Date() },
      }));
    } else {
      await withRetry(() => prisma.examResult.create({
        data: { examId, name, telegramId, answers, score, passed, duration, completedAt: new Date() },
      }));
    }
  } catch (e) {
    console.error("[exam] save result error:", e);
  }

  const icon = timedOut ? "⏰" : passed ? "🏆" : "📋";
  const header = [
    `${icon} <b>Exam Complete: ${escapeHtml(examTitle)}</b>`,
    "",
    timedOut ? "⏰ <i>Time ran out! Your answered questions were scored.</i>\n" : "",
    `<b>Score: ${score}% — ${passed ? "PASSED ✅" : "FAILED ❌"}</b>`,
    `Correct: <b>${correct}/${questions.length}</b> · Time: <b>${Math.floor(duration / 60)}m ${duration % 60}s</b>`,
    `Passing Requirement: <b>${passingScore}%</b>`,
    "",
    "─────────────────",
  ].join("\n");

  const fullText = [header, ...breakdown].join("\n");

  if (fullText.length <= 3800) {
    await tgCall("editMessageText", {
      chat_id: chatId,
      message_id: msgId,
      text: fullText,
      parse_mode: "HTML",
      reply_markup: { inline_keyboard: [] },
    });
  } else {
    await tgCall("editMessageText", {
      chat_id: chatId,
      message_id: msgId,
      text: header + "\n<i>Detailed question breakdown sent below:</i>",
      parse_mode: "HTML",
      reply_markup: { inline_keyboard: [] },
    });

    let chunk = "";
    for (const item of breakdown) {
      if ((chunk + "\n" + item).length > 3000) {
        await tgCall("sendMessage", { chat_id: chatId, text: chunk, parse_mode: "HTML" });
        chunk = item;
      } else {
        chunk = chunk ? chunk + "\n" + item : item;
      }
    }
    if (chunk) {
      await tgCall("sendMessage", { chat_id: chatId, text: chunk, parse_mode: "HTML" });
    }
  }
}

// ─── Callback handlers ────────────────────────────────────────────────────────

// exam_start:{examId}  — fired from the group "Start Exam" button (or fallback)
async function handleExamStart(cb: Record<string, unknown>, examId: string) {
  const user       = cb.from as Record<string, unknown>;
  const telegramId = String((user as { id: number }).id);
  const cbId       = cb.id as string;

  try {
    const exam = await withRetry(() => prisma.exam.findUnique({ where: { id: examId } }));
    if (!exam || !exam.isPublished) return ackCb(cbId, "This exam is not available.", true);

    const existing = await withRetry(() => prisma.examResult.findFirst({ where: { examId, telegramId, score: { gte: 0 } } }));
    if (existing) return ackCb(cbId, `You already completed this exam with ${existing.score}%.`, true);

    const cleanBotUsername = BOT_USERNAME.replace(/^@/, "");
    await tgCall("answerCallbackQuery", {
      callback_query_id: cbId,
      url: `https://t.me/${cleanBotUsername}?start=exam_${examId}`,
    });
  } catch (e) {
    console.error("[exam] handleExamStart:", e);
    await ackCb(cbId, "Something went wrong. Try again.", true);
  }
}

// exam_begin:{examId}  — fired from the DM "Begin Exam" button
async function handleExamBegin(cb: Record<string, unknown>, examId: string) {
  const user       = cb.from as Record<string, unknown>;
  const telegramId = String((user as { id: number }).id);
  const cbId       = cb.id as string;
  const chatId     = (cb.message as { chat: { id: number } }).chat.id;
  const msgId      = (cb.message as { message_id: number }).message_id;
  const firstName  = String((user as { first_name: string }).first_name || "Student");
  const lastName   = String((user as { last_name?: string }).last_name || "");
  const name       = [firstName, lastName].filter(Boolean).join(" ");

  try {
    const exam = await withRetry(() => prisma.exam.findUnique({ where: { id: examId } }));
    if (!exam || !exam.isPublished) return ackCb(cbId, "Exam not available.", true);

    const existing = await withRetry(() => prisma.examResult.findFirst({ where: { examId, telegramId, score: { gte: 0 } } }));
    if (existing) return ackCb(cbId, `You already completed this exam (${existing.score}%).`, true);

    const inProgress = await withRetry(() => prisma.examResult.findFirst({
      where: { examId, telegramId, score: -1 }
    }));

    let session: ExamSession;
    if (inProgress && inProgress.answers && typeof inProgress.answers === "object") {
      const data = inProgress.answers as Record<string, unknown>;
      session = {
        examId, examTitle: exam.title,
        chatId, msgId, name, telegramId,
        questions: exam.questions as unknown as ExamQuestion[],
        answers: (data.answers as Record<number, number>) || {},
        currentQ: Number(data.currentQ) || 0,
        startedAt: Number(data.startedAt) || Date.now(),
        timeLimit: exam.timeLimit,
        passingScore: exam.passingScore,
      };
    } else {
      session = {
        examId, examTitle: exam.title,
        chatId, msgId, name, telegramId,
        questions: exam.questions as unknown as ExamQuestion[],
        answers: {},
        currentQ: 0,
        startedAt: Date.now(),
        timeLimit: exam.timeLimit,
        passingScore: exam.passingScore,
      };

      await withRetry(() => prisma.examResult.create({
        data: {
          examId, name, telegramId,
          answers: { answers: {}, currentQ: 0, startedAt: session.startedAt, msgId, chatId },
          score: -1,
          passed: false,
          duration: null,
        },
      }));
    }

    examSessions.set(sessionKey(telegramId, examId), session);
    await sendQuestion(session, cbId);
  } catch (e) {
    console.error("[exam] handleExamBegin:", e);
    await ackCb(cbId, "Could not start exam. Try again.", true);
  }
}

// exam_answer:{examId}:{qIdx}:{optId}
async function handleExamAnswer(cb: Record<string, unknown>, examId: string, qIndex: number, optionId: number) {
  const user       = cb.from as Record<string, unknown>;
  const telegramId = String((user as { id: number }).id);
  const cbId       = cb.id as string;
  const key        = sessionKey(telegramId, examId);
  let session      = examSessions.get(key);

  // Recovery from database if memory was cleared or serverless cold start
  if (!session) {
    try {
      const inProgress = await withRetry(() => prisma.examResult.findFirst({
        where: { examId, telegramId, score: -1 },
        include: { exam: true },
      }));
      if (inProgress && inProgress.exam) {
        const data = (inProgress.answers as Record<string, unknown>) || {};
        session = {
          examId, examTitle: inProgress.exam.title,
          chatId: (cb.message as { chat: { id: number } }).chat.id,
          msgId: (cb.message as { message_id: number }).message_id,
          name: inProgress.name, telegramId,
          questions: inProgress.exam.questions as unknown as ExamQuestion[],
          answers: (data.answers as Record<number, number>) || {},
          currentQ: Number(data.currentQ) || 0,
          startedAt: Number(data.startedAt) || Date.now(),
          timeLimit: inProgress.exam.timeLimit,
          passingScore: inProgress.exam.passingScore,
        };
        examSessions.set(key, session);
      }
    } catch (e) {
      console.error("[exam] session recovery error:", e);
    }
  }

  if (!session) return ackCb(cbId, "Session expired. Please start the exam again.", true);

  // Time limit check BEFORE accepting answer
  if (session.timeLimit) {
    const elapsed = Math.floor((Date.now() - session.startedAt) / 1000);
    if (elapsed > session.timeLimit) {
      await ackCb(cbId, "⏰ Time's up!", true);
      await finishExam(session, true);
      return;
    }
  }

  // Double-click protection: silently ignore older clicks
  if (qIndex < session.currentQ) {
    return ackCb(cbId);
  }
  if (qIndex > session.currentQ) {
    return ackCb(cbId, "Please answer the current question.", true);
  }

  session.answers[qIndex] = optionId;
  session.currentQ++;

  // Save progress to database
  withRetry(() => prisma.examResult.updateMany({
    where: { examId, telegramId, score: -1 },
    data: {
      answers: {
        answers: session!.answers,
        currentQ: session!.currentQ,
        startedAt: session!.startedAt,
        msgId: session!.msgId,
        chatId: session!.chatId,
      },
    },
  })).catch(e => console.error("[exam] save progress error:", e));

  if (session.currentQ >= session.questions.length) {
    await finishExam(session);
  } else {
    await sendQuestion(session, cbId);
  }
}

// exam_cancel:{examId}
async function handleExamCancel(cb: Record<string, unknown>, examId: string) {
  const user       = cb.from as Record<string, unknown>;
  const telegramId = String((user as { id: number }).id);
  const cbId       = cb.id as string;
  examSessions.delete(sessionKey(telegramId, examId));
  prisma.examResult.deleteMany({ where: { examId, telegramId, score: -1 } }).catch(() => {});
  await ackCb(cbId, "Exam cancelled.", false);
  try {
    await tgCall("editMessageText", {
      chat_id: (cb.message as { chat: { id: number } }).chat.id,
      message_id: (cb.message as { message_id: number }).message_id,
      text: "❌ Exam cancelled.",
      reply_markup: { inline_keyboard: [] },
    });
  } catch { /* ignore */ }
}

// ─── Main handler ─────────────────────────────────────────────────────────────
export async function POST(req: NextRequest) {
  try {
    if (WEBHOOK_SECRET) {
      const secret = req.headers.get("x-telegram-bot-api-secret-token");
      if (secret !== WEBHOOK_SECRET) return NextResponse.json({ ok: false }, { status: 401 });
    }

    const update = await req.json();

    // ── Poll answer ──────────────────────────────────────────────────────────
    if (update.poll_answer) {
      const { poll_id, user, option_ids } = update.poll_answer;
      const quiz = await withRetry(() => prisma.quiz.findFirst({ where: { pollId: poll_id } }));
      if (quiz) {
        await withRetry(() => prisma.pollAnswer.upsert({
          where:  { quizId_telegramUserId: { quizId: quiz.id, telegramUserId: String(user.id) } },
          update: { optionIds: option_ids, answeredAt: new Date(), firstName: user.first_name, username: user.username },
          create: { quizId: quiz.id, telegramUserId: String(user.id), optionIds: option_ids, firstName: user.first_name, username: user.username },
        }));
      }
    }

    // ── Poll closed ──────────────────────────────────────────────────────────
    if (update.poll?.is_closed) {
      await prisma.quiz.updateMany({ where: { pollId: update.poll.id }, data: { pollClosed: true } }).catch(() => {});
    }

    // ── Message events ───────────────────────────────────────────────────────
    if (update.message) {
      const msg    = update.message;
      const chatId = String(msg.chat?.id);
      const text   = (msg.text || "") as string;

      // /start exam_{examId} or /start@BotUsername exam_{examId}
      const examStartMatch = text.trim().match(/^\/start(?:@\w+)?\s+exam_([a-zA-Z0-9_-]+)/);
      if (examStartMatch && msg.chat?.type === "private") {
        const examId = examStartMatch[1];
        if (examId) await sendExamPreview(msg.chat.id, examId, String(msg.from?.id));
      }

      // /cancel or /stop in private DM
      if ((text === "/cancel" || text === "/stop") && msg.chat?.type === "private") {
        const telegramId = String(msg.from?.id);
        for (const [key, session] of examSessions.entries()) {
          if (key.startsWith(`${telegramId}:`)) {
            examSessions.delete(key);
            prisma.examResult.deleteMany({ where: { examId: session.examId, telegramId, score: -1 } }).catch(() => {});
          }
        }
        await tgCall("sendMessage", { chat_id: msg.chat.id, text: "Active exam session cancelled." });
      }

      const resolveGroup = () => prisma.group.findFirst({
        where: { OR: [{ chatId }, { chatId: `-100${chatId.replace(/^-/, "")}` }] },
      });

      // In-chat forum topic sync command: /topic or /sync inside any thread
      const topicCmdMatch = text.trim().match(/^\/(?:topic|sync)(?:@\w+)?(?:\s+(.+))?$/i);
      if (topicCmdMatch && msg.message_thread_id) {
        const group = await resolveGroup();
        if (group) {
          const rawName = topicCmdMatch[1]?.trim();
          const topicName = rawName || `Topic #${msg.message_thread_id}`;

          await prisma.topic.upsert({
            where: { groupId_topicId: { groupId: group.id, topicId: msg.message_thread_id } },
            update: rawName ? { name: rawName } : {},
            create: {
              groupId: group.id,
              topicId: msg.message_thread_id,
              name: topicName,
              iconColor: 7322096,
              isClosed: false,
            },
          }).catch((e) => console.error("[webhook] /topic upsert error:", e));

          await tgCall("sendMessage", {
            chat_id: msg.chat.id,
            message_thread_id: msg.message_thread_id,
            text: `✅ <b>تم تسجيل هذا الموضوع في QuizForge بنجاح!</b>\n\n📌 <b>الاسم:</b> ${escapeHtml(topicName)}\n🆔 <b>المعرّف:</b> <code>#${msg.message_thread_id}</code>\n\n<i>الموضوع متاح الآن فوراً في لوحة التحكم وعند إرسال الكويزات والامتحانات.</i>`,
            parse_mode: "HTML",
          }).catch((e) => console.error("[webhook] /topic reply error:", e));
        }
      }

      if (msg.forum_topic_created && msg.message_thread_id) {
        const group = await resolveGroup();
        if (group) {
          await prisma.topic.upsert({
            where:  { groupId_topicId: { groupId: group.id, topicId: msg.message_thread_id } },
            update: { name: msg.forum_topic_created.name },
            create: {
              groupId: group.id, topicId: msg.message_thread_id,
              name: msg.forum_topic_created.name,
              iconColor: msg.forum_topic_created.icon_color || 0,
              iconCustomEmojiId: msg.forum_topic_created.icon_custom_emoji_id || null,
              isClosed: false,
            },
          }).catch(() => {});
        }
      }

      if (msg.forum_topic_edited && msg.message_thread_id) {
        const group = await resolveGroup();
        if (group) {
          const updateData: { name?: string; iconCustomEmojiId?: string } = {};
          if (msg.forum_topic_edited.name) updateData.name = msg.forum_topic_edited.name;
          if (msg.forum_topic_edited.icon_custom_emoji_id) updateData.iconCustomEmojiId = msg.forum_topic_edited.icon_custom_emoji_id;
          await prisma.topic.updateMany({
            where: { groupId: group.id, topicId: msg.message_thread_id },
            data: updateData,
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

    // ── Callback queries ─────────────────────────────────────────────────────
    if (update.callback_query) {
      const cb   = update.callback_query as Record<string, unknown>;
      const data = (cb.data as string) || "";

      if (data.startsWith("exam_start:")) {
        await handleExamStart(cb, data.slice("exam_start:".length));

      } else if (data.startsWith("exam_begin:")) {
        await handleExamBegin(cb, data.slice("exam_begin:".length));

      } else if (data.startsWith("exam_answer:")) {
        const parts = data.split(":");                      // ["exam_answer", examId, qIdx, optId]
        if (parts.length === 4) await handleExamAnswer(cb, parts[1], Number(parts[2]), Number(parts[3]));

      } else if (data.startsWith("exam_cancel:")) {
        await handleExamCancel(cb, data.slice("exam_cancel:".length));

      } else if (data === "exam_cancel") {
        await ackCb(cb.id as string, "Cancelled.", false);
      }
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("Webhook error:", err);
    return NextResponse.json({ ok: false }, { status: 500 });
  }
}
