import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";

export async function POST(req: NextRequest) {
  try {
    // Verify the secret token Telegram sends in header
    const secret = req.headers.get("x-telegram-bot-api-secret-token");

    // Find group config by webhook secret
    const botConfig = await prisma.botConfig.findFirst({
      where: { webhookSecret: secret || "" },
      include: { group: true },
    });

    if (!botConfig) {
      return NextResponse.json({ ok: false }, { status: 401 });
    }

    const update = await req.json();

    // Handle poll_answer updates
    if (update.poll_answer) {
      const { poll_id, user, option_ids } = update.poll_answer;

      // Find the quiz by pollId
      const quiz = await prisma.quiz.findFirst({
        where: { pollId: poll_id, groupId: botConfig.groupId },
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

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("Webhook error:", err);
    return NextResponse.json({ ok: false }, { status: 500 });
  }
}
