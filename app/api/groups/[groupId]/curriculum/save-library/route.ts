import { NextRequest, NextResponse } from "next/server";
import { jwtVerify } from "jose";
import { prisma, withRetry } from "@/lib/db";

const JWT_SECRET = new TextEncoder().encode(process.env.AUTH_SECRET || "secret");

async function checkAuth(req: NextRequest) {
  const token = req.cookies.get("qf_session")?.value;
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, JWT_SECRET);
    return (payload as { sub: string }).sub;
  } catch {
    return null;
  }
}

async function ensureTemplateGroup(userId: string): Promise<string> {
  const templateChatId = `template:${userId}`;
  let group = await withRetry(() =>
    prisma.group.findUnique({ where: { chatId: templateChatId }, select: { id: true } })
  );
  if (!group) {
    group = await withRetry(() =>
      prisma.group.create({
        data: { chatId: templateChatId, title: "Templates", isForum: false, botConfig: { create: {} } },
        select: { id: true },
      })
    );
    await withRetry(() =>
      prisma.groupMember.create({ data: { userId, groupId: group!.id, role: "OWNER" } })
    );
  }
  return group.id;
}

// POST /api/groups/[groupId]/curriculum/save-library
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ groupId: string }> }
) {
  const { groupId: _groupId } = await params;
  const userId = await checkAuth(req);
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await req.json();
  const { questions, collectionId } = body;

  if (!Array.isArray(questions) || questions.length === 0) {
    return NextResponse.json({ error: "لا توجد أسئلة محددة للحفظ" }, { status: 400 });
  }

  try {
    const templateGroupId = await ensureTemplateGroup(userId);

    const savedIds: string[] = [];

    for (const q of questions) {
      const questionText = String(q.question || "").trim().slice(0, 300);
      const options = Array.isArray(q.options)
        ? q.options.map((o: unknown) => String(o).trim().slice(0, 100)).filter(Boolean)
        : [];
      const correctOptionId =
        typeof q.correctOptionId === "number" && q.correctOptionId >= 0 && q.correctOptionId < options.length
          ? q.correctOptionId
          : 0;
      const explanation = q.explanation ? String(q.explanation).trim().slice(0, 200) : null;
      const tags = [q.topic, "AI_CURRICULUM"].filter(Boolean).map((t: string) => t.slice(0, 30));

      if (!questionText || options.length < 2) continue;

      const created = await withRetry(() =>
        prisma.quiz.create({
          data: {
            question: questionText,
            options,
            type: "QUIZ",
            correctOptionId,
            explanation,
            isAnonymous: true,
            groupId: templateGroupId,
            sentById: userId,
            tags,
          },
        })
      );

      savedIds.push(created.id);

      if (collectionId) {
        await withRetry(() =>
          prisma.collectionQuiz.upsert({
            where: {
              collectionId_quizId: { collectionId, quizId: created.id },
            },
            create: { collectionId, quizId: created.id },
            update: {},
          })
        ).catch(() => {});
      }
    }

    return NextResponse.json({
      success: true,
      count: savedIds.length,
      savedIds,
      message: `تم حفظ ${savedIds.length} سؤال بنجاح في بنك الأسئلة (المكتبة)!`,
    });
  } catch (err: unknown) {
    console.error("[Save to Library Error]", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "فشل حفظ الأسئلة في بنك الأسئلة" },
      { status: 500 }
    );
  }
}
