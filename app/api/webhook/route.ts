import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";

// Global webhook secret set in .env as WEBHOOK_SECRET (optional — used when set)
const WEBHOOK_SECRET = process.env.WEBHOOK_SECRET || "";

export async function POST(req: NextRequest) {
  try {
    // Verify secret if configured
    if (WEBHOOK_SECRET) {
      const secret = req.headers.get("x-telegram-bot-api-secret-token");
      if (secret !== WEBHOOK_SECRET) {
        return NextResponse.json({ ok: false }, { status: 401 });
      }
    }

    const update = await req.json();

    // ─── Poll answer (user voted) ────────────────────────────────────────────
    if (update.poll_answer) {
      const { poll_id, user, option_ids } = update.poll_answer;

      const quiz = await prisma.quiz.findFirst({
        where: { pollId: poll_id },
      });

      if (quiz) {
        await prisma.pollAnswer.upsert({
          where: {
            quizId_telegramUserId: {
              quizId: quiz.id,
              telegramUserId: String(user.id),
            },
          },
          update: {
            optionIds: option_ids,
            answeredAt: new Date(),
            firstName: user.first_name,
            username: user.username,
          },
          create: {
            quizId: quiz.id,
            telegramUserId: String(user.id),
            optionIds: option_ids,
            firstName: user.first_name,
            username: user.username,
          },
        });
      }
    }

    // ─── Poll closed/stopped ─────────────────────────────────────────────────
    if (update.poll && update.poll.is_closed) {
      const poll = update.poll;
      // Mark quiz as having its poll closed
      await prisma.quiz.updateMany({
        where: { pollId: poll.id },
        data: { pollClosed: true },
      }).catch(() => {}); // Field may not exist yet — safe to ignore
    }

    // ─── Message deleted / Forum topic events ────────────────────────────────
    if (update.message) {
      const msg = update.message;

      // Forum topic created → cache the topic
      if (msg.forum_topic_created && msg.message_thread_id) {
        const chatId = String(msg.chat?.id);
        const group = await prisma.group.findUnique({ where: { chatId } });
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
        const chatId = String(msg.chat?.id);
        const group = await prisma.group.findUnique({ where: { chatId } });
        if (group) {
          await prisma.topic.updateMany({
            where: { groupId: group.id, topicId: msg.message_thread_id },
            data: { isClosed: true },
          }).catch(() => {});
        }
      }
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("Webhook error:", err);
    return NextResponse.json({ ok: false }, { status: 500 });
  }
}
