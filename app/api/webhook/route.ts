import { NextRequest, NextResponse } from "next/server";
import { prisma, withRetry } from "@/lib/db";
import { Prisma } from "@prisma/client";
import { telegram } from "@/lib/telegram";
import {
  parseExamConfig,
  prepareStudentExamQuestions,
  mapStudentAnswersToMaster,
  type StudentExamQuestion,
  type MasterExamQuestion,
} from "@/lib/examConfig";
import { syncAnonymousPollAnswers, sendPollClosureSummary } from "@/lib/pollSync";
import {
  handleStudentQuizCommand,
  handleStudentQuizCallback,
} from "@/lib/studentQuizWizard";

const WEBHOOK_SECRET  = process.env.WEBHOOK_SECRET  || "";
const BOT_TOKEN       = process.env.TELEGRAM_BOT_TOKEN!;
let cachedBotUsername = (process.env.NEXT_PUBLIC_BOT_USERNAME || "").replace(/^@/, "");

async function getBotUsername(): Promise<string> {
  if (cachedBotUsername) return cachedBotUsername;
  try {
    const me = await telegram.getMe();
    if (me?.username) {
      cachedBotUsername = me.username.replace(/^@/, "");
      return cachedBotUsername;
    }
  } catch (e) {
    console.error("[telegram] getMe failed:", e);
  }
  return "";
}

// ─── Exam session store & persistent fallback ──────────────────────────────
interface ExamQuestion {
  question: string;
  options: string[];
  correctOptionId: number;
  explanation?: string;
  originalQIndex?: number;
  originalOptionIndices?: number[];
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
  let exam = await withRetry(() => prisma.exam.findUnique({ where: { id: examId } })).catch(() => null);
  if (!exam) {
    const stripped = examId.replace(/^exam[_-]/i, "");
    exam = await withRetry(() => prisma.exam.findUnique({ where: { id: stripped } })).catch(() => null);
  }

  if (!exam) {
    await tgCall("sendMessage", {
      chat_id: chatId,
      text: "❌ <b>عذراً، لم يتم العثور على هذا الاختبار.</b>\n\nتأكد من الرابط أو راجع مشرف المجموعة.",
      parse_mode: "HTML",
    });
    return;
  }

  if (!exam.isPublished) {
    await tgCall("sendMessage", {
      chat_id: chatId,
      text: `⏳ <b>الاختبار (${escapeHtml(exam.title)}) غير متاح حالياً.</b>\n\nلم يتم نشر هذا الاختبار بعد أو تم إيقافه مؤقتاً من قِبل المشرف.`,
      parse_mode: "HTML",
    });
    return;
  }

  // Check if student completed already
  const existingCompleted = await withRetry(() => prisma.examResult.findFirst({
    where: { examId: exam.id, telegramId, score: { gte: 0 } }
  }));
  if (existingCompleted) {
    await tgCall("sendMessage", {
      chat_id: chatId,
      text: `✅ <b>لقد أكملت اختبار ${escapeHtml(exam.title)} مسبقاً.</b>\n\n📊 درجتك النهائية: <b>${existingCompleted.score}%</b> (${existingCompleted.passed ? "ناجح ✅" : "راسب ❌"})\n\n<i>تواصل مع معلمك أو مشرف المادة إذا كنت بحاجة لإعادة الاختبار.</i>`,
      parse_mode: "HTML",
    });
    return;
  }

  // Check for in-progress session
  const inProgress = await withRetry(() => prisma.examResult.findFirst({
    where: { examId: exam.id, telegramId, score: -1 }
  }));

  const cfg = parseExamConfig(exam.description);
  const questions = (Array.isArray(exam.questions) ? exam.questions : []) as unknown as ExamQuestion[];
  if (questions.length === 0) {
    await tgCall("sendMessage", {
      chat_id: chatId,
      text: "⚠️ هذا الاختبار لا يحتوي على أي أسئلة حالياً.",
    });
    return;
  }

  const text = [
    `📋 <b>${escapeHtml(exam.title)}</b>`,
    cfg.cleanDescription ? `\n${escapeHtml(cfg.cleanDescription)}` : "",
    `\n\n📊 <b>${questions.length} أسئلة</b>`,
    exam.timeLimit ? `\n⏱ <b>المدة الزمنية: ${Math.floor(exam.timeLimit / 60)} دقيقة</b>` : "",
    `\n✅ <b>درجة النجاح: ${exam.passingScore}%</b>`,
    cfg.shuffleQuestions || cfg.shuffleOptions ? `\n🛡 <b>مكافحة الغش: ترتيب عشوائي للأسئلة والخيارات</b>` : "",
    inProgress ? "\n\n⚠️ <i>لديك جلسة امتحان جارية! اضغط على استئناف للمتابعة.</i>" : "\n\n👉 <i>اضغط على زر البدء أدناه لبدء الاختبار — تصلك الأسئلة سؤالاً تلو الآخر.</i>",
  ].filter(Boolean).join("");

  await tgCall("sendMessage", {
    chat_id: chatId,
    text,
    parse_mode: "HTML",
    reply_markup: {
      inline_keyboard: [[
        { text: inProgress ? "▶️ استئناف الامتحان (Resume)" : "🚀 بدء الامتحان (Begin)", callback_data: `exam_begin:${exam.id}` },
        { text: "❌ إلغاء", callback_data: `exam_cancel:${exam.id}` },
      ]],
    },
  });
}

// ─── Send one question ────────────────────────────────────────────────────────
async function sendQuestion(session: ExamSession, cbId?: string) {
  if (session.timeLimit) {
    const elapsed = Math.floor((Date.now() - session.startedAt) / 1000);
    if (elapsed >= session.timeLimit) {
      if (cbId) await ackCb(cbId, "⏰ انتهى الوقت المحدد!", true);
      await finishExam(session, true);
      return;
    }
  }

  const q = session.questions[session.currentQ];
  const total = session.questions.length;
  if (!q || session.currentQ >= total) {
    await finishExam(session);
    return;
  }

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
  const optionsList = (q.options || []).map((opt, i) => `<b>${String.fromCharCode(65 + i)}.</b> ${escapeHtml(opt)}`).join("\n");

  const text = [
    `📋 <b>${escapeHtml(session.examTitle)}</b>`,
    `<code>${bar}</code> السؤال ${qNum}/${total}${timeStr}`,
    "",
    `<b>س${qNum}: ${escapeHtml(q.question)}</b>`,
    "",
    optionsList,
  ].join("\n");

  // Format buttons: if all options are short (<= 25 chars), show full option; else 2x2 letter grid
  const allShort = (q.options || []).every(o => o.length <= 25);
  const keyboard: Array<Array<{ text: string; callback_data: string }>> = [];

  if (allShort) {
    for (let i = 0; i < (q.options || []).length; i++) {
      keyboard.push([{
        text: `${String.fromCharCode(65 + i)}. ${q.options[i]}`,
        callback_data: `exam_answer:${session.examId}:${session.currentQ}:${i}`,
      }]);
    }
  } else {
    let row: Array<{ text: string; callback_data: string }> = [];
    for (let i = 0; i < (q.options || []).length; i++) {
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

  try {
    const res = await tgCall("editMessageText", {
      chat_id: session.chatId,
      message_id: session.msgId,
      text,
      parse_mode: "HTML",
      reply_markup: { inline_keyboard: keyboard },
    });
    if (!res || (res as any).ok === false) {
      const sendRes = await tgCall("sendMessage", {
        chat_id: session.chatId,
        text,
        parse_mode: "HTML",
        reply_markup: { inline_keyboard: keyboard },
      });
      if (sendRes?.result && typeof sendRes.result === "object" && "message_id" in sendRes.result) {
        session.msgId = (sendRes.result as { message_id: number }).message_id;
      }
    }
  } catch {
    const sendRes = await tgCall("sendMessage", {
      chat_id: session.chatId,
      text,
      parse_mode: "HTML",
      reply_markup: { inline_keyboard: keyboard },
    }).catch(() => null);
    if (sendRes?.result && typeof sendRes.result === "object" && "message_id" in sendRes.result) {
      session.msgId = (sendRes.result as { message_id: number }).message_id;
    }
  }
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
    const chosenLabel  = chosen >= 0 ? `${String.fromCharCode(65 + chosen)}` : "لا توجد إجابة";
    const correctLabel = `${String.fromCharCode(65 + q.correctOptionId)}`;
    breakdown.push(`${icon} <b>س${i + 1}:</b> إجابتك: <b>${chosenLabel}</b> (الصحيحة: <b>${correctLabel}</b>)`);
    if (!isCorrect && q.explanation) {
      breakdown.push(`   💡 <i>${escapeHtml(q.explanation)}</i>`);
    }
  });

  const totalQuestions = Math.max(1, questions.length);
  const score    = Math.round((correct / totalQuestions) * 100);
  const passed   = score >= passingScore;
  const duration = Math.max(1, Math.floor((Date.now() - startedAt) / 1000));

  // Map student answers back to master question and option indices so teacher analytics align perfectly
  const masterAnswers = mapStudentAnswersToMaster(questions as unknown as StudentExamQuestion[], answers);

  try {
    const existing = await withRetry(() => prisma.examResult.findFirst({ where: { examId, telegramId } }));
    if (existing) {
      await withRetry(() => prisma.examResult.update({
        where: { id: existing.id },
        data: { name, answers: masterAnswers, score, passed, duration, completedAt: new Date() },
      }));
    } else {
      await withRetry(() => prisma.examResult.create({
        data: { examId, name, telegramId, answers: masterAnswers, score, passed, duration, completedAt: new Date() },
      }));
    }
  } catch (e) {
    console.error("[exam] save result error:", e);
  }

  const icon = timedOut ? "⏰" : passed ? "🏆" : "📋";
  const header = [
    `${icon} <b>اكتمل الامتحان: ${escapeHtml(examTitle)}</b>`,
    "",
    timedOut ? "⏰ <i>انتهى الوقت المحدد للاختبار! تم احتساب الأسئلة المجاب عليها فقط.</i>\n" : "",
    `<b>الدرجة النهائية: ${score}% — ${passed ? "ناجح ✅" : "راسب ❌"}</b>`,
    `الإجابات الصحيحة: <b>${correct}/${questions.length}</b> · الوقت المستغرق: <b>${Math.floor(duration / 60)}د ${duration % 60}ث</b>`,
    `الحد الأدنى للنجاح: <b>${passingScore}%</b>`,
    "",
    "─────────────────",
  ].join("\n");

  const fullText = [header, ...breakdown].join("\n");

  try {
    if (fullText.length <= 3800) {
      const res = await tgCall("editMessageText", {
        chat_id: chatId,
        message_id: msgId,
        text: fullText,
        parse_mode: "HTML",
        reply_markup: { inline_keyboard: [] },
      });
      if (!res || (res as any).ok === false) {
        await tgCall("sendMessage", { chat_id: chatId, text: fullText, parse_mode: "HTML" });
      }
    } else {
      await tgCall("editMessageText", {
        chat_id: chatId,
        message_id: msgId,
        text: header + "\n<i>تفاصيل الأسئلة مرسلة أدناه:</i>",
        parse_mode: "HTML",
        reply_markup: { inline_keyboard: [] },
      }).catch(() => {});

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
  } catch (err) {
    console.error("[exam] finishExam message send error:", err);
    await tgCall("sendMessage", { chat_id: chatId, text: fullText.slice(0, 3800), parse_mode: "HTML" }).catch(() => {});
  }
}

// ─── Callback handlers ────────────────────────────────────────────────────────

// exam_start:{examId}  — fired from the group "Start Exam" button (or fallback)
async function handleExamStart(cb: Record<string, unknown>, examId: string) {
  const user       = cb.from as Record<string, unknown>;
  const telegramId = String((user as { id: number }).id);
  const cbId       = cb.id as string;

  try {
    let exam = await withRetry(() => prisma.exam.findUnique({ where: { id: examId } })).catch(() => null);
    if (!exam) {
      exam = await withRetry(() => prisma.exam.findUnique({ where: { id: examId.replace(/^exam[_-]/i, "") } })).catch(() => null);
    }
    if (!exam || !exam.isPublished) return ackCb(cbId, "هذا الاختبار غير متاح حالياً.", true);

    const existing = await withRetry(() => prisma.examResult.findFirst({ where: { examId: exam.id, telegramId, score: { gte: 0 } } }));
    if (existing) return ackCb(cbId, `لقد أتممت هذا الاختبار مسبقاً بدرجة ${existing.score}%.`, true);

    const botUser = await getBotUsername();
    if (botUser) {
      await tgCall("answerCallbackQuery", {
        callback_query_id: cbId,
        url: `https://t.me/${botUser}?start=exam_${exam.id}`,
      });
    } else {
      await ackCb(cbId, "تم تجهيز الامتحان! يرجى فتح محادثة البوت للبدء.", true);
      await sendExamPreview((user as { id: number }).id, exam.id, telegramId);
    }
  } catch (e) {
    console.error("[exam] handleExamStart:", e);
    await ackCb(cbId, "حدث خطأ ما، يرجى المحاولة لاحقاً.", true);
  }
}

// exam_begin:{examId}  — fired from the DM "Begin Exam" button
async function handleExamBegin(cb: Record<string, unknown>, examId: string) {
  const user       = cb.from as Record<string, unknown>;
  const telegramId = String((user as { id: number }).id);
  const cbId       = cb.id as string;
  const chatId     = (cb.message as { chat: { id: number } }).chat.id;
  const msgId      = (cb.message as { message_id: number }).message_id;
  const firstName  = String((user as { first_name: string }).first_name || "طالب");
  const lastName   = String((user as { last_name?: string }).last_name || "");
  const name       = [firstName, lastName].filter(Boolean).join(" ");

  try {
    let exam = await withRetry(() => prisma.exam.findUnique({ where: { id: examId } })).catch(() => null);
    if (!exam) {
      exam = await withRetry(() => prisma.exam.findUnique({ where: { id: examId.replace(/^exam[_-]/i, "") } })).catch(() => null);
    }
    if (!exam || !exam.isPublished) return ackCb(cbId, "هذا الاختبار غير متاح.", true);

    const existing = await withRetry(() => prisma.examResult.findFirst({ where: { examId: exam.id, telegramId, score: { gte: 0 } } }));
    if (existing) return ackCb(cbId, `لقد أتممت هذا الاختبار مسبقاً (${existing.score}%).`, true);

    const inProgress = await withRetry(() => prisma.examResult.findFirst({
      where: { examId: exam.id, telegramId, score: -1 }
    }));

    let session: ExamSession;
    if (inProgress && inProgress.answers && typeof inProgress.answers === "object") {
      const data = inProgress.answers as Record<string, unknown>;
      session = {
        examId: exam.id,
        examTitle: exam.title,
        chatId, msgId, name, telegramId,
        questions: (data.questions as unknown as ExamQuestion[]) || (exam.questions as unknown as ExamQuestion[]),
        answers: (data.answers as Record<number, number>) || {},
        currentQ: Number(data.currentQ) || 0,
        startedAt: Number(data.startedAt) || Date.now(),
        timeLimit: exam.timeLimit,
        passingScore: exam.passingScore,
      };
    } else {
      const cfg = parseExamConfig(exam.description);
      const studentQuestions = prepareStudentExamQuestions(
        exam.questions as unknown as MasterExamQuestion[],
        cfg
      );

      session = {
        examId: exam.id,
        examTitle: exam.title,
        chatId, msgId, name, telegramId,
        questions: studentQuestions as unknown as ExamQuestion[],
        answers: {},
        currentQ: 0,
        startedAt: Date.now(),
        timeLimit: exam.timeLimit,
        passingScore: exam.passingScore,
      };

      await withRetry(() => prisma.examResult.create({
        data: {
          examId: exam.id, name, telegramId,
          answers: { answers: {}, questions: studentQuestions, currentQ: 0, startedAt: session.startedAt, msgId, chatId } as unknown as Prisma.InputJsonValue,
          score: -1,
          passed: false,
          duration: null,
        },
      }));
    }

    examSessions.set(sessionKey(telegramId, exam.id), session);
    await sendQuestion(session, cbId);
  } catch (e) {
    console.error("[exam] handleExamBegin:", e);
    await ackCb(cbId, "تعذر بدء الاختبار. يرجى المحاولة مجدداً.", true);
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
      let inProgress = await withRetry(() => prisma.examResult.findFirst({
        where: { examId, telegramId, score: -1 },
        include: { exam: true },
      }));
      if (!inProgress) {
        const stripped = examId.replace(/^exam[_-]/i, "");
        inProgress = await withRetry(() => prisma.examResult.findFirst({
          where: { examId: stripped, telegramId, score: -1 },
          include: { exam: true },
        }));
      }
      if (inProgress && inProgress.exam) {
        const data = (inProgress.answers as Record<string, unknown>) || {};
        session = {
          examId: inProgress.examId,
          examTitle: inProgress.exam.title,
          chatId: (cb.message as { chat: { id: number } }).chat.id,
          msgId: (cb.message as { message_id: number }).message_id,
          name: inProgress.name, telegramId,
          questions: (data.questions as unknown as ExamQuestion[]) || (inProgress.exam.questions as unknown as ExamQuestion[]),
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

  if (!session) return ackCb(cbId, "انتهت صلاحية الجلسة. يرجى بدء الامتحان من جديد.", true);

  // Time limit check BEFORE accepting answer
  if (session.timeLimit) {
    const elapsed = Math.floor((Date.now() - session.startedAt) / 1000);
    if (elapsed > session.timeLimit) {
      await ackCb(cbId, "⏰ انتهى الوقت المحدد!", true);
      await finishExam(session, true);
      return;
    }
  }

  // Double-click protection: silently ignore older clicks
  if (qIndex < session.currentQ) {
    return ackCb(cbId);
  }
  if (qIndex > session.currentQ) {
    return ackCb(cbId, "يرجى الإجابة على السؤال الحالي أولاً.", true);
  }

  session.answers[qIndex] = optionId;
  session.currentQ++;

  // Save progress to database
  withRetry(() => prisma.examResult.updateMany({
    where: { examId: session!.examId, telegramId, score: -1 },
    data: {
      answers: {
        answers: session!.answers,
        questions: session!.questions,
        currentQ: session!.currentQ,
        startedAt: session!.startedAt,
        msgId: session!.msgId,
        chatId: session!.chatId,
      } as unknown as Prisma.InputJsonValue,
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
  prisma.examResult.deleteMany({
    where: {
      OR: [
        { examId, telegramId, score: -1 },
        { examId: examId.replace(/^exam[_-]/i, ""), telegramId, score: -1 }
      ]
    }
  }).catch(() => {});
  await ackCb(cbId, "تم إلغاء جلسة الامتحان.", false);
  try {
    await tgCall("editMessageText", {
      chat_id: (cb.message as { chat: { id: number } }).chat.id,
      message_id: (cb.message as { message_id: number }).message_id,
      text: "❌ <b>تم إلغاء الاختبار.</b> يمكنك بدؤه في أي وقت لاحق من المجموعة.",
      parse_mode: "HTML",
      reply_markup: { inline_keyboard: [] },
    });
  } catch { /* ignore */ }
}

// ─── Diagnostic GET Endpoint ──────────────────────────────────────────────────
export async function GET(req: NextRequest) {
  try {
    const url = new URL(req.url);
    const host = req.headers.get("host") || "";
    const protocol = req.headers.get("x-forwarded-proto") || "https";
    const currentBaseUrl = `${protocol}://${host}`;
    const webhookUrl = `${currentBaseUrl}/api/webhook`;

    if (url.searchParams.get("sync") === "1" || url.searchParams.get("setup") === "1") {
      const secret = process.env.WEBHOOK_SECRET || "";
      const setRes = await telegram.setWebhook(webhookUrl, secret || undefined);
      const info = await telegram.getWebhookInfo();
      return NextResponse.json({
        ok: true,
        message: "Webhook updated successfully",
        webhookUrl,
        setResult: setRes,
        telegramInfo: info,
      });
    }

    const info = await telegram.getWebhookInfo().catch((err: any) => ({ error: err?.message || String(err) }));
    const botUser = await getBotUsername();

    return NextResponse.json({
      ok: true,
      service: "QuizForge Telegram Webhook",
      botUsername: botUser,
      currentUrl: webhookUrl,
      telegramWebhookInfo: info,
      hint: "To re-register this webhook URL directly with Telegram, open this URL with ?sync=1",
    });
  } catch (err: any) {
    return NextResponse.json({ ok: false, error: err?.message }, { status: 500 });
  }
}

// ─── Main handler ─────────────────────────────────────────────────────────────
export async function POST(req: NextRequest) {
  try {
    // ── Secret token verification ───────────────────────────────────────────
    const secretHeader = req.headers.get("x-telegram-bot-api-secret-token");
    if (WEBHOOK_SECRET && secretHeader && secretHeader !== WEBHOOK_SECRET) {
      // Check if it matches any group botConfig webhookSecret in DB before rejecting
      const matchingConfig = await prisma.botConfig.findFirst({
        where: { webhookSecret: secretHeader },
      }).catch(() => null);

      if (!matchingConfig) {
        console.warn("[webhook] Secret token mismatch:", secretHeader);
        return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
      }
    }

    const update = await req.json();

    // ── Poll answer (for non-anonymous polls) ────────────────────────────────
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

    // ── Poll state & anonymous votes sync (real-time for both types) ─────────
    if (update.poll) {
      const poll = update.poll;
      const quiz = await withRetry(() =>
        prisma.quiz.findFirst({
          where: { pollId: poll.id },
          include: { group: true },
        })
      );

      if (quiz) {
        const wasClosed = quiz.pollClosed;

        // If poll is closed now, update in DB
        if (poll.is_closed && !wasClosed) {
          await withRetry(() =>
            prisma.quiz.update({
              where: { id: quiz.id },
              data: { pollClosed: true },
            })
          ).catch(() => {});
        }

        // If anonymous, sync the aggregated option votes into poll_answers
        if (poll.is_anonymous && Array.isArray(poll.options)) {
          await syncAnonymousPollAnswers(quiz.id, poll.options, poll.total_voter_count || 0);
        }

        // If poll just transitioned to closed, send a polite closing summary
        if (poll.is_closed && !wasClosed && (poll.total_voter_count || 0) > 0) {
          await sendPollClosureSummary(quiz, poll);
        }
      }
    }

    // ── Message events ───────────────────────────────────────────────────────
    if (update.message) {
      const msg    = update.message;
      const chatId = String(msg.chat?.id);
      const text   = (msg.text || "") as string;

      // 1. /start in private chat (supports /start exam_{id}, /start {id}, or plain /start)
      if (msg.chat?.type === "private" && (text.trim().startsWith("/start") || text.trim() === "ابدأ" || text.trim() === "بداية")) {
        const examStartMatch = text.trim().match(/^\/start(?:@\w+)?(?:\s+(?:exam[_-])?([a-zA-Z0-9_-]+))?/i);
        const rawExamId = examStartMatch?.[1]?.trim();

        if (rawExamId && rawExamId.toLowerCase() !== "start") {
          const cleanExamId = rawExamId.replace(/^exam[_-]/i, "");
          await sendExamPreview(msg.chat.id, cleanExamId, String(msg.from?.id));
        } else {
          // General /start greeting in private DM
          const recentExams = await withRetry(() => prisma.exam.findMany({
            where: { isPublished: true },
            take: 5,
            orderBy: { createdAt: "desc" },
            include: { group: { select: { title: true } } },
          })).catch(() => []);

          const examButtons = recentExams.map(e => ([{
            text: `📝 ${e.title} (${e.group.title})`,
            callback_data: `exam_start:${e.id}`,
          }]));

          const welcomeText = [
            `👋 <b>أهلاً بك في AgriCult Bot! 🎓</b>`,
            ``,
            `أنا بوت الامتحانات والمراجعات الذكية لمجتمع <b>AgriCult</b>.`,
            ``,
            `🚀 <b>لبدء أي اختبار:</b>`,
            `اضغط على زر <b>🚀 Start Exam</b> في مجموعتك الدراسية، وسيفتح الامتحان هنا مباشرة بسؤال تلو الآخر مع مؤقت فوري ونتيجتك فور الانتهاء.`,
            recentExams.length > 0 ? `\n📌 <b>أو اختر مباشرة من الاختبارات المتاحة حالياً:</b>` : "",
          ].filter(Boolean).join("\n");

          await tgCall("sendMessage", {
            chat_id: msg.chat.id,
            text: welcomeText,
            parse_mode: "HTML",
            reply_markup: examButtons.length > 0 ? { inline_keyboard: examButtons } : undefined,
          });
        }
      }

      // 2. /help in private chat
      if (msg.chat?.type === "private" && (text.trim().toLowerCase() === "/help" || text.trim() === "مساعدة")) {
        await tgCall("sendMessage", {
          chat_id: msg.chat.id,
          text: `ℹ️ <b>دليل استخدام AgriCult Bot</b>\n\n` +
            `🎯 <b>الامتحانات المجدولة:</b>\n` +
            `اضغط على زر <b>🚀 Start Exam</b> في مجموعتك الدراسية لبدء الامتحان هنا على انفراد.\n\n` +
            `🧠 <b>المراجعة الذكية (/qs):</b>\n` +
            `اكتب <code>/qs</code> لاختيار المادة وتوليد أسئلة تفاعلية ذكية بناءً على المنهج الدراسي الفعلي.\n\n` +
            `📊 <b>الخصوصية والنتائج:</b>\n` +
            `إجاباتك في الامتحانات سرية وتصل مباشرة لمعلم المادة في لوحة التحكم.\n\n` +
            `لإلغاء أي جلسة امتحان حالية اكتب <code>/cancel</code>.`,
          parse_mode: "HTML",
        });
      }

      // 3. /settings in private chat
      if (msg.chat?.type === "private" && text.trim().toLowerCase().startsWith("/settings")) {
        await tgCall("sendMessage", {
          chat_id: msg.chat.id,
          text: `⚙️ <b>إعدادات AgriCult Bot</b>\n\n` +
            `يتم التحكم في الاختبارات وإعدادات المجموعات وبنك الأسئلة من خلال <b>لوحة تحكم QuizForge</b> الخاصة بالمشرفين والمعلمين.\n\n` +
            `إذا كنت طالباً، يمكنك بدء الامتحانات عبر مجموعات المواد الدراسية، أو استخدام أمر <code>/qs</code> للتدريب والمراجعة.`,
          parse_mode: "HTML",
        });
      }

      // 4. /cancel or /stop in private DM
      if ((text === "/cancel" || text === "/stop" || text === "إلغاء") && msg.chat?.type === "private") {
        const telegramId = String(msg.from?.id);
        for (const [key, session] of examSessions.entries()) {
          if (key.startsWith(`${telegramId}:`)) {
            examSessions.delete(key);
            prisma.examResult.deleteMany({
              where: {
                OR: [
                  { examId: session.examId, telegramId, score: -1 },
                  { examId: session.examId.replace(/^exam[_-]/i, ""), telegramId, score: -1 }
                ]
              }
            }).catch(() => {});
          }
        }
        await tgCall("sendMessage", { chat_id: msg.chat.id, text: "❌ تم إلغاء جلسة الامتحان الحالية بنجاح." });
      }

      const resolveGroup = async () => {
        let grp = await prisma.group.findFirst({
          where: { OR: [{ chatId }, { chatId: `-100${chatId.replace(/^-/, "")}` }] },
        });

        // If in private DM with bot and chatId didn't match a group chatId:
        if (!grp && msg.chat?.type === "private" && msg.from?.id) {
          const telegramId = String(msg.from.id);

          // 1. Try finding group via User's memberships
          try {
            const membership = await prisma.groupMember.findFirst({
              where: {
                user: {
                  OR: [
                    { telegramId },
                    ...(msg.from.username ? [{ username: msg.from.username }] : []),
                  ],
                },
              },
              include: { group: true },
              orderBy: { joinedAt: "desc" },
            });
            if (membership?.group) {
              grp = membership.group;
            }
          } catch {}

          // 2. Try finding group via student's recent poll answers
          if (!grp) {
            try {
              const pollAns = await prisma.pollAnswer.findFirst({
                where: { telegramUserId: telegramId },
                include: { quiz: { include: { group: true } } },
                orderBy: { answeredAt: "desc" },
              });
              if (pollAns?.quiz?.group) {
                grp = pollAns.quiz.group;
              }
            } catch {}
          }

          // 3. Try finding group via student's recent exam results
          if (!grp) {
            try {
              const examRes = await prisma.examResult.findFirst({
                where: { telegramId },
                orderBy: { completedAt: "desc" },
              });
              if (examRes?.examId) {
                const examObj = await prisma.exam.findUnique({
                  where: { id: examRes.examId },
                  include: { group: true },
                });
                if (examObj?.group) {
                  grp = examObj.group;
                }
              }
            } catch {}
          }

          // 4. Try finding group that has uploaded curriculum materials in DB
          if (!grp) {
            try {
              const matRows = await prisma.$queryRawUnsafe<any[]>(
                `SELECT group_id FROM ai_curriculum_materials ORDER BY updated_at DESC LIMIT 1`
              );
              if (matRows?.[0]?.group_id) {
                grp = await prisma.group.findUnique({ where: { id: matRows[0].group_id } });
              }
            } catch {}
          }

          // 5. If only 1 group exists in system, bind to it
          if (!grp) {
            try {
              const totalGroups = await prisma.group.count();
              if (totalGroups === 1) {
                grp = await prisma.group.findFirst();
              }
            } catch {}
          }
        }

        return grp;
      };

      // Interactive student curriculum quiz generator command: /qs, /boost, /quiz or with @BotUsername and optional arguments
      const qsCmdMatch = text.trim().match(/^[/!](qs|boost|quiz)(?:@\w+)?(?:\s+(.*))?$/i);
      if (qsCmdMatch) {
        const commandName = qsCmdMatch[1].toLowerCase();
        const rawArgs = qsCmdMatch[2]?.trim() || "";
        const group = await resolveGroup();
        await handleStudentQuizCommand({
          chatId: msg.chat.id,
          userId: String(msg.from?.id || ""),
          userName: [msg.from?.first_name, msg.from?.last_name].filter(Boolean).join(" ") || msg.from?.username || "طالب",
          userUsername: msg.from?.username || undefined,
          messageId: msg.message_id,
          messageThreadId: msg.message_thread_id || undefined,
          groupId: group?.id || undefined,
          groupTitle: group?.title || msg.chat?.title || undefined,
          commandName,
          rawArgs,
        });
      }

      // In-chat /stats or /status command
      const statsCmdMatch = text.trim().match(/^\/(?:stats|quizstats|status)(?:@\w+)?$/i);
      if (statsCmdMatch) {
        const group = await resolveGroup();
        if (group) {
          const [totalQuizzes, totalAnswers, correctCount] = await Promise.all([
            withRetry(() => prisma.quiz.count({ where: { groupId: group.id, sentAt: { not: null } } })),
            withRetry(() => prisma.pollAnswer.count({ where: { quiz: { groupId: group.id } } })),
            withRetry(() =>
              prisma.pollAnswer.count({
                where: {
                  quiz: { groupId: group.id, type: "QUIZ", correctOptionId: { not: null } },
                  optionIds: { isEmpty: false },
                },
              })
            ),
          ]);

          const overallRate = totalAnswers > 0 ? Math.round((correctCount / totalAnswers) * 100) : 0;

          const statsMsg =
            `📊 <b>إحصائيات الكويزات في هذه المجموعة:</b>\n\n` +
            `🎯 <b>إجمالي الكويزات المرسلة:</b> ${totalQuizzes}\n` +
            `📝 <b>إجمالي إجابات الطلاب:</b> ${totalAnswers} (بما فيها الكويزات المجهولة 🔒)\n` +
            `📈 <b>معدل النجاح العام:</b> ${overallRate}%\n\n` +
            `🔒 <i>نظام خصوصية الطلاب مفعّل: يمكن للجميع الإجابة والمحاولة بأمان دون أي حرج من الخطأ.</i>`;

          await tgCall("sendMessage", {
            chat_id: msg.chat.id,
            message_thread_id: msg.message_thread_id || undefined,
            reply_to_message_id: msg.message_id || undefined,
            text: statsMsg,
            parse_mode: "HTML",
          }).catch((e) => console.error("[webhook] /stats error:", e));
        }
      }

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

      if (data.startsWith("qs_")) {
        const handled = await handleStudentQuizCallback(cb);
        if (handled) return NextResponse.json({ ok: true });
      }

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
        await ackCb(cb.id as string, "تم الإلغاء.", false);
      }
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("Webhook error:", err);
    return NextResponse.json({ ok: false }, { status: 500 });
  }
}
