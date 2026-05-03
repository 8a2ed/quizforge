import { NextRequest, NextResponse } from "next/server";
import { jwtVerify } from "jose";
import { prisma, withRetry } from "@/lib/db";
import { telegram } from "@/lib/telegram";

const JWT_SECRET = new TextEncoder().encode(process.env.AUTH_SECRET || "secret");

async function getAuthorizedUser(req: NextRequest, groupId: string) {
  const token = req.cookies.get("qf_session")?.value;
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, JWT_SECRET);
    const userId = (payload as { sub: string }).sub;

    const membership = await withRetry(() =>
      prisma.groupMember.findUnique({
        where: { userId_groupId: { userId, groupId } },
        include: { group: true, user: true },
      })
    );

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
    const { quizzes, action = "send" } = body;

    if (!Array.isArray(quizzes) || quizzes.length === 0) {
      return NextResponse.json({ error: "Invalid payload: 'quizzes' array missing or empty" }, { status: 400 });
    }

    const createdQuizzes: { id: string; saved?: boolean; scheduled?: boolean }[] = [];
    const errors: string[] = [];

    // Process each quiz
    for (let i = 0; i < quizzes.length; i++) {
      const q = quizzes[i];
      try {
        const question = q.question?.trim();
        const options = Array.isArray(q.options) ? q.options.map((o: unknown) => String(o).trim()) : [];
        const type = q.type === "poll" ? "POLL" : "QUIZ";
        const isAnonymous = q.isAnonymous !== undefined ? Boolean(q.isAnonymous) : true;

        let correctOptionId: number | null = null;
        if (type === "QUIZ" && q.correctOptionId !== undefined && q.correctOptionId !== null) {
          correctOptionId = Number(q.correctOptionId);
        }

        const scheduledDate = q.scheduledAt ? new Date(q.scheduledAt) : null;
        const isFuture = scheduledDate && scheduledDate > new Date();

        const sanitizedTags: string[] = Array.isArray(q.tags)
          ? q.tags.map((t: unknown) => String(t).trim().toLowerCase()).filter((t: string) => t.length > 0).slice(0, 5)
          : [];

        // Validate
        if (!question) {
          errors.push(`Row ${i + 1}: Missing question.`);
          continue;
        }
        if (options.length < 2) {
          errors.push(`Row ${i + 1}: Needs at least 2 options.`);
          continue;
        }
        if (type === "QUIZ" && correctOptionId === null) {
          errors.push(`Row ${i + 1}: Quiz type requires a correct answer.`);
          continue;
        }

        // --- Save to Template Library ---
        if (action === "save") {
          const templateChatId = `template:${auth.userId}`;
          let group = await withRetry(() => prisma.group.findUnique({ where: { chatId: templateChatId } }));
          if (!group) {
            group = await withRetry(() =>
              prisma.group.create({
                data: { chatId: templateChatId, title: "Templates", isForum: false, botConfig: { create: {} } },
              })
            );
            await withRetry(() =>
              prisma.groupMember.create({
                data: { userId: auth.userId, groupId: group!.id, role: "OWNER" },
              })
            );
          }

          const quiz = await withRetry(() =>
            prisma.quiz.create({
              data: {
                question,
                options,
                correctOptionId,
                explanation: q.explanation?.trim() || null,
                type,
                isAnonymous,
                allowsMultiple: type === "POLL" ? Boolean(q.allowsMultiple) : false,
                openPeriod: q.openPeriod ? Number(q.openPeriod) : null,
                allowAddingOptions: type === "POLL" ? Boolean(q.allowAddingOptions) : false,
                allowRevoting: type === "POLL" ? Boolean(q.allowRevoting) : false,
                tags: sanitizedTags,
                groupId: group!.id,
                sentById: auth.userId,
              },
            })
          );
          createdQuizzes.push({ id: quiz.id, saved: true });
          continue;
        }

        // --- Schedule for future ---
        if (isFuture) {
          const quiz = await withRetry(() =>
            prisma.quiz.create({
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
                allowAddingOptions: type === "POLL" ? Boolean(q.allowAddingOptions) : false,
                allowRevoting: type === "POLL" ? Boolean(q.allowRevoting) : false,
                tags: sanitizedTags,
                scheduledAt: scheduledDate,
                sentAt: null,
                groupId,
                sentById: auth.userId,
              },
            })
          );
          createdQuizzes.push({ id: quiz.id, scheduled: true });
        } else {
          // --- Send immediately via Telegram ---
          const message = await telegram.sendPoll({
            chat_id: auth.membership.group.chatId,
            message_thread_id: q.topicId ? Number(q.topicId) : undefined,
            question,
            options: options.map((text: string) => ({ text })),
            type: type === "QUIZ" ? "quiz" : "regular",
            is_anonymous: isAnonymous,
            correct_option_id: correctOptionId !== null ? correctOptionId : undefined,
            explanation: q.explanation?.trim() || undefined,
            explanation_parse_mode: q.explanation?.trim() ? "HTML" : undefined,
            allows_multiple_answers: type === "POLL" ? Boolean(q.allowsMultiple) : false,
            allows_adding_options: type === "POLL" ? Boolean(q.allowAddingOptions) : false,
            allows_revoting: type === "POLL" ? Boolean(q.allowRevoting) : false,
            open_period: q.openPeriod ? Number(q.openPeriod) : undefined,
          });

          // Persist to DB
          const quiz = await withRetry(() =>
            prisma.quiz.create({
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
                allowAddingOptions: type === "POLL" ? Boolean(q.allowAddingOptions) : false,
                allowRevoting: type === "POLL" ? Boolean(q.allowRevoting) : false,
                tags: sanitizedTags,
                sentAt: new Date(),
                messageId: message.message_id,
                pollId: message.poll?.id || null,
                groupId,
                sentById: auth.userId,
              },
            })
          );
          createdQuizzes.push({ id: quiz.id, scheduled: false });

          // 3-second delay between sends to respect Telegram rate limits
          if (i < quizzes.length - 1) {
            await new Promise<void>((resolve) => setTimeout(resolve, 3000));
          }
        }
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : "Unknown error";
        errors.push(`Row ${i + 1} failed: ${message}`);
      }
    }

    return NextResponse.json({
      ok: true,
      processed: createdQuizzes.length,
      errors: errors.length > 0 ? errors : undefined,
    });
  } catch {
    return NextResponse.json({ error: "Failed to process bulk upload" }, { status: 500 });
  }
}
