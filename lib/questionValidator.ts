export interface RawGeneratedQuestion {
  question?: string;
  questionText?: string;
  title?: string;
  prompt?: string;
  text?: string;
  q?: string;
  السؤال?: string;
  نص_السؤال?: string;
  سؤال?: string;
  options?: string[] | Record<string, string> | string;
  choices?: string[] | Record<string, string> | string;
  answers?: string[] | Record<string, string> | string;
  alternatives?: string[] | Record<string, string> | string;
  items?: string[] | Record<string, string> | string;
  distractors?: string[] | Record<string, string> | string;
  الخيارات?: string[] | Record<string, string> | string;
  خيارات?: string[] | Record<string, string> | string;
  الإجابات?: string[] | Record<string, string> | string;
  البدائل?: string[] | Record<string, string> | string;
  correctOptionId?: number | string;
  correct_option_id?: number | string;
  correctAnswer?: string | number;
  correct_answer?: string | number;
  correctOption?: string | number;
  correct_option?: string | number;
  answer?: string | number;
  correct?: string | number;
  rightAnswer?: string | number;
  solution?: string | number;
  key?: string | number;
  الإجابة_الصحيحة?: number | string;
  الاجابة_الصحيحة?: number | string;
  رقم_الإجابة?: number | string;
  الإجابة?: number | string;
  الحل?: number | string;
  explanation?: string;
  الشرح?: string;
  التفسير?: string;
  السبب?: string;
  التوضيح?: string;
  difficulty?: "EASY" | "MEDIUM" | "HARD" | string;
  الصعوبة?: string;
  مستوى_الصعوبة?: string;
  topic?: string;
  الموضوع?: string;
  الفصل?: string;
  bloomTaxonomy?: "Recall" | "Understanding" | "Application" | "Analysis" | string;
  groundingQuote?: string;
  الاقتباس?: string;
  الدليل?: string;
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
  if (maxLength <= 3) return cleaned.slice(0, maxLength);
  const targetLen = Math.max(0, maxLength - 3);
  let sliced = cleaned.slice(0, targetLen).replace(/[\s,\.\-:;]+$/, "");
  const lastSpace = sliced.lastIndexOf(" ");
  if (lastSpace > targetLen - 15 && lastSpace > 0) {
    sliced = sliced.slice(0, lastSpace).trim().replace(/[\s,\.\-:;]+$/, "");
  }
  return sliced + "...";
}

/**
 * Normalize difficulty string.
 */
function normalizeDifficulty(d?: string): "EASY" | "MEDIUM" | "HARD" {
  const upper = (d || "").trim().toUpperCase();
  if (upper.includes("EASY") || upper.includes("سهل") || upper.includes("بسيط") || upper.includes("مباشر")) return "EASY";
  if (upper.includes("HARD") || upper.includes("صعب") || upper.includes("متقدم") || upper.includes("عالي")) return "HARD";
  return "MEDIUM";
}

/**
 * Strips common prefixes and wrapper brackets from answer strings:
 * e.g. "(B)" -> "B", "[A]" -> "A", "Option 2" -> "2", "الخيار ب" -> "ب"
 */
function cleanAnswerCandidate(candidateStr: string): string {
  let s = candidateStr.trim();
  // Remove enclosing brackets or quotes
  s = s.replace(/^[\[\(\{'"«\s]+|[\]\)\}'"»\s]+$/g, "").trim();
  // Strip common label prefixes
  s = s.replace(/^(?:option|choice|answer|الخيار|الاختيار|الإجابة|الاجابة|البديل|رقم)\s*[:\-\.]?\s*/i, "").trim();
  // Remove any remaining enclosing parentheses
  s = s.replace(/^\((.+)\)$/, "$1").trim();
  return s;
}

/**
 * Resolve correct option index from varied LLM output formats.
 */
function resolveCorrectOptionIndex(
  raw: RawGeneratedQuestion,
  options: string[]
): number {
  if (options.length === 0) return 0;

  // Gather candidate value from any common LLM property name (English and Arabic)
  const candidate =
    raw.correctOptionId ??
    raw.correct_option_id ??
    raw.correctAnswer ??
    raw.correct_answer ??
    raw.correctOption ??
    raw.correct_option ??
    raw.answer ??
    raw.الإجابة_الصحيحة ??
    raw.الاجابة_الصحيحة ??
    raw.رقم_الإجابة ??
    raw.الإجابة ??
    raw.الحل ??
    (raw as any).correct ??
    (raw as any).rightAnswer ??
    (raw as any).solution ??
    (raw as any).key;

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
    if (candidate === options.length) {
      return options.length - 1;
    }
  }

  // 2. String representation
  const rawStr = String(candidate).trim();
  if (!rawStr) return 0;

  const cleanedStr = cleanAnswerCandidate(rawStr);

  // Check exact text matching against option contents first
  const lowerClean = cleanedStr.toLowerCase();
  for (let i = 0; i < options.length; i++) {
    const optLower = options[i].trim().toLowerCase();
    if (optLower === lowerClean || optLower === rawStr.toLowerCase()) {
      return i;
    }
  }

  // Letter matching (A, B, C, D, E... or Arabic أ, ب, ج, د...)
  const letterMap: Record<string, number> = {
    A: 0, B: 1, C: 2, D: 3, E: 4, F: 5, G: 6, H: 7, I: 8, J: 9,
    a: 0, b: 1, c: 2, d: 3, e: 4, f: 5, g: 6, h: 7, i: 8, j: 9,
    "أ": 0, "ا": 0, "ب": 1, "ج": 2, "د": 3, "هـ": 4, "ه": 4, "و": 5, "ز": 6, "ح": 7, "ط": 8, "ي": 9,
  };

  if (cleanedStr.length <= 2 && letterMap[cleanedStr] !== undefined) {
    const idx = letterMap[cleanedStr];
    if (idx < options.length) return idx;
  }

  // Numeric string like "0", "1", "2"
  const parsedNum = parseInt(cleanedStr, 10);
  if (!isNaN(parsedNum) && String(parsedNum) === cleanedStr) {
    if (parsedNum >= 0 && parsedNum < options.length) {
      return parsedNum;
    }
    if (parsedNum === options.length) {
      return options.length - 1;
    }
  }

  // Fuzzy text matching: require at least 4 characters to avoid false positive short matches
  if (lowerClean.length >= 4) {
    for (let i = 0; i < options.length; i++) {
      const optLower = options[i].trim().toLowerCase();
      if (optLower.includes(lowerClean) || lowerClean.includes(optLower)) {
        return i;
      }
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

  // 1. Question validation & sanitization (English and Arabic property keys)
  let question = (
    raw.question ||
    raw.questionText ||
    raw.title ||
    raw.prompt ||
    raw.text ||
    raw.q ||
    raw.السؤال ||
    raw.نص_السؤال ||
    raw.سؤال ||
    ""
  ).trim();

  if (!question) {
    errors.push("نص السؤال فارغ");
    question = `سؤال غير محدد ${index + 1}`;
  } else if (question.length > TELEGRAM_LIMITS.MAX_QUESTION_LENGTH) {
    errors.push(`السؤال تجاوز الحد الأقصى لتليجرام (${question.length}/300 حرف) - تم التهذيب تلقائياً`);
    question = cleanAndTruncate(question, TELEGRAM_LIMITS.MAX_QUESTION_LENGTH);
  }

  // 2. Options extraction & normalization (handles array, object key-value pairs, or string)
  const rawOptCandidates =
    raw.options ??
    raw.choices ??
    raw.answers ??
    raw.alternatives ??
    raw.items ??
    raw.distractors ??
    raw.الخيارات ??
    raw.خيارات ??
    raw.الإجابات ??
    raw.البدائل;

  let rawOptions: string[] = [];
  if (Array.isArray(rawOptCandidates)) {
    rawOptions = rawOptCandidates.map((o) =>
      typeof o === "object" && o !== null
        ? (o as any).text || (o as any).option || (o as any).title || (o as any).value || (o as any).content || String(o)
        : String(o || "")
    );
  } else if (rawOptCandidates && typeof rawOptCandidates === "object") {
    rawOptions = Object.values(rawOptCandidates).map((v) =>
      typeof v === "object" && v !== null
        ? (v as any).text || (v as any).option || (v as any).title || (v as any).value || String(v)
        : String(v || "")
    );
  } else if (typeof rawOptCandidates === "string") {
    rawOptions = (rawOptCandidates as string)
      .split(/\r?\n|;\s*|,\s*(?=[A-D\d]\)|\([A-D\d]\)|[A-D\d]\.)/)
      .map((s) => s.replace(/^[A-Da-d0-9\-\.\)\s]+/, "").trim())
      .filter(Boolean);
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
  let explanation = (
    raw.explanation ||
    raw.الشرح ||
    raw.التفسير ||
    raw.السبب ||
    raw.التوضيح ||
    ""
  ).trim();

  if (explanation.length > TELEGRAM_LIMITS.MAX_EXPLANATION_LENGTH) {
    errors.push(`الشرح تجاوز 200 حرف (${explanation.length}/200) - تم اختصاره لتوافق تليجرام`);
    explanation = cleanAndTruncate(explanation, TELEGRAM_LIMITS.MAX_EXPLANATION_LENGTH);
  }

  // 5. Grounding quote & metadata
  const groundingQuote = (raw.groundingQuote || raw.الاقتباس || raw.الدليل || "").trim();
  const difficulty = normalizeDifficulty(raw.difficulty || raw.الصعوبة || raw.مستوى_الصعوبة);
  const topic = (raw.topic || raw.الموضوع || raw.الفصل || "عام").trim().slice(0, 50);
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
