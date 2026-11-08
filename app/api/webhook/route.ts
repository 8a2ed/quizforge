import { ensureFeedbackTable, notifyAdminsFeedback } from "@/lib/feedback";
import { NextRequest, NextResponse } from "next/server";
import { prisma, withRetry } from "@/lib/db";
import { Prisma } from "@prisma/client";
import { telegram } from "@/lib/telegram";
import {
  parseExamConfig,
  extractStudentMasterAnswers,
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
import {
  checkAndExpireExamSessions,
  startExamExpiryWatcher,
  examSessions,
  sessionKey,
} from "@/lib/examExpiry";

// Start background watcher for long-running Node environments
startExamExpiryWatcher(25_000);

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
  imageUrl?: string;
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
  lastActiveAt?: number;
  warnedAt?: number | null;
  timeLimit: number | null;
  passingScore: number;
}

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

  const cfg = parseExamConfig(exam.description);
  if (cfg.isPaused) {
    await tgCall("sendMessage", {
      chat_id: chatId,
      text: `⏸ <b>الاختبار متوقف مؤقتاً: (${escapeHtml(exam.title)})</b>\n\n⚠️ عذراً، تم إيقاف هذا الاختبار مؤقتاً بواسطة المعلم.\nيرجى التواصل مع المعلم أو المحاولة في وقت لاحق.`,
      parse_mode: "HTML",
    });
    return;
  }
  const maxAttempts = cfg.maxAttempts ?? 1;

  // Check completed attempts
  const completedAttempts = await withRetry(() => prisma.examResult.findMany({
    where: { examId: exam.id, telegramId, score: { gte: 0 } },
    orderBy: { score: "desc" },
  }));
  const attemptCount = completedAttempts.length;

  // Check for in-progress session
  const inProgress = await withRetry(() => prisma.examResult.findFirst({
    where: { examId: exam.id, telegramId, score: -1 }
  }));

  if (!inProgress && maxAttempts > 0 && attemptCount >= maxAttempts) {
    const bestScore = completedAttempts[0]?.score ?? 0;
    const reviewKeyboard = cfg.showSolutionsImmediately !== false
      ? [[{ text: "📖 مراجعة الأسئلة والإجابات النموذجية", callback_data: `exam_review:${exam.id}:0` }]]
      : [];

    await tgCall("sendMessage", {
      chat_id: chatId,
      text: `✅ <b>لقد استنفدت جميع محاولاتك المتاحة لاختبار (${escapeHtml(exam.title)}).</b>\n\n🔢 المحاولات المكتملة: <b>${attemptCount} من ${maxAttempts}</b>\n🏆 أفضل درجة حققتها: <b>${bestScore}%</b> (${bestScore >= exam.passingScore ? "ناجح ✅" : "راسب ❌"})\n\n<i>تواصل مع معلمك أو مشرف المادة إذا كنت بحاجة لإعادة تعيين المحاولات.</i>`,
      parse_mode: "HTML",
      reply_markup: { inline_keyboard: reviewKeyboard },
    });
    return;
  }

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
    maxAttempts === 1 ? "" : `\n🔄 <b>المحاولات المسموحة: ${maxAttempts === 0 ? "غير محدود" : maxAttempts}</b> (المحاولة الحالية: <b>${attemptCount + 1}</b>${attemptCount > 0 ? ` · أفضل درجة سابقة: <b>${completedAttempts[0]?.score}%</b>` : ""})`,
    cfg.shuffleQuestions || cfg.shuffleOptions ? `\n🛡 <b>مكافحة الغش: ترتيب عشوائي للأسئلة والخيارات</b>` : "",
    inProgress ? "\n\n⚠️ <i>لديك جلسة امتحان جارية! اضغط على استئناف للمتابعة.</i>" : "\n\n👉 <i>اضغط على زر البدء أدناه لبدء الاختبار — تصلك الأسئلة سؤالاً تلو الآخر.</i>",
  ].filter(Boolean).join("");

  await tgCall("sendMessage", {
    chat_id: chatId,
    text,
    parse_mode: "HTML",
    reply_markup: {
      inline_keyboard: [[
        { text: inProgress ? "▶️ استئناف الامتحان (Resume)" : (attemptCount > 0 ? `🚀 بدء المحاولة ${attemptCount + 1}` : "🚀 بدء الامتحان (Begin)"), callback_data: `exam_begin:${exam.id}` },
        { text: "❌ إلغاء", callback_data: `exam_cancel:${exam.id}` },
      ]],
    },
  });
}

// ── Universal Photo & Message sender for Exam Questions & Reviews ────────────
async function tgSendPhotoOrMessage(
  chatId: number | string,
  imageUrl: string | undefined | null,
  text: string,
  keyboard: Array<Array<{ text: string; callback_data: string }>>,
  prevMsgId?: number | null
): Promise<number | null> {
  const reply_markup = { inline_keyboard: keyboard };
  const hasImage = Boolean(imageUrl && String(imageUrl).trim());

  if (hasImage) {
    const cleanPhoto = String(imageUrl).trim();
    // In Telegram, photo caption max length is 1024 characters
    const caption = text.length <= 1020 ? text : text.slice(0, 1017) + "...";

    // Delete previous message so chat stays clean and seamless
    if (prevMsgId) {
      await tgCall("deleteMessage", { chat_id: chatId, message_id: prevMsgId }).catch(() => {});
    }

    if (cleanPhoto.startsWith("data:")) {
      try {
        const [header, base64Data] = cleanPhoto.split(",");
        const mime = header.match(/:(.*?);/)?.[1] || "image/jpeg";
        const buffer = Buffer.from(base64Data, "base64");
        const ext = mime.split("/")[1] || "jpg";
        const blob = new Blob([buffer], { type: mime });
        const form = new FormData();
        form.append("chat_id", String(chatId));
        form.append("photo", blob, `question_image.${ext}`);
        form.append("caption", caption);
        form.append("parse_mode", "HTML");
        form.append("reply_markup", JSON.stringify(reply_markup));

        const ac = new AbortController();
        const t = setTimeout(() => ac.abort(), 20_000);
        try {
          const res = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendPhoto`, {
            method: "POST",
            body: form,
            signal: ac.signal,
          });
          const data = await res.json();
          if (data?.ok && data?.result?.message_id) {
            return data.result.message_id;
          }
          console.warn("[tgSendPhotoOrMessage] base64 sendPhoto failed:", data);
        } finally {
          clearTimeout(t);
        }
      } catch (err) {
        console.error("[tgSendPhotoOrMessage] base64 upload error:", err);
      }
    } else {
      // Direct HTTP/HTTPS image URL
      try {
        const res = await tgCall("sendPhoto", {
          chat_id: chatId,
          photo: cleanPhoto,
          caption,
          parse_mode: "HTML",
          reply_markup,
        });
        if (res?.ok && (res.result as any)?.message_id) {
          return (res.result as any).message_id;
        }
        console.warn("[tgSendPhotoOrMessage] url sendPhoto failed:", res);
      } catch (err) {
        console.error("[tgSendPhotoOrMessage] url sendPhoto error:", err);
      }
    }
  }

  // Fallback or text-only question
  if (prevMsgId) {
    const editRes = await tgCall("editMessageText", {
      chat_id: chatId,
      message_id: prevMsgId,
      text,
      parse_mode: "HTML",
      reply_markup,
    }).catch(() => null);

    if (editRes && (editRes as any).ok !== false) {
      return prevMsgId;
    }
    // If edit failed (e.g. previous was a photo), delete previous and send fresh text message
    await tgCall("deleteMessage", { chat_id: chatId, message_id: prevMsgId }).catch(() => {});
  }

  const sendRes = await tgCall("sendMessage", {
    chat_id: chatId,
    text,
    parse_mode: "HTML",
    reply_markup,
  }).catch(() => null);

  if (sendRes?.result && typeof sendRes.result === "object" && "message_id" in sendRes.result) {
    return (sendRes.result as { message_id: number }).message_id;
  }
  return null;
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

  const newMsgId = await tgSendPhotoOrMessage(
    session.chatId,
    q.imageUrl,
    text,
    keyboard,
    session.msgId
  );
  if (newMsgId) {
    session.msgId = newMsgId;
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
  const passed   = !timedOut && score >= passingScore && (score > 0 || passingScore === 0);
  const duration = Math.max(1, Math.floor((Date.now() - startedAt) / 1000));

  // Map student answers back to master question and option indices so teacher analytics align perfectly
  const masterAnswers = mapStudentAnswersToMaster(questions as unknown as StudentExamQuestion[], answers);

  try {
    const existingInProgress = await withRetry(() => prisma.examResult.findFirst({
      where: {
        OR: [
          { examId, telegramId, score: -1 },
          { examId: examId.replace(/^exam[_-]/i, ""), telegramId, score: -1 }
        ]
      }
    }));
    if (existingInProgress) {
      await withRetry(() => prisma.examResult.update({
        where: { id: existingInProgress.id },
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

  // Check exam config for solutions review and max attempts
  let allowSolutions = true;
  let maxAttempts = 1;
  try {
    const examRec = await withRetry(() => prisma.exam.findUnique({ where: { id: examId }, select: { description: true } }));
    if (examRec) {
      const cfg = parseExamConfig(examRec.description);
      allowSolutions = cfg.showSolutionsImmediately !== false;
      maxAttempts = cfg.maxAttempts ?? 1;
    }
  } catch {}

  const completedAttemptsCount = await withRetry(() => prisma.examResult.count({
    where: { examId, telegramId, score: { gte: 0 } }
  })).catch(() => 1);

  const hasMoreAttempts = maxAttempts === 0 || completedAttemptsCount < maxAttempts;
  const remainingAttempts = maxAttempts === 0 ? "غير محدود" : Math.max(0, maxAttempts - completedAttemptsCount);

  const attemptNote = maxAttempts === 1
    ? ""
    : hasMoreAttempts
    ? `\n🔄 <b>المحاولات:</b> أنجزت ${completedAttemptsCount} من ${maxAttempts === 0 ? "غير محدود" : maxAttempts} (متبقي لك <b>${remainingAttempts}</b> محاولة).`
    : `\n🏁 <b>المحاولات:</b> استنفدت جميع محاولاتك (${maxAttempts}/${maxAttempts}).`;

  const icon = timedOut ? "⏰" : passed ? "🏆" : "📋";
  const header = [
    `${icon} <b>اكتمل الامتحان: ${escapeHtml(examTitle)}</b>`,
    "",
    timedOut ? "⏰ <i>انتهى الوقت المحدد للاختبار! تم احتساب الأسئلة المجاب عليها فقط.</i>\n" : "",
    `<b>الدرجة النهائية: ${score}% — ${passed ? "ناجح ✅" : "راسب ❌"}</b>`,
    `الإجابات الصحيحة: <b>${correct}/${questions.length}</b> · الوقت المستغرق: <b>${Math.floor(duration / 60)}د ${duration % 60}ث</b>`,
    `الحد الأدنى للنجاح: <b>${passingScore}%</b>`,
    attemptNote,
    "",
    allowSolutions
      ? "👉 <i>اضغط على الزر بالأسفل لمراجعة كل سؤال مع إجابتك والإجابة النموذجية والشرح الكامل:</i>"
      : "🔒 <i>ملاحظة: سيتم إتاحة مراجعة الأسئلة والإجابات والشرح بعد انتهاء وقت الاختبار بالكامل.</i>",
  ].filter(Boolean).join("\n");

  const reviewKeyboard: Array<Array<{ text: string; callback_data: string }>> = [];
  if (allowSolutions) {
    reviewKeyboard.push([
      {
        text: "📖 مراجعة الأسئلة والإجابات النموذجية",
        callback_data: `exam_review:${examId}:0`,
      },
    ]);
  }
  if (hasMoreAttempts) {
    reviewKeyboard.push([
      {
        text: `🔄 إعادة الاختبار (محاولة ${completedAttemptsCount + 1}/${maxAttempts === 0 ? "∞" : maxAttempts})`,
        callback_data: `exam_begin:${examId}`,
      },
    ]);
  }

  // ⭐ Optional Feedback / Rating Button
  let rateBtnText = "⭐ تقييم التجربة ومشاركة اقتراح (اختياري)";
  try {
    await ensureFeedbackTable();
    const existingFeedback = await withRetry(() => prisma.examFeedback.findFirst({
      where: {
        OR: [
          { examId, telegramId },
          { examId: examId.replace(/^exam[_-]/i, ""), telegramId },
        ],
      },
      select: { rating: true },
    })).catch(() => null);
    if (existingFeedback) {
      rateBtnText = `⭐ تقييمك: ${existingFeedback.rating}/10 (تعديل)`;
    }
  } catch {}

  reviewKeyboard.push([
    {
      text: rateBtnText,
      callback_data: `exam_rate_open:${examId}`,
    },
  ]);

  try {
    const res = await tgCall("editMessageText", {
      chat_id: chatId,
      message_id: msgId,
      text: header,
      parse_mode: "HTML",
      reply_markup: { inline_keyboard: reviewKeyboard },
    });
    if (!res || (res as any).ok === false) {
      if (msgId) await tgCall("deleteMessage", { chat_id: chatId, message_id: msgId }).catch(() => {});
      await tgCall("sendMessage", {
        chat_id: chatId,
        text: header,
        parse_mode: "HTML",
        reply_markup: { inline_keyboard: reviewKeyboard },
      });
    }
  } catch (err) {
    console.error("[exam] finishExam message send error:", err);
    if (msgId) await tgCall("deleteMessage", { chat_id: chatId, message_id: msgId }).catch(() => {});
    await tgCall("sendMessage", {
      chat_id: chatId,
      text: header,
      parse_mode: "HTML",
      reply_markup: { inline_keyboard: reviewKeyboard },
    }).catch(() => {});
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

    const cfg = parseExamConfig(exam.description);
    if (cfg.isPaused) {
      return ackCb(cbId, "⚠️ هذا الاختبار متوقف مؤقتاً حالياً بقرار من المعلم.", true);
    }
    const maxAttempts = cfg.maxAttempts ?? 1;

    const completedAttempts = await withRetry(() => prisma.examResult.findMany({
      where: { examId: exam.id, telegramId, score: { gte: 0 } },
      orderBy: { score: "desc" },
    }));
    const attemptCount = completedAttempts.length;

    if (maxAttempts > 0 && attemptCount >= maxAttempts) {
      const best = completedAttempts[0]?.score ?? 0;
      return ackCb(cbId, `لقد استنفدت جميع محاولاتك (${attemptCount}/${maxAttempts}). أفضل درجة: ${best}%.`, true);
    }

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

    const cfg = parseExamConfig(exam.description);
    if (cfg.isPaused) {
      return ackCb(cbId, "⚠️ تم إيقاف هذا الاختبار مؤقتاً بواسطة المعلم.", true);
    }
    const maxAttempts = cfg.maxAttempts ?? 1;

    const inProgress = await withRetry(() => prisma.examResult.findFirst({
      where: { examId: exam.id, telegramId, score: -1 }
    }));

    if (!inProgress) {
      const completedAttempts = await withRetry(() => prisma.examResult.findMany({
        where: { examId: exam.id, telegramId, score: { gte: 0 } },
        orderBy: { score: "desc" },
      }));
      const attemptCount = completedAttempts.length;

      if (maxAttempts > 0 && attemptCount >= maxAttempts) {
        return ackCb(cbId, `عذراً، لقد استنفدت الحد الأقصى للمحاولات المسموحة (${maxAttempts}).`, true);
      }
    }

    let session: ExamSession;
    if (inProgress && inProgress.answers && typeof inProgress.answers === "object") {
      const data = inProgress.answers as Record<string, unknown>;
      const savedAnswers = (data.answers as Record<number, number>) || {};
      const maxAnsweredIdx = Object.keys(savedAnswers).reduce((max, k) => {
        const n = Number(k);
        return isNaN(n) ? max : Math.max(max, n);
      }, -1);
      const currentQ = Math.max(Number(data.currentQ) || 0, maxAnsweredIdx + 1);

      session = {
        examId: exam.id,
        examTitle: exam.title,
        chatId, msgId, name, telegramId,
        questions: (data.questions as unknown as ExamQuestion[]) || (exam.questions as unknown as ExamQuestion[]),
        answers: savedAnswers,
        currentQ,
        startedAt: Number(data.startedAt) || Date.now(),
        lastActiveAt: Date.now(),
        warnedAt: null,
        timeLimit: exam.timeLimit,
        passingScore: exam.passingScore,
      };

      // Reset activity and clear warning in database
      await withRetry(() => prisma.examResult.updateMany({
        where: {
          OR: [
            { examId: exam.id, telegramId, score: -1 },
            { examId: exam.id.replace(/^exam[_-]/i, ""), telegramId, score: -1 }
          ]
        },
        data: {
          answers: {
            ...data,
            currentQ: session.currentQ,
            lastActiveAt: session.lastActiveAt,
            warnedAt: null,
            msgId,
            chatId,
          } as unknown as Prisma.InputJsonValue,
        },
      })).catch(() => {});
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
        lastActiveAt: Date.now(),
        warnedAt: null,
        timeLimit: exam.timeLimit,
        passingScore: exam.passingScore,
      };

      await withRetry(() => prisma.examResult.create({
        data: {
          examId: exam.id, name, telegramId,
          answers: {
            answers: {},
            questions: studentQuestions,
            currentQ: 0,
            startedAt: session.startedAt,
            lastActiveAt: session.lastActiveAt,
            warnedAt: null,
            msgId,
            chatId
          } as unknown as Prisma.InputJsonValue,
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
        const savedAnswers = (data.answers as Record<number, number>) || {};
        const maxAnsweredIdx = Object.keys(savedAnswers).reduce((max, k) => {
          const n = Number(k);
          return isNaN(n) ? max : Math.max(max, n);
        }, -1);
        const currentQ = Math.max(Number(data.currentQ) || 0, maxAnsweredIdx + 1);

        session = {
          examId: inProgress.examId,
          examTitle: inProgress.exam.title,
          chatId: (cb.message as { chat: { id: number } }).chat.id,
          msgId: (cb.message as { message_id: number }).message_id,
          name: inProgress.name, telegramId,
          questions: (data.questions as unknown as ExamQuestion[]) || (inProgress.exam.questions as unknown as ExamQuestion[]),
          answers: savedAnswers,
          currentQ,
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

  // Double-click protection: silently ignore clicks on already answered questions
  if (qIndex < session.currentQ) {
    return ackCb(cbId);
  }

  // Record answer and advance currentQ safely without desync traps
  session.answers[qIndex] = optionId;
  session.currentQ = Math.max(session.currentQ + 1, qIndex + 1);
  session.lastActiveAt = Date.now();
  session.warnedAt = null;

  if (session.currentQ >= session.questions.length) {
    await ackCb(cbId);
    await finishExam(session);
  } else {
    // Save in-progress progress ONLY while exam is active to prevent race with finishExam
    // ALWAYS await updateMany to ensure state is committed before serverless freeze
    await withRetry(() => prisma.examResult.updateMany({
      where: {
        OR: [
          { examId: session!.examId, telegramId, score: -1 },
          { examId: session!.examId.replace(/^exam[_-]/i, ""), telegramId, score: -1 }
        ]
      },
      data: {
        answers: {
          answers: session!.answers,
          questions: session!.questions,
          currentQ: session!.currentQ,
          startedAt: session!.startedAt,
          lastActiveAt: session!.lastActiveAt,
          warnedAt: null,
          msgId: session!.msgId,
          chatId: session!.chatId,
        } as unknown as Prisma.InputJsonValue,
      },
    })).catch(e => console.error("[exam] save progress error:", e));

    await sendQuestion(session, cbId);
  }
}

// exam_cancel:{examId}


// ─── Exam Review & Pagination Handlers ───────────────────────────────────────
// exam_review:{examId}:{qIdx} — Paginated review of questions, answers, and explanations
async function handleExamReview(cb: Record<string, unknown>, examId: string, qIdx: number) {
  const user = cb.from as Record<string, unknown>;
  const telegramId = String((user as { id: number }).id);
  const cbId = cb.id as string;
  const chatId = (cb.message as { chat?: { id: number } })?.chat?.id || (user as { id: number }).id;
  const msgId = (cb.message as { message_id?: number })?.message_id;

  try {
    let exam = await withRetry(() => prisma.exam.findUnique({ where: { id: examId } })).catch(() => null);
    if (!exam) {
      exam = await withRetry(() => prisma.exam.findUnique({ where: { id: examId.replace(/^exam[_-]/i, "") } })).catch(() => null);
    }
    if (!exam) return ackCb(cbId, "الاختبار غير موجود.", true);

    const result = await withRetry(() => prisma.examResult.findFirst({
      where: { examId: exam!.id, telegramId, score: { gte: 0 } },
    }));
    if (!result) return ackCb(cbId, "لم يتم العثور على نتيجة سابقة لهذا الاختبار.", true);

    const cfg = parseExamConfig(exam.description);
    if (cfg.showSolutionsImmediately === false) {
      return ackCb(cbId, "🔒 مراجعة الأسئلة محجوبة حالياً من قبل مشرف المادة.", true);
    }

    const rawQuestions = Array.isArray(exam.questions) ? exam.questions : [];
    const totalQ = rawQuestions.length;
    if (totalQ === 0) return ackCb(cbId, "لا توجد أسئلة في هذا الاختبار.", true);

    const safeQIdx = Math.max(0, Math.min(totalQ - 1, qIdx));
    const q = rawQuestions[safeQIdx] as unknown as MasterExamQuestion;

    const masterAnswers = extractStudentMasterAnswers(result.answers, rawQuestions as any);
    const studentChoice = masterAnswers[String(safeQIdx)] ?? masterAnswers[safeQIdx];
    const isAnswered = studentChoice !== undefined && studentChoice !== null && !isNaN(Number(studentChoice));
    const isCorrect = isAnswered && Number(studentChoice) === q.correctOptionId;

    // Build options with indicators
    const optionsText = (q.options || []).map((opt, optIdx) => {
      const letter = String.fromCharCode(65 + optIdx);
      const isStudentChoice = isAnswered && Number(studentChoice) === optIdx;
      const isCorrectOpt = optIdx === q.correctOptionId;

      if (isStudentChoice && isCorrectOpt) {
        return `✅ <b>${letter}. ${escapeHtml(opt)}</b> <i>(إجابتك الصحيحة)</i>`;
      } else if (isStudentChoice && !isCorrectOpt) {
        return `❌ <b>${letter}. ${escapeHtml(opt)}</b> <i>(إجابتك الخاطئة)</i>`;
      } else if (isCorrectOpt) {
        return `✅ <b>${letter}. ${escapeHtml(opt)}</b> <i>(الإجابة النموذجية الصحيحة)</i>`;
      } else {
        return `<b>${letter}.</b> ${escapeHtml(opt)}`;
      }
    }).join("\n");

    const answerStatusText = !isAnswered
      ? "⚠️ <i>لم يتم اختيار إجابة لهذا السؤال أثناء الاختبار.</i>"
      : isCorrect
      ? "✅ <b>إجابتك صحيحة وممتازة!</b>"
      : "❌ <b>إجابتك غير صحيحة.</b>";

    const textLines = [
      `📖 <b>مراجعة: ${escapeHtml(exam.title)}</b>`,
      `<code>━━━━━━━━━━━━━━━━━━━━</code>`,
      `السؤال <b>${safeQIdx + 1}</b> من <b>${totalQ}</b> · ${isCorrect ? "✅ صحيحة" : isAnswered ? "❌ خاطئة" : "⚠️ لم يُجب"}`,
      "",
      `<b>س${safeQIdx + 1}: ${escapeHtml(q.question)}</b>`,
      "",
      optionsText,
      "",
      answerStatusText,
    ];

    if (q.explanation && String(q.explanation).trim()) {
      textLines.push("", `💡 <b>الشرح والتوضيح:</b>`, `<i>${escapeHtml(String(q.explanation).trim())}</i>`);
    }

    const reviewText = textLines.join("\n");

    // Pagination navigation row
    const navRow: Array<{ text: string; callback_data: string }> = [];
    if (safeQIdx > 0) {
      navRow.push({ text: "⬅️ السابق", callback_data: `exam_review:${exam.id}:${safeQIdx - 1}` });
    }
    navRow.push({ text: `${safeQIdx + 1} / ${totalQ}`, callback_data: "exam_review_noop" });
    if (safeQIdx < totalQ - 1) {
      navRow.push({ text: "التالي ➡️", callback_data: `exam_review:${exam.id}:${safeQIdx + 1}` });
    }

    const keyboard = [
      navRow,
      [
        { text: "📊 العودة لملخص النتيجة", callback_data: `exam_summary:${exam.id}` },
      ],
    ];

    await ackCb(cbId);

    if (msgId) {
      await tgSendPhotoOrMessage(
        chatId,
        q.imageUrl,
        reviewText,
        keyboard,
        msgId
      );
    }
  } catch (err) {
    console.error("[exam] handleExamReview error:", err);
    await ackCb(cbId, "تعذر تحميل المراجعة حالياً.", true);
  }
}

// exam_summary:{examId} — Re-displays the final exam summary card
async function handleExamReviewSummary(cb: Record<string, unknown>, examId: string) {
  const user = cb.from as Record<string, unknown>;
  const telegramId = String((user as { id: number }).id);
  const cbId = cb.id as string;
  const chatId = (cb.message as { chat?: { id: number } })?.chat?.id || (user as { id: number }).id;
  const msgId = (cb.message as { message_id?: number })?.message_id;

  try {
    let exam = await withRetry(() => prisma.exam.findUnique({ where: { id: examId } })).catch(() => null);
    if (!exam) {
      exam = await withRetry(() => prisma.exam.findUnique({ where: { id: examId.replace(/^exam[_-]/i, "") } })).catch(() => null);
    }
    if (!exam) return ackCb(cbId, "الاختبار غير موجود.", true);

    const result = await withRetry(() => prisma.examResult.findFirst({
      where: { examId: exam!.id, telegramId, score: { gte: 0 } },
    }));
    if (!result) return ackCb(cbId, "لا توجد نتيجة مسجلة.", true);

    const cfg = parseExamConfig(exam.description);
    const allowSolutions = cfg.showSolutionsImmediately !== false;
    const totalQ = Array.isArray(exam.questions) ? exam.questions.length : 0;
    const correct = Math.round((result.score / 100) * Math.max(1, totalQ));

    const durStr = result.duration ? `${Math.floor(result.duration / 60)}د ${result.duration % 60}ث` : "غير محدد";

    const text = [
      `${result.passed ? "🏆" : "📋"} <b>ملخص نتيجتك: ${escapeHtml(exam.title)}</b>`,
      "",
      `<b>الدرجة النهائية: ${result.score}% — ${result.passed ? "ناجح ✅" : "راسب ❌"}</b>`,
      `الإجابات الصحيحة: <b>${correct}/${totalQ}</b> · الوقت المستغرق: <b>${durStr}</b>`,
      `الحد الأدنى للنجاح: <b>${exam.passingScore}%</b>`,
      "",
      allowSolutions
        ? "👉 <i>يمكنك استعراض ومراجعة كل سؤال مع إجابتك والشرح النموذجي الكامل:</i>"
        : "🔒 <i>ملاحظة: مراجعة الأسئلة محجوبة حالياً.</i>",
    ].join("\n");

    const keyboard = allowSolutions
      ? [
          [
            {
              text: "📖 مراجعة الأسئلة والإجابات النموذجية",
              callback_data: `exam_review:${exam.id}:0`,
            },
          ],
        ]
      : [];

    // ⭐ Optional Feedback Button in Summary
    let rateBtnText = "⭐ تقييم التجربة ومشاركة اقتراح (اختياري)";
    try {
      await ensureFeedbackTable();
      const existingFeedback = await withRetry(() => prisma.examFeedback.findFirst({
        where: {
          OR: [
            { examId: exam.id, telegramId },
            { examId: exam.id.replace(/^exam[_-]/i, ""), telegramId },
          ],
        },
        select: { rating: true },
      })).catch(() => null);
      if (existingFeedback) {
        rateBtnText = `⭐ تقييمك: ${existingFeedback.rating}/10 (تعديل)`;
      }
    } catch {}

    keyboard.push([
      {
        text: rateBtnText,
        callback_data: `exam_rate_open:${exam.id}`,
      },
    ]);

    await ackCb(cbId);

    if (msgId) {
      const editRes = await tgCall("editMessageText", {
        chat_id: chatId,
        message_id: msgId,
        text,
        parse_mode: "HTML",
        reply_markup: { inline_keyboard: keyboard },
      }).catch(() => null);

      if (!editRes || (editRes as any).ok === false) {
        await tgCall("deleteMessage", { chat_id: chatId, message_id: msgId }).catch(() => {});
        await tgCall("sendMessage", {
          chat_id: chatId,
          text,
          parse_mode: "HTML",
          reply_markup: { inline_keyboard: keyboard },
        }).catch(() => {});
      }
    }
  } catch (err) {
    console.error("[exam] handleExamReviewSummary error:", err);
    await ackCb(cbId, "تعذر عرض الملخص.", true);
  }
}


// ─── Exam Rating & Feedback Handlers ─────────────────────────────────────────

// exam_rate_open:{examId} — Open rating scale (1..10)
async function handleExamRateOpen(cb: Record<string, unknown>, examId: string) {
  const user = cb.from as Record<string, unknown>;
  const telegramId = String((user as { id: number }).id);
  const cbId = cb.id as string;
  const chatId = (cb.message as { chat?: { id: number } })?.chat?.id || (user as { id: number }).id;
  const msgId = (cb.message as { message_id?: number })?.message_id;

  try {
    await ensureFeedbackTable();
    let exam = await withRetry(() => prisma.exam.findUnique({ where: { id: examId } })).catch(() => null);
    if (!exam) {
      exam = await withRetry(() => prisma.exam.findUnique({ where: { id: examId.replace(/^exam[_-]/i, "") } })).catch(() => null);
    }
    if (!exam) return ackCb(cbId, "الاختبار غير موجود.", true);

    const existingFeedback = await withRetry(() => prisma.examFeedback.findFirst({
      where: {
        OR: [
          { examId: exam!.id, telegramId },
          { examId: exam!.id.replace(/^exam[_-]/i, ""), telegramId },
        ],
      },
      select: { rating: true },
    })).catch(() => null);

    const ratingNote = existingFeedback
      ? `\n📌 <i>تقييمك الحالي المسجل: <b>${existingFeedback.rating}/10</b> ⭐</i>\n`
      : "";

    const text = [
      `⭐ <b>تقييم تجربة الاختبار وتطوير البوت</b>`,
      ``,
      `📋 <b>الاختبار:</b> ${escapeHtml(exam.title)}`,
      ratingNote,
      `رأيك مهم جداً بالنسبة لنا لتطوير النظام وتحسين جودة الأسئلة والسرعة.`,
      `يرجى اختيار تقييمك العام من <b>1 إلى 10</b>:`,
    ].join("\n");

    const row1 = [1, 2, 3, 4, 5].map(n => ({
      text: `${n} ⭐`,
      callback_data: `exam_rate_pick:${exam!.id}:${n}`,
    }));
    const row2 = [6, 7, 8, 9].map(n => ({
      text: `${n} ⭐`,
      callback_data: `exam_rate_pick:${exam!.id}:${n}`,
    }));
    row2.push({
      text: `10 🌟`,
      callback_data: `exam_rate_pick:${exam!.id}:10`,
    });

    const keyboard = [
      row1,
      row2,
      [
        {
          text: "🔙 إلغاء والعودة لنتيجة الاختبار",
          callback_data: `exam_summary:${exam!.id}`,
        },
      ],
    ];

    await ackCb(cbId);

    if (msgId) {
      await tgCall("editMessageText", {
        chat_id: chatId,
        message_id: msgId,
        text,
        parse_mode: "HTML",
        reply_markup: { inline_keyboard: keyboard },
      }).catch(async () => {
        await tgCall("sendMessage", {
          chat_id: chatId,
          text,
          parse_mode: "HTML",
          reply_markup: { inline_keyboard: keyboard },
        });
      });
    }
  } catch (err) {
    console.error("[exam] handleExamRateOpen error:", err);
    await ackCb(cbId, "حدث خطأ ما، يرجى المحاولة لاحقاً.", true);
  }
}

// exam_rate_pick:{examId}:{rating} — Save rating, prompt for optional suggestion
async function handleExamRatePick(cb: Record<string, unknown>, examId: string, rating: number) {
  const user = cb.from as Record<string, unknown>;
  const telegramId = String((user as { id: number }).id);
  const cbId = cb.id as string;
  const chatId = (cb.message as { chat?: { id: number } })?.chat?.id || (user as { id: number }).id;
  const msgId = (cb.message as { message_id?: number })?.message_id;

  const firstName = String((user as { first_name?: string }).first_name || "طالب");
  const lastName = String((user as { last_name?: string }).last_name || "");
  const name = [firstName, lastName].filter(Boolean).join(" ");
  const username = (user as { username?: string }).username || null;

  try {
    await ensureFeedbackTable();
    let exam = await withRetry(() => prisma.exam.findUnique({
      where: { id: examId },
      include: { group: true, createdBy: true },
    })).catch(() => null);

    if (!exam) {
      exam = await withRetry(() => prisma.exam.findUnique({
        where: { id: examId.replace(/^exam[_-]/i, "") },
        include: { group: true, createdBy: true },
      })).catch(() => null);
    }

    if (!exam) return ackCb(cbId, "الاختبار غير موجود.", true);

    const safeRating = Math.min(10, Math.max(1, rating));

    // Upsert feedback
    await withRetry(() => prisma.examFeedback.upsert({
      where: {
        examId_telegramId: {
          examId: exam!.id,
          telegramId,
        },
      },
      update: {
        rating: safeRating,
        name,
        username,
        groupId: exam!.groupId,
        updatedAt: new Date(),
      },
      create: {
        examId: exam!.id,
        groupId: exam!.groupId,
        telegramId,
        name,
        username,
        rating: safeRating,
      },
    }));

    // Notify admins / teacher
    notifyAdminsFeedback({
      examId: exam.id,
      examTitle: exam.title,
      groupTitle: exam.group?.title,
      groupId: exam.groupId,
      studentName: name,
      username,
      rating: safeRating,
      teacherTelegramId: exam.createdBy?.telegramId,
    }).catch(() => {});

    await ackCb(cbId, `تم تسجيل تقييمك (${safeRating}/10) ⭐ شكراً لك!`);

    const stars = "⭐".repeat(Math.min(10, safeRating));
    const text = [
      `🌟 <b>شكراً جزيلاً لتقييمك! (${safeRating}/10) ${stars}</b>`,
      ``,
      `تم حفظ تقييمك بنجاح.`,
      ``,
      `💡 <b>هل لديك أي اقتراح أو فكرة لتطوير البوت أو تحسين تجربة الاختبارات؟</b>`,
      `أرسل اقتراحك الآن في <b>رسالة نصية مباشرة</b> وسيقوم المشرفون بمراجعته والعمل به فوراً 🚀`,
      ``,
      `<i>(هذه الخطوة اختيارية تماماً — يمكنك الضغط على «تخطي» للعودة لنتيجة الامتحان فوراً)</i>`,
    ].join("\n");

    const keyboard = [
      [
        {
          text: "⏭️ تخطي والعودة لنتيجة الامتحان",
          callback_data: `exam_summary:${exam.id}`,
        },
      ],
    ];

    if (msgId) {
      await tgCall("editMessageText", {
        chat_id: chatId,
        message_id: msgId,
        text,
        parse_mode: "HTML",
        reply_markup: { inline_keyboard: keyboard },
      }).catch(async () => {
        await tgCall("sendMessage", {
          chat_id: chatId,
          text,
          parse_mode: "HTML",
          reply_markup: { inline_keyboard: keyboard },
        });
      });
    }
  } catch (err) {
    console.error("[exam] handleExamRatePick error:", err);
    await ackCb(cbId, "حدث خطأ أثناء حفظ التقييم.", true);
  }
}

// exam_resume:{examId} — fired when user clicks "متابعة الاختبار" on inactivity warning
async function handleExamResume(cb: Record<string, unknown>, examId: string) {
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
        const savedAnswers = (data.answers as Record<number, number>) || {};
        const maxAnsweredIdx = Object.keys(savedAnswers).reduce((max, k) => {
          const n = Number(k);
          return isNaN(n) ? max : Math.max(max, n);
        }, -1);
        const currentQ = Math.max(Number(data.currentQ) || 0, maxAnsweredIdx + 1);

        session = {
          examId: inProgress.examId,
          examTitle: inProgress.exam.title,
          chatId: Number(data.chatId) || (cb.message as { chat?: { id: number } })?.chat?.id || (user as { id: number }).id,
          msgId: Number(data.msgId) || (cb.message as { message_id?: number })?.message_id || 0,
          name: inProgress.name,
          telegramId,
          questions: (data.questions as unknown as ExamQuestion[]) || (inProgress.exam.questions as unknown as ExamQuestion[]),
          answers: savedAnswers,
          currentQ,
          startedAt: Number(data.startedAt) || Date.now(),
          lastActiveAt: Date.now(),
          warnedAt: null,
          timeLimit: inProgress.exam.timeLimit,
          passingScore: inProgress.exam.passingScore,
        };
        examSessions.set(key, session);
      }
    } catch (e) {
      console.error("[exam] session recovery error in handleExamResume:", e);
    }
  }

  if (!session) {
    return ackCb(cbId, "⚠️ لا توجد جلسة اختبار نشطة حالياً، أو انتهى الاختبار بالفعل.", true);
  }

  // Check if exam overall time limit has expired
  if (session.timeLimit) {
    const elapsed = Math.floor((Date.now() - session.startedAt) / 1000);
    if (elapsed >= session.timeLimit) {
      await ackCb(cbId, "⏰ انتهى الوقت المخصص للاختبار!", true);
      await finishExam(session, true);
      return;
    }
  }

  // Reset inactivity timer and clear warning
  session.lastActiveAt = Date.now();
  session.warnedAt = null;

  // Persist updated activity in database
  await withRetry(() => prisma.examResult.updateMany({
    where: {
      OR: [
        { examId: session!.examId, telegramId, score: -1 },
        { examId: session!.examId.replace(/^exam[_-]/i, ""), telegramId, score: -1 }
      ]
    },
    data: {
      answers: {
        answers: session!.answers,
        questions: session!.questions,
        currentQ: session!.currentQ,
        startedAt: session!.startedAt,
        lastActiveAt: session!.lastActiveAt,
        warnedAt: null,
        msgId: session!.msgId,
        chatId: session!.chatId,
      } as unknown as Prisma.InputJsonValue,
    },
  })).catch(e => console.error("[exam] save resume progress error:", e));

  await ackCb(cbId, "✅ تم استئناف الاختبار وتمديد الجلسة بنجاح!", false);

  // Update warning message to indicate it has been acknowledged
  try {
    const warnMsgId = (cb.message as { message_id?: number })?.message_id;
    const warnChatId = (cb.message as { chat?: { id: number } })?.chat?.id;
    if (warnMsgId && warnChatId) {
      await tgCall("editMessageText", {
        chat_id: warnChatId,
        message_id: warnMsgId,
        text: `✅ <b>تم استئناف الاختبار بنجاح!</b>\n\nتابع إجابتك على الأسئلة أدناه 👇`,
        parse_mode: "HTML",
        reply_markup: { inline_keyboard: [] },
      });
    }
  } catch { /* ignore edit errors */ }

  // Re-display or send current question
  await sendQuestion(session);
}

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

            // Check if student recently submitted a rating (within last 30 minutes) and is sending an optional text suggestion
      if (msg.chat?.type === "private" && text && text.trim() && !text.trim().startsWith("/") && !["ابدأ", "بداية", "مساعدة", "إلغاء"].includes(text.trim())) {
        try {
          await ensureFeedbackTable();
          const cleanSuggestion = text.trim();
          const recentFeedback = await withRetry(() => prisma.examFeedback.findFirst({
            where: {
              telegramId: String(msg.from?.id),
              updatedAt: { gte: new Date(Date.now() - 30 * 60 * 1000) },
            },
            include: {
              exam: {
                include: {
                  group: true,
                  createdBy: true,
                },
              },
            },
            orderBy: { updatedAt: "desc" },
          }));

          if (recentFeedback && recentFeedback.exam) {
            await withRetry(() => prisma.examFeedback.update({
              where: { id: recentFeedback.id },
              data: {
                suggestion: cleanSuggestion,
                updatedAt: new Date(),
              },
            }));

            // Only notify the owner (1962048849) - never the student
            notifyAdminsFeedback({
              examId: recentFeedback.exam.id,
              examTitle: recentFeedback.exam.title,
              groupTitle: recentFeedback.exam.group?.title,
              groupId: recentFeedback.exam.groupId,
              studentName: recentFeedback.name || msg.from?.first_name || "طالب",
              username: recentFeedback.username || msg.from?.username,
              rating: recentFeedback.rating,
              suggestion: cleanSuggestion,
            }).catch(() => {});

            return NextResponse.json({ ok: true });
          }
        } catch (err) {
          console.error("[feedback/text-handler] error:", err);
        }
      }

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

      } else if (data.startsWith("exam_paused:")) {
        await ackCb(cb.id as string, "⚠️ هذا الاختبار متوقف مؤقتاً حالياً بقرار من المعلم.", true);

      } else if (data.startsWith("exam_closed:")) {
        await ackCb(cb.id as string, "❌ هذا الاختبار غير متاح حالياً.", true);

      } else if (data.startsWith("exam_answer:")) {
        const parts = data.split(":");                      // ["exam_answer", examId, qIdx, optId]
        if (parts.length === 4) await handleExamAnswer(cb, parts[1], Number(parts[2]), Number(parts[3]));

      } else if (data.startsWith("exam_review:")) {
        const parts = data.split(":");
        await handleExamReview(cb, parts[1], Number(parts[2]) || 0);

      } else if (data.startsWith("exam_summary:")) {
        await handleExamReviewSummary(cb, data.slice("exam_summary:".length));

      } else if (data === "exam_review_noop") {
        await ackCb(cb.id as string);

      } else if (data.startsWith("exam_resume:")) {
        await handleExamResume(cb, data.slice("exam_resume:".length));

      } else if (data.startsWith("exam_cancel:")) {
        await handleExamCancel(cb, data.slice("exam_cancel:".length));

      } else if (data === "exam_cancel") {
        await ackCb(cb.id as string, "تم الإلغاء.", false);

      } else if (data.startsWith("exam_rate_open:")) {
        await handleExamRateOpen(cb, data.slice("exam_rate_open:".length));

      } else if (data.startsWith("exam_rate_pick:")) {
        const parts = data.split(":");  // ["exam_rate_pick", examId, rating]
        if (parts.length === 3) await handleExamRatePick(cb, parts[1], Number(parts[2]));

      } else if (data.startsWith("exam_rate_skip")) {
        await ackCb(cb.id as string, "تم التخطي! شكراً على وقتك 😊", false);
      }
    }

    // Sweep and expire overdue/inactive exam sessions in the background
    checkAndExpireExamSessions().catch((e) => console.error("[webhook] checkAndExpire error:", e));

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("Webhook error:", err);
    return NextResponse.json({ ok: false }, { status: 500 });
  }
}
