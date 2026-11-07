export interface ExamConfig {
  shuffleQuestions: boolean;
  shuffleOptions: boolean;
  showSolutionsImmediately?: boolean;
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
} {
  const desc = String(rawDescription || "").trim();
  const match = desc.match(CONFIG_REGEX);

  let shuffleQuestions = true;
  let shuffleOptions = true;
  let showSolutionsImmediately = true;

  if (match) {
    try {
      const parsed = JSON.parse(match[1]);
      if (typeof parsed.shuffleQuestions === "boolean") shuffleQuestions = parsed.shuffleQuestions;
      if (typeof parsed.shuffleOptions === "boolean") shuffleOptions = parsed.shuffleOptions;
      if (typeof parsed.showSolutionsImmediately === "boolean") showSolutionsImmediately = parsed.showSolutionsImmediately;
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
  };
}

/**
 * Encode anti-cheating configuration inside the exam description string.
 */
export function formatExamDescription(
  cleanDescription: string | null | undefined,
  config: { shuffleQuestions?: boolean; shuffleOptions?: boolean; showSolutionsImmediately?: boolean }
): string {
  const base = String(cleanDescription || "").replace(CONFIG_REGEX, "").trim();
  const meta = {
    shuffleQuestions: config.shuffleQuestions ?? true,
    shuffleOptions: config.shuffleOptions ?? true,
    showSolutionsImmediately: config.showSolutionsImmediately ?? true,
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


/**
 * Universal extractor for student answers that handles:
 * 1. Flat master maps: { "0": 1, "1": 3 }
 * 2. Session objects: { answers: { ... }, questions: [...] }
 * 3. Array formats: [1, 3, 0]
 */
export function extractStudentMasterAnswers(
  rawAnswers: unknown,
  masterQuestions?: Array<{ question: string; options: string[]; correctOptionId: number; explanation?: string }>
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

  // Case B: Array format [1, 0, 2]
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
