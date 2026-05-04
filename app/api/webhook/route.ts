import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";

const WEBHOOK_SECRET = process.env.WEBHOOK_SECRET || "";

export async function POST(req: NextRequest) {
  try {
    if (WEBHOOK_SECRET) {
      const secret = req.headers.get("x-telegram-bot-api-secret-token");
      if (secret !== WEBHOOK_SECRET) return NextResponse.json({ ok: false }, { status: 401 });
    }

    const update = await req.json();

    // ─── Poll answer (user voted) ────────────────────────────────────────────
    if (update.poll_answer) {
      const { poll_id, user, option_ids } = update.poll_answer;
      const quiz = await prisma.quiz.findFirst({ where: { pollId: poll_id } });
      if (quiz) {
        await prisma.pollAnswer.upsert({
          where: { quizId_telegramUserId: { quizId: quiz.id, telegramUserId: String(user.id) } },
          update: { optionIds: option_ids, answeredAt: new Date(), firstName: user.first_name, username: user.username },
          create: { quizId: quiz.id, telegramUserId: String(user.id), optionIds: option_ids, firstName: user.first_name, username: user.username },
        });
      }
    }

    // ─── Poll stopped/closed ─────────────────────────────────────────────────
    if (update.poll && update.poll.is_closed) {
      await prisma.quiz.updateMany({
        where: { pollId: update.poll.id },
        data: { pollClosed: true },
      }).catch(() => {});
    }

    // ─── Message events ──────────────────────────────────────────────────────
    if (update.message) {
      const msg = update.message;
      const chatId = String(msg.chat?.id);

      // Forum topic created → auto-cache the topic
      if (msg.forum_topic_created && msg.message_thread_id) {
        const group = await prisma.group.findFirst({
          where: { OR: [{ chatId }, { chatId: `-100${chatId.replace(/^-/, "")}` }] },
        });
        if (group) {
          await prisma.topic.upsert({
            where: { groupId_topicId: { groupId: group.id, topicId: msg.message_thread_id } },
            update: { name: msg.forum_topic_created.name },
            create: {
              groupId: group.id,
              topicId: msg.message_thread_id,
              name: msg.forum_topic_created.name,
              iconColor: msg.forum_topic_created.icon_color || 0,
              iconCustomEmojiId: msg.forum_topic_created.icon_custom_emoji_id || null,
              isClosed: false,
            },
          }).catch(() => {});
        }
      }

      // Forum topic closed
      if (msg.forum_topic_closed && msg.message_thread_id) {
        const group = await prisma.group.findFirst({
          where: { OR: [{ chatId }, { chatId: `-100${chatId.replace(/^-/, "")}` }] },
        });
        if (group) {
          await prisma.topic.updateMany({
            where: { groupId: group.id, topicId: msg.message_thread_id },
            data: { isClosed: true },
          }).catch(() => {});
        }
      }

      // Forum topic reopened
      if (msg.forum_topic_reopened && msg.message_thread_id) {
        const group = await prisma.group.findFirst({
          where: { OR: [{ chatId }, { chatId: `-100${chatId.replace(/^-/, "")}` }] },
        });
        if (group) {
          await prisma.topic.updateMany({
            where: { groupId: group.id, topicId: msg.message_thread_id },
            data: { isClosed: false },
          }).catch(() => {});
        }
      }
    }

    // ─── Callback query (inline button presses — for Exam system) ────────────
    if (update.callback_query) {
      const cb = update.callback_query;
      const data: string = cb.data || "";

      // Exam start callback: "exam_start:{examId}"
      if (data.startsWith("exam_start:")) {
        const examId = data.replace("exam_start:", "");
        await handleExamStart(cb, examId);
      }
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("Webhook error:", err);
    return NextResponse.json({ ok: false }, { status: 500 });
  }
}

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;

async function tgCall(method: string, body: Record<string, unknown>) {
  const res = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return res.json();
}

async function handleExamStart(cb: Record<string, unknown>, examId: string) {
  const user = cb.from as Record<string, unknown>;
  const userId = String((user as { id: number }).id);
  const firstName = String((user as { first_name: string }).first_name || "Student");

  try {
    // Find exam
    const exam = await prisma.exam.findUnique({
      where: { id: examId },
      include: { group: true },
    });
    if (!exam || !exam.isPublished) {
      await tgCall("answerCallbackQuery", {
        callback_query_id: cb.id,
        text: "This exam is not available.",
        show_alert: true,
      });
      return;
    }

    // Check if user already completed
    const existing = await prisma.examResult.findFirst({
      where: { examId, telegramId: userId },
    });
    if (existing) {
      await tgCall("answerCallbackQuery", {
        callback_query_id: cb.id,
        text: `You already completed this exam with a score of ${existing.score}%.`,
        show_alert: true,
      });
      return;
    }

    // Acknowledge the callback
    await tgCall("answerCallbackQuery", { callback_query_id: cb.id });

    // Send exam details + start button to user's DM
    const questions = exam.questions as Array<Record<string, unknown>>;
    const startMsg = [
      `📋 *${exam.title}*`,
      exam.description ? `\n${exam.description}` : "",
      `\n\n📊 *${questions.length} questions*`,
      exam.timeLimit ? `⏱ *Time limit: ${Math.floor(exam.timeLimit / 60)} minutes*` : "",
      `✅ *Passing score: ${exam.passingScore}%*`,
      "\n\nPress *Begin* to start. Questions will arrive one by one.",
    ].filter(Boolean).join("\n");

    await tgCall("sendMessage", {
      chat_id: userId,
      text: startMsg,
      parse_mode: "Markdown",
      reply_markup: {
        inline_keyboard: [[
          { text: "🚀 Begin Exam", callback_data: `exam_begin:${examId}` },
          { text: "❌ Cancel", callback_data: "exam_cancel" },
        ]],
      },
    });
  } catch (err) {
    console.error("[webhook] handleExamStart error:", err);
  }
}
