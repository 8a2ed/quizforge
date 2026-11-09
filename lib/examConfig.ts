export interface ExamConfig {
  shuffleQuestions: boolean;
  shuffleOptions: boolean;
  showSolutionsImmediately?: boolean;
  maxAttempts?: number;
  isPaused?: boolean;
}

export interface StudentExamQuestion {
  question: string;
  options: string[];
  correctOptionId: number;
  explanation?: string;
  imageUrl?: string;
  originalQIndex: number;
  originalOptionIndices: number[]; // maps studentOptionIndex -> masterOptionIndex
}

export interface MasterExamQuestion {
  question: string;
  options: string[];
  correctOptionId: number;
  explanation?: string;
  imageUrl?: string;
}

/**
 * Standard Fisher-Yates array shuffle algorithm.
 */
export function shuffleArray<T>(array: T[]): T[] {
  const arr = [...array];
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

const CONFIG_REGEX = /<!--config:(\{.*?\})-->/;

/**
 * Parse anti-cheating configuration from exam description, returning clean description and booleans.
 */
export function parseExamConfig(rawDescription: string | null | undefined): {
  cleanDescription: string;
  shuffleQuestions: boolean;
  shuffleOptions: boolean;
  showSolutionsImmediately: boolean;
  maxAttempts: number;
  isPaused: boolean;
} {
  const desc = String(rawDescription || "").trim();
  const match = desc.match(CONFIG_REGEX);

  let shuffleQuestions = true;
  let shuffleOptions = true;
  let showSolutionsImmediately = true;
  let maxAttempts = 1;
  let isPaused = false;

  if (match) {
    try {
      const parsed = JSON.parse(match[1]);
      if (typeof parsed.shuffleQuestions === "boolean") shuffleQuestions = parsed.shuffleQuestions;
      if (typeof parsed.shuffleOptions === "boolean") shuffleOptions = parsed.shuffleOptions;
      if (typeof parsed.showSolutionsImmediately === "boolean") showSolutionsImmediately = parsed.showSolutionsImmediately;
      if (typeof parsed.maxAttempts === "number") maxAttempts = Math.max(0, parsed.maxAttempts);
      if (typeof parsed.isPaused === "boolean") isPaused = parsed.isPaused;
    } catch {
      // ignore parse error, use defaults
    }
  }

  const cleanDescription = desc.replace(CONFIG_REGEX, "").trim();

  return {
    cleanDescription,
    shuffleQuestions,
    shuffleOptions,
    showSolutionsImmediately,
    maxAttempts,
    isPaused,
  };
}

/**
 * Encode anti-cheating configuration inside the exam description string.
 */
export function formatExamDescription(
  cleanDescription: string | null | undefined,
  config: {
    shuffleQuestions?: boolean;
    shuffleOptions?: boolean;
    showSolutionsImmediately?: boolean;
    maxAttempts?: number;
    isPaused?: boolean;
  }
): string {
  const base = String(cleanDescription || "").replace(CONFIG_REGEX, "").trim();
  const meta = {
    shuffleQuestions: config.shuffleQuestions ?? true,
    shuffleOptions: config.shuffleOptions ?? true,
    showSolutionsImmediately: config.showSolutionsImmediately ?? true,
    maxAttempts: typeof config.maxAttempts === "number" ? Math.max(0, config.maxAttempts) : 1,
    isPaused: config.isPaused ?? false,
  };

  const tag = `<!--config:${JSON.stringify(meta)}-->`;
  return base ? `${base}\n\n${tag}` : tag;
}

/**
 * Prepares a customized randomized question set for an individual student.
 */
export function prepareStudentExamQuestions(
  masterQuestions: MasterExamQuestion[],
  config: { shuffleQuestions?: boolean; shuffleOptions?: boolean }
): StudentExamQuestion[] {
  const shouldShuffleQ = config.shuffleQuestions ?? true;
  const shouldShuffleOpts = config.shuffleOptions ?? true;

  // 1. Prepare each question, optionally shuffling its options
  const prepared: StudentExamQuestion[] = masterQuestions.map((q, originalQIndex) => {
    if (!shouldShuffleOpts || q.options.length < 2) {
      return {
        question: q.question,
        options: [...q.options],
        correctOptionId: q.correctOptionId,
        explanation: q.explanation,
        imageUrl: q.imageUrl,
        originalQIndex,
        originalOptionIndices: q.options.map((_, i) => i),
      };
    }

    // Pair each option with its original index
    const paired = q.options.map((text, origIdx) => ({ text, origIdx }));
    const shuffled = shuffleArray(paired);

    const newCorrectOptionId = shuffled.findIndex(item => item.origIdx === q.correctOptionId);

    return {
      question: q.question,
      options: shuffled.map(item => item.text),
      correctOptionId: newCorrectOptionId >= 0 ? newCorrectOptionId : q.correctOptionId,
      explanation: q.explanation,
      imageUrl: q.imageUrl,
      originalQIndex,
      originalOptionIndices: shuffled.map(item => item.origIdx),
    };
  });

  // 2. Optionally shuffle question order
  if (shouldShuffleQ && prepared.length > 1) {
    return shuffleArray(prepared);
  }

  return prepared;
}

/**
 * Maps student answers back to the master question and option indices
 * for storage in ExamResult.answers.
 */
export function mapStudentAnswersToMaster(
  studentQuestions: StudentExamQuestion[],
  studentAnswers: Record<number, number>
): Record<number, number> {
  const masterAnswers: Record<number, number> = {};

  studentQuestions.forEach((sq, studentQIdx) => {
    const studentChoice = studentAnswers[studentQIdx];
    if (studentChoice !== undefined && studentChoice !== null) {
      const origQ = sq.originalQIndex ?? studentQIdx;
      const origOpt = sq.originalOptionIndices && sq.originalOptionIndices[studentChoice] !== undefined
        ? sq.originalOptionIndices[studentChoice]
        : studentChoice;

      masterAnswers[origQ] = origOpt;
    }
  });

  return masterAnswers;
}


function isAnswerRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseNonNegativeInteger(value: unknown): number | null {
  if (typeof value === "number") return Number.isInteger(value) && value >= 0 ? value : null;
  if (typeof value !== "string" || !/^\d+$/.test(value.trim())) return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? parsed : null;
}

function normalizeAnswerMap(value: unknown): Record<number, number> {
  if (!isAnswerRecord(value)) return {};
  const normalized: Record<number, number> = {};
  for (const [rawQuestionIndex, rawOptionIndex] of Object.entries(value)) {
    const questionIndex = parseNonNegativeInteger(rawQuestionIndex);
    const optionIndex = parseNonNegativeInteger(rawOptionIndex);
    if (questionIndex !== null && optionIndex !== null) {
      normalized[questionIndex] = optionIndex;
    }
  }
  return normalized;
}

function normalizeStudentQuestions(value: unknown): StudentExamQuestion[] | null {
  if (!Array.isArray(value) || value.length === 0) return null;
  const normalized: StudentExamQuestion[] = [];

  for (const [studentIndex, rawQuestion] of value.entries()) {
    if (!isAnswerRecord(rawQuestion) || !Array.isArray(rawQuestion.options)) return null;
    if (!rawQuestion.options.every((option) => typeof option === "string")) return null;
    const options = rawQuestion.options as string[];
    const originalOptionIndices = Array.isArray(rawQuestion.originalOptionIndices) &&
      rawQuestion.originalOptionIndices.length === options.length &&
      rawQuestion.originalOptionIndices.every((index) => typeof index === "number" && Number.isInteger(index) && index >= 0)
      ? rawQuestion.originalOptionIndices as number[]
      : options.map((_, index) => index);
    const originalQIndex = typeof rawQuestion.originalQIndex === "number" &&
      Number.isInteger(rawQuestion.originalQIndex) && rawQuestion.originalQIndex >= 0
      ? rawQuestion.originalQIndex
      : studentIndex;

    normalized.push({
      question: typeof rawQuestion.question === "string" ? rawQuestion.question : "",
      options,
      correctOptionId: typeof rawQuestion.correctOptionId === "number" && Number.isInteger(rawQuestion.correctOptionId)
        ? rawQuestion.correctOptionId
        : 0,
      explanation: typeof rawQuestion.explanation === "string" ? rawQuestion.explanation : undefined,
      imageUrl: typeof rawQuestion.imageUrl === "string" ? rawQuestion.imageUrl : undefined,
      originalQIndex,
      originalOptionIndices,
    });
  }

  return normalized;
}

/** Normalize flat results, legacy arrays, and in-progress session snapshots. */
export function extractStudentMasterAnswers(rawAnswers: unknown): Record<string, number> {
  let parsed: unknown = rawAnswers;
  if (typeof rawAnswers === "string") {
    try {
      parsed = JSON.parse(rawAnswers) as unknown;
    } catch {
      return {};
    }
  }

  if (Array.isArray(parsed)) {
    const answers: Record<string, number> = {};
    parsed.forEach((value, questionIndex) => {
      if (typeof value === "number" && Number.isInteger(value) && value >= 0) {
        answers[String(questionIndex)] = value;
      } else if (isAnswerRecord(value)) {
        const optionIndex = value.chosenOptionId ?? value.optionIndex ?? value.optionId;
        if (typeof optionIndex === "number" && Number.isInteger(optionIndex) && optionIndex >= 0) {
          answers[String(questionIndex)] = optionIndex;
        }
      }
    });
    return answers;
  }

  if (!isAnswerRecord(parsed)) return {};
  if (isAnswerRecord(parsed.answers)) {
    const studentAnswers = normalizeAnswerMap(parsed.answers);
    const studentQuestions = normalizeStudentQuestions(parsed.questions);
    if (studentQuestions) {
      const mapped = mapStudentAnswersToMaster(studentQuestions, studentAnswers);
      const answers: Record<string, number> = {};
      for (const [questionIndex, optionIndex] of Object.entries(mapped)) {
        answers[String(questionIndex)] = optionIndex;
      }
      return answers;
    }

    const answers: Record<string, number> = {};
    for (const [questionIndex, optionIndex] of Object.entries(studentAnswers)) {
      answers[String(questionIndex)] = optionIndex;
    }
    return answers;
  }

  const flatAnswers = normalizeAnswerMap(parsed);
  const answers: Record<string, number> = {};
  for (const [questionIndex, optionIndex] of Object.entries(flatAnswers)) {
    answers[String(questionIndex)] = optionIndex;
  }
  return answers;
}
