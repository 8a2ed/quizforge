import { NextRequest, NextResponse } from "next/server";
import { jwtVerify } from "jose";
import { prisma, withRetry } from "@/lib/db";

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
}

// GET /api/groups/[groupId]/exams/[examId]/results
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ groupId: string; examId: string }> }
) {
  const { groupId, examId } = await params;
  const auth = await authorize(req, groupId);
  if (!auth) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

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
  }));

  const allResults = exam.results;
  const completedResults = allResults.filter(r => r.score >= 0);
  const inProgressResults = allResults.filter(r => r.score < 0);

  const totalCompleted = completedResults.length;
  const passCount = completedResults.filter(r => r.passed).length;
  const failCount = totalCompleted - passCount;
  const passRate = totalCompleted > 0 ? Math.round((passCount / totalCompleted) * 100) : 0;

  const scores = completedResults.map(r => r.score);
  const avgScore = totalCompleted > 0 ? Math.round(scores.reduce((a, b) => a + b, 0) / totalCompleted) : 0;
  const highestScore = totalCompleted > 0 ? Math.max(...scores) : 0;
  const lowestScore = totalCompleted > 0 ? Math.min(...scores) : 0;

  const validDurations = completedResults.map(r => r.duration || 0).filter(d => d > 0);
  const avgDuration = validDurations.length > 0 ? Math.round(validDurations.reduce((a, b) => a + b, 0) / validDurations.length) : 0;

  // ── Per-Question Analytics ───────────────────────────────────────
  const questionAnalytics = questions.map((q, qIdx) => {
    let qCorrectCount = 0;
    let qTotalAnswered = 0;
    const optionCounts = new Array(q.options.length).fill(0);

    for (const r of completedResults) {
      const userAnswers = (r.answers as Record<string, any>) || {};
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
      totalAnswered: qTotalAnswered,
      correctCount: qCorrectCount,
      successRate,
      difficulty,
      optionCounts,
      mostCommonMistake,
    };
  });

  // ── Enriched Student Submissions ─────────────────────────────────
  const studentResults = allResults.map(r => {
    const userAnswers = (r.answers as Record<string, any>) || {};
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
      };
    });

    return {
      id: r.id,
      name: r.name,
      telegramId: r.telegramId,
      score: r.score,
      passed: r.passed,
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
