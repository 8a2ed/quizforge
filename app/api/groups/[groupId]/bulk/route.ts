import { NextRequest, NextResponse } from "next/server";
import { jwtVerify } from "jose";
import { prisma } from "@/lib/db";
import { telegram } from "@/lib/telegram";

const JWT_SECRET = new TextEncoder().encode(process.env.AUTH_SECRET || "secret");

async function getAuthorizedUser(req: NextRequest, groupId: string) {
  const token = req.cookies.get("qf_session")?.value;
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, JWT_SECRET);
    const userId = (payload as { sub: string }).sub;

    const membership = await prisma.groupMember.findUnique({
      where: { userId_groupId: { userId, groupId } },
      include: { group: true, user: true },
    });

    if (!membership || !membership.approved) return null;
    return { membership, userId };
  } catch {
    return null;
  }
}

// POST /api/groups/[groupId]/bulk
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ groupId: string }> }
) {
  const { groupId } = await params;
  const auth = await getAuthorizedUser(req, groupId);
  if (!auth) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const body = await req.json();
    const { quizzes } = body;

    if (!Array.isArray(quizzes) || quizzes.length === 0) {
      return NextResponse.json({ error: "Invalid payload: 'quizzes' array missing or empty" }, { status: 400 });
    }

    const createdQuizzes = [];
    const errors = [];

    // Process each quiz
    for (let i = 0; i < quizzes.length; i++) {
      const q = quizzes[i];
      try {
        const question = q.question?.trim();
        const options = Array.isArray(q.options) ? q.options.map((o: any) => String(o).trim()) : [];
        const type = q.type === "poll" ? "POLL" : "QUIZ";
        const isAnonymous = q.isAnonymous !== undefined ? Boolean(q.isAnonymous) : true;
        
        let correctOptionId = null;
        if (type === "QUIZ" && q.correctOptionId !== undefined && q.correctOptionId !== null) {
          correctOptionId = Number(q.correctOptionId);
        }

        const scheduledDate = q.scheduledAt ? new Date(q.scheduledAt) : null;
        const isFuture = scheduledDate && scheduledDate > new Date();

        if (!question || options.length < 2) {
          errors.push(`Row ${i + 1}: Missing question or < 2 options.`);
          continue;
        }

        if (isFuture) {
          // Schedule it in the DB
          const quiz = await prisma.quiz.create({
            data: {
              question,
              options,
              correctOptionId,
              explanation: q.explanation?.trim() || null,
              type,
              isAnonymous,
              allowsMultiple: type === "POLL" ? Boolean(q.allowsMultiple) : false,
              openPeriod: q.openPeriod ? Number(q.openPeriod) : null,
              topicId: q.topicId ? Number(q.topicId) : null,
              topicName: q.topicName || null,
              scheduledAt: scheduledDate,
              sentAt: null,
              groupId,
              sentById: auth.userId,
            }
          });
          createdQuizzes.push({ id: quiz.id, scheduled: true });
        } else {
          // Send immediately
          const message = await telegram.sendPoll({
            chat_id: auth.membership.group.chatId,
            message_thread_id: q.topicId ? Number(q.topicId) : undefined,
            question,
            options: options.map(text => ({ text })),
            type: type === "QUIZ" ? "quiz" : "regular",
            is_anonymous: isAnonymous,
            correct_option_id: correctOptionId !== null ? correctOptionId : undefined,
            explanation: q.explanation?.trim() || undefined,
            explanation_parse_mode: "HTML",
            allows_multiple_answers: type === "POLL" ? Boolean(q.allowsMultiple) : undefined,
            open_period: q.openPeriod ? Number(q.openPeriod) : undefined,
          });

          // Save to DB
          const quiz = await prisma.quiz.create({
            data: {
              question,
              options,
              correctOptionId,
              explanation: q.explanation?.trim() || null,
              type,
              isAnonymous,
              allowsMultiple: type === "POLL" ? Boolean(q.allowsMultiple) : false,
              openPeriod: q.openPeriod ? Number(q.openPeriod) : null,
              topicId: q.topicId ? Number(q.topicId) : null,
              topicName: q.topicName || null,
              sentAt: new Date(),
              messageId: message.message_id,
              pollId: message.poll?.id || null,
              groupId,
              sentById: auth.userId,
            }
          });
          createdQuizzes.push({ id: quiz.id, scheduled: false });
        }
      } catch (err: any) {
        errors.push(`Row ${i + 1} Failed: ${err.message}`);
      }
    }

    return NextResponse.json({
      ok: true,
      processed: createdQuizzes.length,
      errors: errors.length > 0 ? errors : undefined,
    });
  } catch (error) {
    return NextResponse.json({ error: "Failed to process bulk upload" }, { status: 500 });
  }
}
