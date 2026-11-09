import { getAuthSecret } from "@/lib/auth";
import { NextRequest, NextResponse } from "next/server";
import { jwtVerify } from "jose";
import { prisma, withRetry } from "@/lib/db";
import { formatExamDescription } from "@/lib/examConfig";

const JWT_SECRET = getAuthSecret();

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

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
    return { userId, group: m.group, role: m.role };
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
  if (auth.role !== "OWNER" && auth.role !== "ADMIN") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
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

  const sanitizedQuestions = questions.map((rawQuestion: unknown) => {
    if (!isRecord(rawQuestion)) return null;
    const question = typeof rawQuestion.question === "string" ? rawQuestion.question.trim() : "";
    const options = Array.isArray(rawQuestion.options)
      ? rawQuestion.options.filter((option): option is string => typeof option === "string").map((option) => option.trim()).filter(Boolean)
      : [];
    const correctOptionId = rawQuestion.correctOptionId;
    if (
      !question || question.length > 300 || options.length < 2 || options.length > 10 ||
      options.some((option) => option.length > 100) || typeof correctOptionId !== "number" ||
      !Number.isInteger(correctOptionId) || correctOptionId < 0 || correctOptionId >= options.length
    ) {
      return null;
    }
    const explanation = typeof rawQuestion.explanation === "string" ? rawQuestion.explanation.trim() : undefined;
    return { question, options, correctOptionId, explanation: explanation || undefined };
  });
  if (sanitizedQuestions.some((question) => question === null)) {
    return NextResponse.json({ error: "One or more questions are invalid" }, { status: 400 });
  }
  const validQuestions = sanitizedQuestions.filter((question): question is NonNullable<typeof question> => question !== null);

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
          questions: validQuestions,
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
