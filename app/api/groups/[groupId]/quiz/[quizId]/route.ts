import { NextRequest, NextResponse } from "next/server";
import { jwtVerify } from "jose";
import { prisma, withRetry } from "@/lib/db";
import { telegram } from "@/lib/telegram";

const JWT_SECRET = new TextEncoder().encode(process.env.AUTH_SECRET || "secret");

// DELETE /api/groups/[groupId]/quiz/[quizId]
// Deletes a quiz from Telegram (if possible) and marks it as deleted in DB
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ groupId: string; quizId: string }> }
) {
  const { groupId, quizId } = await params;
  const token = req.cookies.get("qf_session")?.value;
  if (!token) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const { payload } = await jwtVerify(token, JWT_SECRET);
    const userId = (payload as { sub: string }).sub;

    const membership = await withRetry(() => prisma.groupMember.findUnique({
      where: { userId_groupId: { userId, groupId } },
      include: { group: true },
    }));

    if (!membership || !membership.approved) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
    }

    // Fetch the quiz
    const quiz = await withRetry(() => prisma.quiz.findFirst({
      where: { id: quizId, groupId },
    }));

    if (!quiz) {
      return NextResponse.json({ error: "Quiz not found" }, { status: 404 });
    }

    let telegramDeleted = false;
    let telegramError: string | null = null;

    // Try to delete the message from Telegram
    if (quiz.messageId) {
      try {
        await telegram.deleteMessage(membership.group.chatId, quiz.messageId);
        telegramDeleted = true;
      } catch (err: unknown) {
        telegramError = err instanceof Error ? err.message : "Could not delete from Telegram";
        // Message may already be deleted — proceed to mark in DB anyway
      }
    }

    // Mark as deleted in DB (soft delete — keeps analytics data)
    await withRetry(() => prisma.quiz.update({
      where: { id: quizId },
      data: { deletedAt: new Date() },
    }));

    return NextResponse.json({
      ok: true,
      telegramDeleted,
      telegramError, // null if deleted successfully from Telegram
    });
  } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
}
