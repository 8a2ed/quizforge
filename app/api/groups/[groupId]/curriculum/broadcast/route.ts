import { NextRequest, NextResponse } from "next/server";
import { jwtVerify } from "jose";
import { prisma, withRetry } from "@/lib/db";
import { telegram } from "@/lib/telegram";

const JWT_SECRET = new TextEncoder().encode(process.env.AUTH_SECRET || "secret");

async function checkAuth(req: NextRequest, groupId: string) {
  const token = req.cookies.get("qf_session")?.value;
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, JWT_SECRET);
    const userId = (payload as { sub: string }).sub;
    const m = await withRetry(() =>
      prisma.groupMember.findUnique({
        where: { userId_groupId: { userId, groupId } },
        include: { group: true },
      })
    );
    if (!m || !m.approved) return null;
    return { userId, group: m.group };
  } catch {
    return null;
  }
}

// POST /api/groups/[groupId]/curriculum/broadcast
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ groupId: string }> }
) {
  const { groupId } = await params;
  const auth = await checkAuth(req, groupId);
  if (!auth) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await req.json();
  const {
    questions,
    topicId,
    topicName,
    isAnonymous = true,
    openPeriod = 0,
  } = body;

  if (!Array.isArray(questions) || questions.length === 0) {
    return NextResponse.json({ error: "لا توجد أسئلة محددة للبث" }, { status: 400 });
  }

  const chatId = auth.group.chatId;
  const broadcastResults: Array<{ id: string; success: boolean; error?: string }> = [];

  for (let i = 0; i < questions.length; i++) {
    const q = questions[i];
    const questionText = String(q.question || "").trim().slice(0, 300);
    const options = Array.isArray(q.options)
      ? q.options.map((o: unknown) => String(o).trim().slice(0, 100)).filter(Boolean)
      : [];
    const correctOptionId =
      typeof q.correctOptionId === "number" && q.correctOptionId >= 0 && q.correctOptionId < options.length
        ? q.correctOptionId
        : 0;
    const explanation = q.explanation ? String(q.explanation).trim().slice(0, 200) : undefined;

    if (!questionText || options.length < 2) continue;

    try {
      // Send to Telegram
      const msg = await telegram.sendPoll({
        chat_id: chatId,
        question: questionText,
        options: options.map((opt: string) => ({ text: opt })),
        type: "quiz",
        correct_option_id: correctOptionId,
        explanation,
        is_anonymous: Boolean(isAnonymous),
        open_period: openPeriod > 0 ? Number(openPeriod) : undefined,
        message_thread_id: topicId ? Number(topicId) : undefined,
      });

      // Save record in database
      await withRetry(() =>
        prisma.quiz.create({
          data: {
            groupId,
            sentById: auth.userId,
            question: questionText,
            options,
            type: "QUIZ",
            correctOptionId,
            explanation,
            isAnonymous: Boolean(isAnonymous),
            openPeriod: openPeriod > 0 ? Number(openPeriod) : null,
            topicId: topicId ? Number(topicId) : null,
            topicName: topicName || null,
            messageId: msg.message_id,
            pollId: msg.poll?.id,
            sentAt: new Date(),
            tags: ["AI_CURRICULUM", q.topic].filter(Boolean),
          },
        })
      );

      broadcastResults.push({ id: q.id || `q-${i}`, success: true });

      // Respect Telegram rate limits (wait 1.5s between consecutive polls)
      if (i < questions.length - 1) {
        await new Promise((r) => setTimeout(r, 1500));
      }
    } catch (err: unknown) {
      console.error(`[Broadcast Error Question ${i + 1}]`, err);
      broadcastResults.push({
        id: q.id || `q-${i}`,
        success: false,
        error: err instanceof Error ? err.message : "فشل الإرسال لتليجرام",
      });
    }
  }

  const successCount = broadcastResults.filter((r) => r.success).length;

  return NextResponse.json({
    success: successCount > 0,
    total: questions.length,
    successCount,
    results: broadcastResults,
    message: `تم نشر ${successCount} من أصل ${questions.length} سؤال مباشرة في تليجرام!`,
  });
}
