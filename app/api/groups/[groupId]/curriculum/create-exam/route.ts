import { NextRequest, NextResponse } from "next/server";
import { jwtVerify } from "jose";
import { prisma, withRetry } from "@/lib/db";
import { formatExamDescription } from "@/lib/examConfig";

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

// POST /api/groups/[groupId]/curriculum/create-exam
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
    title,
    description = "",
    questions,
    timeLimit = 900, // 15 mins default
    passingScore = 60,
    topicId,
    topicName,
    shuffleQuestions = true,
    shuffleOptions = false,
  } = body;

  if (!title || !title.trim()) {
    return NextResponse.json({ error: "عنوان الاختبار مطلوب" }, { status: 400 });
  }

  if (!Array.isArray(questions) || questions.length === 0) {
    return NextResponse.json({ error: "يجب اختيار سؤال واحد على الأقل لإنشاء الاختبار" }, { status: 400 });
  }

  const sanitizedQuestions = questions.map((q: any) => ({
    question: String(q.question || "").trim(),
    options: Array.isArray(q.options)
      ? q.options.map((o: unknown) => String(o).trim()).filter(Boolean)
      : [],
    correctOptionId: Number(q.correctOptionId) || 0,
    explanation: q.explanation ? String(q.explanation).trim() : undefined,
  }));

  try {
    const encodedDescription = formatExamDescription(description.trim(), {
      shuffleQuestions: Boolean(shuffleQuestions),
      shuffleOptions: Boolean(shuffleOptions),
    });

    const exam = await withRetry(() =>
      prisma.exam.create({
        data: {
          groupId,
          createdById: auth.userId,
          title: title.trim(),
          description: encodedDescription || null,
          questions: sanitizedQuestions,
          timeLimit: timeLimit ? Number(timeLimit) : null,
          passingScore: Number(passingScore) || 60,
          isPublished: true,
          topicId: topicId ? Number(topicId) : null,
          topicName: topicName || null,
        },
      })
    );

    return NextResponse.json({
      success: true,
      examId: exam.id,
      exam,
      message: "تم إنشاء الاختبار الإلكتروني بنجاح!",
    });
  } catch (err: unknown) {
    console.error("[Create Exam Error]", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "فشل إنشاء الاختبار" },
      { status: 500 }
    );
  }
}
