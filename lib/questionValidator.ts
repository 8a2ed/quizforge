export interface RawGeneratedQuestion {
  question: string;
  options: string[] | Record<string, string>;
  correctOptionId?: number | string;
  correct_option_id?: number | string;
  correctAnswer?: string | number;
  correct_answer?: string | number;
  correctOption?: string | number;
  correct_option?: string | number;
  answer?: string | number;
  explanation?: string;
  difficulty?: "EASY" | "MEDIUM" | "HARD" | string;
  topic?: string;
  bloomTaxonomy?: "Recall" | "Understanding" | "Application" | "Analysis" | string;
  groundingQuote?: string;
}

export interface ValidatedQuestion {
  id: string;
  question: string;
  options: string[];
  correctOptionId: number;
  explanation: string;
  difficulty: "EASY" | "MEDIUM" | "HARD";
  topic: string;
  bloomTaxonomy: string;
  groundingQuote: string;
  isValid: boolean;
  errors: string[];
}

export const TELEGRAM_LIMITS = {
  MAX_QUESTION_LENGTH: 300,
  MIN_OPTIONS: 2,
  MAX_OPTIONS: 10,
  MAX_OPTION_LENGTH: 100,
  MAX_EXPLANATION_LENGTH: 200,
} as const;

/**
 * Clean and truncate string cleanly at word boundary.
 */
export function cleanAndTruncate(str: string, maxLength: number): string {
  const cleaned = (str || "").trim().replace(/\s+/g, " ");
  if (cleaned.length <= maxLength) return cleaned;
  const targetLen = Math.max(0, maxLength - 3);
  const sliced = cleaned.slice(0, targetLen);
  const lastSpace = sliced.lastIndexOf(" ");
  if (lastSpace > targetLen - 15 && lastSpace > 0) {
    return sliced.slice(0, lastSpace).trim() + "...";
  }
  return sliced.trim() + "...";
}

/**
 * Normalize difficulty string.
 */
function normalizeDifficulty(d?: string): "EASY" | "MEDIUM" | "HARD" {
  const upper = (d || "").trim().toUpperCase();
  if (upper.includes("EASY") || upper.includes("سهل") || upper.includes("بسيط")) return "EASY";
  if (upper.includes("HARD") || upper.includes("صعب") || upper.includes("متقدم")) return "HARD";
  return "MEDIUM";
}

/**
 * Resolve correct option index from varied LLM output formats.
 */
function resolveCorrectOptionIndex(
  raw: RawGeneratedQuestion,
  options: string[]
): number {
  if (options.length === 0) return 0;

  // Gather candidate value from any common LLM property name
  const candidate =
    raw.correctOptionId ??
    raw.correct_option_id ??
    raw.correctAnswer ??
    raw.correct_answer ??
    raw.correctOption ??
    raw.correct_option ??
    raw.answer;

  if (candidate === undefined || candidate === null) {
    return 0;
  }

  // 1. Direct number check
  if (typeof candidate === "number" && !isNaN(candidate)) {
    // 0-based match
    if (candidate >= 0 && candidate < options.length) {
      return candidate;
    }
    // 1-based match (e.g. 1 to options.length)
    if (candidate >= 1 && candidate <= options.length) {
      return candidate - 1;
    }
  }

  // 2. String check
  const str = String(candidate).trim();
  if (!str) return 0;

  // Numeric string like "0", "1", "2"
  const parsedNum = parseInt(str, 10);
  if (!isNaN(parsedNum) && String(parsedNum) === str) {
    if (parsedNum >= 0 && parsedNum < options.length) {
      return parsedNum;
    }
    if (parsedNum >= 1 && parsedNum <= options.length) {
      return parsedNum - 1;
    }
  }

  // Letter matching (A, B, C, D, E...)
  const letterMap: Record<string, number> = {
    A: 0, B: 1, C: 2, D: 3, E: 4, F: 5, G: 6, H: 7, I: 8, J: 9,
    a: 0, b: 1, c: 2, d: 3, e: 4, f: 5, g: 6, h: 7, i: 8, j: 9,
    "أ": 0, "ا": 0, "ب": 1, "ج": 2, "د": 3, "هـ": 4, "ه": 4,
  };
  const firstChar = str.charAt(0);
  if (str.length <= 3 && letterMap[firstChar] !== undefined) {
    const idx = letterMap[firstChar];
    if (idx < options.length) return idx;
  }

  // Exact or fuzzy text matching against option contents
  const lowerStr = str.toLowerCase();
  for (let i = 0; i < options.length; i++) {
    const optLower = options[i].toLowerCase();
    if (optLower === lowerStr || optLower.includes(lowerStr) || lowerStr.includes(optLower)) {
      return i;
    }
  }

  return 0;
}

/**
 * Validate and sanitize generated question to strictly meet Telegram poll specifications.
 */
export function validateAndSanitizeQuestion(
  raw: RawGeneratedQuestion,
  index: number = 0
): ValidatedQuestion {
  const errors: string[] = [];

  // 1. Question validation & sanitization
  let question = (raw.question || "").trim();
  if (!question) {
    errors.push("نص السؤال فارغ");
    question = `سؤال غير محدد ${index + 1}`;
  } else if (question.length > TELEGRAM_LIMITS.MAX_QUESTION_LENGTH) {
    errors.push(`السؤال تجاوز الحد الأقصى لتليجرام (${question.length}/300 حرف) - تم التهذيب تلقائياً`);
    question = cleanAndTruncate(question, TELEGRAM_LIMITS.MAX_QUESTION_LENGTH);
  }

  // 2. Options extraction & normalization (handles array or object key-value pairs)
  let rawOptions: string[] = [];
  if (Array.isArray(raw.options)) {
    rawOptions = raw.options.map((o) => (typeof o === "object" && o !== null ? (o as any).text || (o as any).option || String(o) : String(o || "")));
  } else if (raw.options && typeof raw.options === "object") {
    rawOptions = Object.values(raw.options).map((v) => String(v || ""));
  }

  const processedOptions: string[] = [];
  const seenLower = new Set<string>();

  for (let i = 0; i < rawOptions.length; i++) {
    let opt = String(rawOptions[i] || "").trim();
    if (!opt) continue;

    // Truncate to limit initially
    if (opt.length > TELEGRAM_LIMITS.MAX_OPTION_LENGTH) {
      errors.push(`الخيار ${i + 1} تجاوز 100 حرف - تم تقصيره تلقائياً`);
      opt = cleanAndTruncate(opt, TELEGRAM_LIMITS.MAX_OPTION_LENGTH);
    }

    const lower = opt.toLowerCase();
    if (seenLower.has(lower)) {
      // Append subtle marker to distinguish duplicate choice while STRICTLY keeping <= 100 chars
      const marker = ` (${i + 1})`;
      const maxBaseLen = TELEGRAM_LIMITS.MAX_OPTION_LENGTH - marker.length;
      if (opt.length > maxBaseLen) {
        opt = opt.slice(0, maxBaseLen).trim() + marker;
      } else {
        opt = `${opt}${marker}`;
      }
    }
    seenLower.add(opt.toLowerCase());
    processedOptions.push(opt);
  }

  // Telegram requires 2 to 10 options
  if (processedOptions.length < TELEGRAM_LIMITS.MIN_OPTIONS) {
    errors.push(`الخيارات أقل من 2 خيارات (الموجود: ${processedOptions.length})`);
    while (processedOptions.length < 2) {
      processedOptions.push(`خيار بديل ${processedOptions.length + 1}`);
    }
  }

  if (processedOptions.length > TELEGRAM_LIMITS.MAX_OPTIONS) {
    errors.push(`تجاوز عدد الخيارات الحد الأقصى لتليجرام (10 خيارات) - تم تقليصها إلى 10`);
    processedOptions.splice(TELEGRAM_LIMITS.MAX_OPTIONS);
  }

  // 3. Correct Option ID resolution
  const correctOptionId = resolveCorrectOptionIndex(raw, processedOptions);

  // 4. Explanation validation
  let explanation = (raw.explanation || "").trim();
  if (explanation.length > TELEGRAM_LIMITS.MAX_EXPLANATION_LENGTH) {
    errors.push(`الشرح تجاوز 200 حرف (${explanation.length}/200) - تم اختصاره لتوافق تليجرام`);
    explanation = cleanAndTruncate(explanation, TELEGRAM_LIMITS.MAX_EXPLANATION_LENGTH);
  }

  // 5. Grounding quote & metadata
  const groundingQuote = (raw.groundingQuote || "").trim();
  const difficulty = normalizeDifficulty(raw.difficulty);
  const topic = (raw.topic || "عام").trim().slice(0, 50);
  const bloomTaxonomy = (raw.bloomTaxonomy || "Understanding").trim().slice(0, 30);

  const uid = `q_${Date.now()}_${index}_${Math.random().toString(36).substring(2, 7)}`;

  return {
    id: uid,
    question,
    options: processedOptions,
    correctOptionId,
    explanation,
    difficulty,
    topic,
    bloomTaxonomy,
    groundingQuote,
    isValid: errors.length === 0,
    errors,
  };
}
