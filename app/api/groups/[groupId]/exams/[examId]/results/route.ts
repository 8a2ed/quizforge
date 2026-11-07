import { NextRequest, NextResponse } from "next/server";
import { jwtVerify } from "jose";
import { prisma, withRetry } from "@/lib/db";
import { checkAndExpireExamSessions } from "@/lib/examExpiry";
import { mapStudentAnswersToMaster, type StudentExamQuestion } from "@/lib/examConfig";

const JWT_SECRET = new TextEncoder().encode(process.env.AUTH_SECRET || "secret");

async function authorize(req: NextRequest, groupId: string) {
  const token = req.cookies.get("qf_session")?.value;
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, JWT_SECRET);
    const userId = (payload as { sub: string }).sub;
    const m = await withRetry(() => prisma.groupMember.findUnique({
      where: { userId_groupId: { userId, groupId } },
    }));
    return m?.approved ? { userId } : null;
  } catch { return null; }
}

interface ExamQuestion {
  question: string;
  options: string[];
  correctOptionId: number;
  explanation?: string;
  imageUrl?: string;
}


function extractStudentMasterAnswers(
  rawAnswers: unknown,
  masterQuestions: ExamQuestion[]
): Record<string, number> {
  if (!rawAnswers) return {};

  let parsed: any = rawAnswers;
  if (typeof rawAnswers === "string") {
    try { parsed = JSON.parse(rawAnswers); } catch { return {}; }
  }

  if (typeof parsed !== "object" || parsed === null) return {};

  // Case A: Session format { answers: { ... }, questions: [...] }
  if (parsed.answers && typeof parsed.answers === "object" && !Array.isArray(parsed.answers)) {
    if (Array.isArray(parsed.questions) && parsed.questions.length > 0) {
      try {
        const mapped = mapStudentAnswersToMaster(parsed.questions as StudentExamQuestion[], parsed.answers);
        const res: Record<string, number> = {};
        for (const [k, v] of Object.entries(mapped)) {
          res[String(k)] = Number(v);
        }
        return res;
      } catch {
        // fallback
      }
    }
    const res: Record<string, number> = {};
    for (const [k, v] of Object.entries(parsed.answers)) {
      res[String(k)] = Number(v);
    }
    return res;
  }

  // Case B: Array format [1, 0, 2] or [{ questionIndex: 0, optionIndex: 1 }]
  if (Array.isArray(parsed)) {
    const res: Record<string, number> = {};
    parsed.forEach((val, idx) => {
      if (typeof val === "number") res[String(idx)] = val;
      else if (val && typeof val.chosenOptionId === "number") res[String(idx)] = val.chosenOptionId;
    });
    return res;
  }

  // Case C: Flat object { "0": 1, "1": 0 }
  const res: Record<string, number> = {};
  for (const [k, v] of Object.entries(parsed)) {
    if (v !== undefined && v !== null && !isNaN(Number(v))) {
      res[String(k)] = Number(v);
    }
  }
  return res;
}

// GET /api/groups/[groupId]/exams/[examId]/results
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ groupId: string; examId: string }> }
) {
  const { groupId, examId } = await params;
  const auth = await authorize(req, groupId);
  if (!auth) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  // Sweep and finalize overdue or inactive sessions for this specific exam
  await checkAndExpireExamSessions(examId).catch((e) => console.error("[results/GET] checkAndExpire error:", e));

  const exam = await withRetry(() => prisma.exam.findFirst({
    where: { id: examId, groupId },
    include: {
      results: { orderBy: { completedAt: "desc" } },
      _count: { select: { results: true } },
    },
  }));
  if (!exam) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const rawQuestions = Array.isArray(exam.questions) ? exam.questions : [];
  const questions: ExamQuestion[] = rawQuestions.map((q: any) => ({
    question: String(q?.question || ""),
    options: Array.isArray(q?.options) ? q.options.map(String) : [],
    correctOptionId: Number(q?.correctOptionId) || 0,
    explanation: q?.explanation ? String(q.explanation) : undefined,
    imageUrl: q?.imageUrl ? String(q.imageUrl) : undefined,
  }));

  const allResults = exam.results;
  const completedResults = allResults.filter(r => r.score >= 0);
  const inProgressResults = allResults.filter(r => r.score < 0);

  const totalCompleted = completedResults.length;
  const passingThreshold = exam.passingScore ?? 50;
  const passCount = completedResults.filter(r => Boolean(r.passed) && r.score >= passingThreshold && (r.score > 0 || passingThreshold === 0)).length;
  const failCount = totalCompleted - passCount;
  const passRate = totalCompleted > 0 ? Math.round((passCount / totalCompleted) * 100) : 0;

  const scores = completedResults.map(r => r.score);
  const avgScore = totalCompleted > 0 ? Math.round(scores.reduce((a, b) => a + b, 0) / totalCompleted) : 0;
  const highestScore = totalCompleted > 0 ? Math.max(...scores) : 0;
  const lowestScore = totalCompleted > 0 ? Math.min(...scores) : 0;

  const validDurations = completedResults.map(r => r.duration || 0).filter(d => d > 0);
  const avgDuration = validDurations.length > 0 ? Math.round(validDurations.reduce((a, b) => a + b, 0) / validDurations.length) : 0;

  // â”€â”€ Per-Question Analytics â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  const questionAnalytics = questions.map((q, qIdx) => {
    let qCorrectCount = 0;
    let qTotalAnswered = 0;
    const optionCounts = new Array(q.options.length).fill(0);

    for (const r of completedResults) {
      const userAnswers = extractStudentMasterAnswers(r.answers, questions);
      const chosen = userAnswers[String(qIdx)] ?? userAnswers[qIdx];
      if (chosen !== undefined && chosen !== null) {
        const chosenNum = Number(chosen);
        if (!isNaN(chosenNum) && chosenNum >= 0 && chosenNum < q.options.length) {
          qTotalAnswered++;
          optionCounts[chosenNum]++;
          if (chosenNum === q.correctOptionId) {
            qCorrectCount++;
          }
        }
      }
    }

    const successRate = qTotalAnswered > 0 ? Math.round((qCorrectCount / qTotalAnswered) * 100) : 0;

    // Detect most common mistake (trap)
    let mostCommonMistake: { optionIndex: number; optionText: string; count: number; percentage: number } | null = null;
    let maxWrongCount = 0;
    let maxWrongIdx = -1;

    for (let oIdx = 0; oIdx < optionCounts.length; oIdx++) {
      if (oIdx !== q.correctOptionId && optionCounts[oIdx] > maxWrongCount) {
        maxWrongCount = optionCounts[oIdx];
        maxWrongIdx = oIdx;
      }
    }

    if (maxWrongIdx >= 0 && maxWrongCount > 0) {
      mostCommonMistake = {
        optionIndex: maxWrongIdx,
        optionText: q.options[maxWrongIdx] || `Option ${String.fromCharCode(65 + maxWrongIdx)}`,
        count: maxWrongCount,
        percentage: qTotalAnswered > 0 ? Math.round((maxWrongCount / qTotalAnswered) * 100) : 0,
      };
    }

    let difficulty: "EASY" | "MEDIUM" | "HARD" = "MEDIUM";
    if (qTotalAnswered > 0) {
      if (successRate >= 75) difficulty = "EASY";
      else if (successRate < 45) difficulty = "HARD";
    }

    return {
      index: qIdx,
      question: q.question,
      options: q.options,
      correctOptionId: q.correctOptionId,
      explanation: q.explanation || null,
      imageUrl: q.imageUrl || null,
      totalAnswered: qTotalAnswered,
      correctCount: qCorrectCount,
      successRate,
      difficulty,
      optionCounts,
      mostCommonMistake,
    };
  });

  // â”€â”€ Enriched Student Submissions â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  const studentResults = allResults.map(r => {
    const userAnswers = extractStudentMasterAnswers(r.answers, questions);
    let correctCount = 0;

    const details = questions.map((q, qIdx) => {
      const chosen = userAnswers[String(qIdx)] ?? userAnswers[qIdx];
      const chosenNum = chosen !== undefined && chosen !== null ? Number(chosen) : null;
      const isAnswered = chosenNum !== null && !isNaN(chosenNum) && chosenNum >= 0 && chosenNum < q.options.length;
      const isCorrect = isAnswered && chosenNum === q.correctOptionId;
      if (isCorrect) correctCount++;

      return {
        questionIndex: qIdx,
        question: q.question,
        options: q.options,
        chosenOptionId: isAnswered ? chosenNum : null,
        chosenOptionText: isAnswered ? (q.options[chosenNum!] || "") : "Not answered",
        correctOptionId: q.correctOptionId,
        correctOptionText: q.options[q.correctOptionId] || "",
        isCorrect,
        isAnswered,
        explanation: q.explanation || null,
        imageUrl: q.imageUrl || null,
      };
    });

    // Fallback: If correctCount is 0 but student has a positive score, compute from score
    if (correctCount === 0 && r.score > 0 && questions.length > 0) {
      correctCount = Math.round((r.score / 100) * questions.length);
    }

    const strictlyPassed = Boolean(r.passed) && r.score >= passingThreshold && (r.score > 0 || passingThreshold === 0);

    return {
      id: r.id,
      name: r.name,
      telegramId: r.telegramId,
      score: r.score,
      passed: strictlyPassed,
      duration: r.duration,
      completedAt: r.completedAt,
      answers: r.answers,
      correctCount,
      totalQuestions: questions.length,
      details,
    };
  });

  return NextResponse.json({
    exam: {
      id: exam.id,
      title: exam.title,
      description: exam.description,
      passingScore: exam.passingScore,
      timeLimit: exam.timeLimit,
      isPublished: exam.isPublished,
      createdAt: exam.createdAt,
      totalResults: totalCompleted,
      inProgressCount: inProgressResults.length,
      passCount,
      failCount,
      passRate,
      avgScore,
      highestScore,
      lowestScore,
      avgDuration,
      questionsCount: questions.length,
    },
    questionAnalytics,
    results: studentResults,
  });
}

// DELETE /api/groups/[groupId]/exams/[examId]/results
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ groupId: string; examId: string }> }
) {
  const { groupId, examId } = await params;
  const auth = await authorize(req, groupId);
  if (!auth) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { searchParams } = new URL(req.url);
  let resultId = searchParams.get("resultId");
  if (!resultId) {
    try {
      const body = await req.json();
      resultId = body?.resultId;
    } catch {
      // ignore JSON parse error if body was empty
    }
  }

  if (!resultId) {
    return NextResponse.json({ error: "resultId is required" }, { status: 400 });
  }

  const exam = await withRetry(() =>
    prisma.exam.findFirst({
      where: { id: examId, groupId },
    })
  );
  if (!exam) return NextResponse.json({ error: "Exam not found" }, { status: 404 });

  const result = await withRetry(() =>
    prisma.examResult.findFirst({
      where: { id: resultId, examId },
    })
  );
  if (!result) return NextResponse.json({ error: "Result not found" }, { status: 404 });

  await withRetry(() =>
    prisma.examResult.delete({
      where: { id: resultId },
    })
  );

  // Clean up any in-progress attempt records and in-memory session for a full fresh retake
  if (result.telegramId) {
    await withRetry(() =>
      prisma.examResult.deleteMany({
        where: { examId, telegramId: result.telegramId, score: -1 },
      })
    ).catch(() => {});

    if (globalThis.__examSessions) {
      globalThis.__examSessions.delete(`${result.telegramId}:${examId}`);
    }
  }

  return NextResponse.json({ ok: true, message: "Attempt reset successfully" });
}

