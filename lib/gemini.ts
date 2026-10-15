import {
  RawGeneratedQuestion,
  ValidatedQuestion,
  validateAndSanitizeQuestion,
} from "./questionValidator";
import { cleanText, splitIntoSections } from "./textCleaner";

export const DEFAULT_GEMINI_MODEL = "gemini-3.8-flash";

export interface ModelDescriptor {
  id: string;
  labelAr: string;
  labelEn: string;
  description: string;
  isRecommended?: boolean;
}

export const RECOMMENDED_GEMINI_MODELS: ModelDescriptor[] = [
  {
    id: "gemini-3.8-flash",
    labelAr: "gemini-3.8-flash (الأحدث والأسرع - موصى به)",
    labelEn: "gemini-3.8-flash (Latest & Fastest - Recommended)",
    description: "الأحدث والأسرع - موصى به",
    isRecommended: true,
  },
  {
    id: "gemini-2.5-flash",
    labelAr: "gemini-2.5-flash (أداء متوازن وسريع)",
    labelEn: "gemini-2.5-flash (Fast & Balanced)",
    description: "أداء متوازن وسريع",
  },
  {
    id: "gemini-2.5-pro",
    labelAr: "gemini-2.5-pro (تفكير تحليلي متقدم)",
    labelEn: "gemini-2.5-pro (Advanced Reasoning)",
    description: "تفكير تحليلي متقدم",
  },
];

export const BASE_GEMINI_MODELS = RECOMMENDED_GEMINI_MODELS.map((m) => m.id);

export interface AvailableGeminiModel {
  id: string;
  name: string;
  displayName: string;
  description: string;
  supportedGenerationMethods: string[];
}

export interface GenerateOptions {
  apiKey?: string;
  model?: string;
  textExcerpt: string;
  materialTitle?: string;
  topic?: string;
  questionCount?: number;
  difficulty?: "mixed" | "easy" | "medium" | "hard";
  strictGrounding?: boolean;
  systemInstruction?: string;
  bloomTaxonomy?: string[];
}

export interface GenerationResult {
  questions: ValidatedQuestion[];
  rawResponse?: string;
  modelUsed: string;
  fallbackUsed?: boolean;
  estimatedTokens: number;
  durationMs: number;
}

export interface GeminiTestResult {
  success: boolean;
  message: string;
  latencyMs: number;
  activeModel?: string;
  availableModels?: AvailableGeminiModel[];
  fallbackUsed?: boolean;
}

const DEFAULT_SYSTEM_INSTRUCTION = `
You are an uncompromising master psychometrician, academic examination designer, and curriculum assessor.
Your mission is to generate high-yield, crystal-clear Multiple-Choice Questions (MCQs) STRICTLY AND EXCLUSIVELY based upon the textbook excerpt provided.

CRITICAL ZERO-HALLUCINATION & PSYCHOMETRIC DISTRACTOR RULES:
1. STRICT GROUNDING: Every question, every correct answer, and every explanation MUST be directly, unambiguously verifiable within the excerpt text provided. Never fabricate, extrapolate, or assume facts.
2. NO EXTERNAL KNOWLEDGE: Never bring in external facts, dates, names, or formulas from outside the text, even if true in reality. If it is not explicitly in the text, it does not exist.
3. SCIENTIFICALLY ROBUST DISTRACTORS (الخيارات المشتتة والبدائل):
   - PLAUSIBLE MISCONCEPTIONS: Every incorrect option (distractor) MUST be carefully designed to reflect plausible, common student misconceptions, inverted logic, or frequent confusion between related concepts mentioned in the text.
   - TEXT-DERIVED TERMINOLOGY: Distractors must use genuine scientific/academic terms and concepts found elsewhere in the textbook excerpt, but applied incorrectly to this question context. NEVER use silly, absurd, or obvious giveaway choices.
   - STRUCTURAL & LENGTH HOMOGENEITY (التجانس التام): All options in a question MUST be approximately equal in length, grammatical structure, and syntax. NEVER make the correct option noticeably longer, more detailed, or distinct from the distractors.
   - EXCLUSIVITY & NO META-OPTIONS: Strictly NEVER use "جميع ما سبق" (All of the above), "لا شيء مما سبق" (None of the above), "أ وب معاً", or "كل الخيارات صحيحة". Each option must be an independent, concrete concept.
4. EXACT EVIDENCE: Every question MUST include "groundingQuote" quoting verbatim the exact phrase or sentence from the excerpt proving the answer.
5. PEDAGOGICAL EXPLANATION & CITATION:
   - "explanation" (max 200 chars): Concisely explain why the correct option is true based on the text, and briefly pinpoint the misconception behind the distractors, ending with the source section reference: [المرجع: عنوان الفصل أو الموضوع].
6. TELEGRAM CONSTRAINTS COMPLIANCE:
   - "question": Direct question stem containing the core problem, max 300 characters.
   - "options": Exactly 4 distinct options (or 2-4 if true/false). Max 100 characters per option. NO duplicate options.
   - "correctOptionId": 0-based integer index pointing to the correct option. Distribute the correct index across positions (0, 1, 2, 3) randomly.
   - "explanation": Max 200 characters.
   - "difficulty": "EASY" | "MEDIUM" | "HARD".
   - "topic": Topic or heading name.
   - "bloomTaxonomy": "Recall" | "Understanding" | "Application" | "Analysis".

OUTPUT SCHEMA:
Return a JSON object containing:
{
  "questions": [
    {
      "question": "نص السؤال هنا",
      "options": ["خيار 1", "خيار 2", "خيار 3", "خيار 4"],
      "correctOptionId": 0,
      "explanation": "شرح الإجابة هنا",
      "difficulty": "EASY",
      "topic": "اسم الموضوع",
      "bloomTaxonomy": "Understanding",
      "groundingQuote": "الاقتباس الحرفي من النص"
    }
  ]
}
`;

/**
 * Normalizes model names by stripping any leading 'models/' or '/models/' prefix
 * and falling back to DEFAULT_GEMINI_MODEL if empty.
 */
export function normalizeModelName(model?: string): string {
  if (!model) return DEFAULT_GEMINI_MODEL;
  const trimmed = model.trim();
  const cleaned = trimmed.replace(/^\/?models\//, "");
  return cleaned || DEFAULT_GEMINI_MODEL;
}

/**
 * Checks if the API response indicates that the model was not found,
 * is deprecated/discontinued, or not supported for generateContent.
 */
export function isModelNotFoundError(status: number, message: string): boolean {
  if (status === 404) return true;
  const lower = (message || "").toLowerCase();
  return (
    lower.includes("not found") ||
    lower.includes("no longer available") ||
    lower.includes("is not supported for generatecontent") ||
    lower.includes("call modelservice.listmodels") ||
    lower.includes("please update your code") ||
    lower.includes("deprecated") ||
    lower.includes("discontinued")
  );
}

/**
 * Checks if model should trigger fallback: either 404 (model not found/deprecated)
 * or 429 quota exhaustion specifically on the requested model (e.g. limit: 20 per day).
 */
export function shouldTriggerModelFallback(status: number, message: string): boolean {
  if (isModelNotFoundError(status, message)) return true;
  if (status === 429 || status === 500 || status === 502 || status === 503 || status === 504) {
    return true;
  }
  const lower = (message || "").toLowerCase();
  if (
    lower.includes("quota exceeded") ||
    lower.includes("rate limit") ||
    lower.includes("free_tier_requests") ||
    lower.includes("resource_exhausted") ||
    lower.includes("limit:") ||
    lower.includes("retry in") ||
    lower.includes("overloaded") ||
    lower.includes("high demand") ||
    lower.includes("unavailable") ||
    lower.includes("not supported for generatecontent") ||
    lower.includes("only supports interactions api")
  ) {
    return true;
  }
  return false;
}

/**
 * Known legacy models that have been deprecated or failed with 404 in Google Gemini API.
 */
export const KNOWN_DEPRECATED_MODELS = new Set([
  "gemini-2.0-flash",
  "gemini-1.5-flash",
  "gemini-1.5-pro",
  "gemini-1.0-pro",
  "gemini-2.5-flash-lite",
]);

/**
 * Builds an ordered list of fallback candidates:
 * 1. DEFAULT_GEMINI_MODEL (gemini-3.8-flash)
 * 2. Stable modern models (gemini-3.5-flash, gemini-3.6-flash, etc.)
 * 3. Any models returned by dynamic ListModels API
 * Filters out the failed model, known deprecated models, and non-text models (tts, image, etc.).
 */
export function getFallbackCandidates(
  failedModel: string,
  dynamicModels: AvailableGeminiModel[] = []
): string[] {
  const cleanFailed = normalizeModelName(failedModel);
  const candidates: string[] = [];

  const isNonTextModel = (name: string): boolean => {
    const lower = name.toLowerCase();
    return (
      lower.includes("-tts") ||
      lower.includes("-image") ||
      lower.includes("computer-use") ||
      lower.includes("embedding") ||
      lower.includes("nano") ||
      lower.includes("deep-research") ||
      lower.includes("lyria") ||
      lower.includes("aqa") ||
      lower.includes("robotics") ||
      lower.includes("transcribe") ||
      lower.includes("audio") ||
      lower.includes("customtools")
    );
  };

  const addIfValid = (m: string) => {
    const clean = normalizeModelName(m);
    if (!clean || clean === cleanFailed) return;
    if (KNOWN_DEPRECATED_MODELS.has(clean)) return;
    if (isNonTextModel(clean)) return;
    if (!candidates.includes(clean)) {
      candidates.push(clean);
    }
  };

  addIfValid(DEFAULT_GEMINI_MODEL);
  addIfValid("gemini-2.5-flash");
  addIfValid("gemini-2.5-pro");

  // Sort dynamic models so text flash models come first and non-text models are excluded
  const sortedDynamic = [...dynamicModels]
    .filter((m) => !isNonTextModel(m.id))
    .sort((a, b) => getModelSortScore(b.id) - getModelSortScore(a.id));

  for (const m of sortedDynamic) {
    addIfValid(m.id);
  }

  return candidates;
}

function getModelSortScore(id: string): number {
  if (id === DEFAULT_GEMINI_MODEL) return 1000;
  if (
    id.includes("-tts") ||
    id.includes("-image") ||
    id.includes("computer-use") ||
    id.includes("audio") ||
    id.includes("robotics") ||
    id.includes("transcribe") ||
    id.includes("deep-research")
  ) {
    return 0;
  }
  if (id.includes("3.8") && id.includes("flash")) return 980;
  if (id.includes("3.6") && id.includes("flash")) return 960;
  if (id.includes("3.5") && id.includes("flash")) return 950;
  if (id.includes("3.7") && id.includes("flash")) return 940;
  if (id.includes("flash-latest")) return 930;
  if (id.includes("2.5") && id.includes("flash")) return 900;
  if (id.includes("2.5") && id.includes("pro")) return 890;
  if (id.includes("pro-latest")) return 880;
  if (id.includes("3-flash")) return 870;
  if (id.includes("3.5") && id.includes("lite")) return 800;
  if (id.includes("3.1") && id.includes("lite")) return 790;
  if (id.includes("flash-lite-latest")) return 780;
  if (id.includes("flash")) return 750;
  if (id.includes("pro")) return 700;
  return 100;
}

/**
 * Fetches available models from Google Generative Language API
 * filtered by support for 'generateContent'.
 */
export async function fetchAvailableGeminiModels(apiKey: string): Promise<AvailableGeminiModel[]> {
  const cleanKey = apiKey.trim();
  if (!cleanKey) return [];

  const versions = ["v1beta", "v1"];
  for (const v of versions) {
    try {
      const url = `https://generativelanguage.googleapis.com/${v}/models?key=${cleanKey}`;
      const res = await fetch(url, {
        method: "GET",
        signal: AbortSignal.timeout(10000),
      });
      if (res.ok) {
        const data = await res.json();
        if (Array.isArray(data.models)) {
          const contentModels: AvailableGeminiModel[] = data.models
            .filter((m: any) => {
              const methods: string[] = m.supportedGenerationMethods || [];
              return methods.includes("generateContent");
            })
            .map((m: any) => {
              const id = (m.name || "").replace(/^\/?models\//, "");
              return {
                id,
                name: m.name || `models/${id}`,
                displayName: m.displayName || id,
                description: m.description || "",
                supportedGenerationMethods: m.supportedGenerationMethods || [],
              };
            });

          if (contentModels.length > 0) {
            contentModels.sort((a, b) => {
              const diff = getModelSortScore(b.id) - getModelSortScore(a.id);
              if (diff !== 0) return diff;
              return a.id.localeCompare(b.id);
            });
            return contentModels;
          }
        }
      }
    } catch (e) {
      console.warn(`[Gemini] Failed to list models via ${v}:`, e);
    }
  }

  return [];
}

/**
 * Estimate token count approximately (for Arabic/multilingual text ~2.5 chars per token).
 */
export function estimateTokens(text: string): number {
  return Math.ceil((text || "").length / 2.5);
}

/**
 * Helper to call Gemini generateContent endpoint.
 */
async function callGeminiGenerateContent(
  model: string,
  requestBody: any,
  apiKey: string,
  timeoutMs: number = 45000
): Promise<{ ok: boolean; status: number; text: string; errorDetails: string }> {
  const cleanModel = normalizeModelName(model);
  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${cleanModel}:generateContent?key=${encodeURIComponent(apiKey)}`;

  try {
    let res = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-goog-api-key": apiKey,
      },
      body: JSON.stringify(requestBody),
      signal: AbortSignal.timeout(timeoutMs),
    });

    // If 400 Bad Request happens and we sent responseSchema, retry without responseSchema
    if (!res.ok && res.status === 400 && requestBody?.generationConfig?.responseSchema) {
      const fallbackBody = {
        ...requestBody,
        generationConfig: {
          ...requestBody.generationConfig,
        },
      };
      delete fallbackBody.generationConfig.responseSchema;
      try {
        const retryRes = await fetch(endpoint, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-goog-api-key": apiKey,
          },
          body: JSON.stringify(fallbackBody),
          signal: AbortSignal.timeout(timeoutMs),
        });
        if (retryRes.ok) {
          res = retryRes;
        }
      } catch {}
    }

    if (!res.ok) {
      let errorDetails = "";
      try {
        const errJson = await res.json();
        errorDetails = errJson.error?.message || JSON.stringify(errJson);
      } catch {
        errorDetails = await res.text();
      }
      return { ok: false, status: res.status, text: "", errorDetails };
    }

    const data = await res.json();

    // Check Google safety prompt feedback
    if (data.promptFeedback?.blockReason) {
      return {
        ok: false,
        status: 400,
        text: "",
        errorDetails: `تم حجب الطلب بواسطة سياسة الأمان الخاصة بـ Google (${data.promptFeedback.blockReason})`,
      };
    }

    const candidate = data.candidates?.[0];
    const parts = candidate?.content?.parts || [];
    // Exclude thought/reasoning parts so they don't break JSON parsing
    const contentParts = parts.filter((p: any) => !p.thought && typeof p.text === "string");
    const rawText = (contentParts.length > 0 ? contentParts : [])
      .map((p: any) => (typeof p.text === "string" ? p.text : ""))
      .join("");

    if (candidate?.finishReason && candidate.finishReason !== "STOP") {
      const reason = candidate.finishReason;
      if (reason === "SAFETY") {
        return {
          ok: false,
          status: 400,
          text: "",
          errorDetails: "تم إيقاف التوليد لمخالفة معايير الأمان للنص المرفوع (SAFETY)",
        };
      }
      if (!rawText) {
        return {
          ok: false,
          status: 400,
          text: "",
          errorDetails: `النموذج أنهى التوليد مبكراً بسبب (${reason})`,
        };
      }
    }
    return { ok: true, status: 200, text: rawText, errorDetails: "" };
  } catch (err: any) {
    return {
      ok: false,
      status: 500,
      text: "",
      errorDetails: err instanceof Error ? err.message : String(err),
    };
  }
}

/**
 * Generate questions via Google Gemini API with strict Zero-Hallucination grounding
 * and intelligent auto-fallback when models are deprecated or not found (404).
 */
export async function generateCurriculumQuestions(
  options: GenerateOptions
): Promise<GenerationResult> {
  const startTime = Date.now();
  const apiKey =
    options.apiKey?.trim() ||
    process.env.GEMINI_API_KEY?.trim() ||
    "";

  if (!apiKey) {
    throw new Error(
      "لم يتم العثور على مفتاح Google Gemini API Key. يرجى إدخال المفتاح في تبويب 'إعدادات الذكاء الاصطناعي' أو إضافته في ملف البيئة (GEMINI_API_KEY)."
    );
  }

  if (!options.textExcerpt || !options.textExcerpt.trim()) {
    throw new Error("نص المنهج الدراسي فارغ. يرجى توفير مقتطف نصي كافٍ لتوليد الأسئلة.");
  }

  const requestedModel = normalizeModelName(options.model || DEFAULT_GEMINI_MODEL);
  const count = Math.min(Math.max(options.questionCount || 5, 1), 30);
  const difficulty = options.difficulty || "mixed";

  let prompt = `يرجى توليد عدد (${count}) أسئلة اختيار من متعدد (MCQs) فائقة الدقة والاحترافية بالاعتماد الصارم والحصري على النص الدراسي المرفق أدناه فقط.\n\n`;
  if (options.materialTitle) {
    prompt += `عنوان المادة/الكتاب: ${options.materialTitle}\n`;
  }
  if (options.topic) {
    prompt += `التركيز على موضوع/فصل: ${options.topic}\n`;
  }

  prompt += `مستوى الصعوبة المطلوب: ${difficulty}\n`;
  prompt += `معايير جودة المشتتات والخيارات والتوثيق (Psychometric Distractor & Citation Standards):
1. هندسة الخيارات الخاطئة (المشتتات): يجب أن تكون مقنعة للغاية ومبنية على أخطاء ومفاهيم شائعة لدى الطلاب (Plausible Misconceptions) ومستمدة من مصطلحات ومفاهيم وردت في النص نفسه، مع تجنب أي خيار مضحك أو ساذج.
2. التجانس الشكلي واللغوي: يجب أن تكون كافة الخيارات متقاربة جداً في الطول والصياغة النحوية، مع تجنب جعل الإجابة الصحيحة هي الأطول دائماً.
3. استقلالية الخيارات: يمنع منعاً باتاً استخدام "جميع ما سبق"، "لا شيء مما سبق"، "أ وب معاً" أو أي خيارات تركيبية.
4. توثيق المرجع (sourceReference): اذكر اسم الفصل أو القسم أو المبحث الذي استُخرج منه السؤال بدقة.\n`;

  if (options.systemInstruction) {
    prompt += `تعليمات إضافية من المعلم: ${options.systemInstruction}\n`;
  }
  prompt += `\n--- بداية النص الدراسي المعتمد ---\n${options.textExcerpt}\n--- نهاية النص الدراسي المعتمد ---\n`;

  const requestBody = {
    systemInstruction: {
      parts: [{ text: DEFAULT_SYSTEM_INSTRUCTION }],
    },
    contents: [
      {
        role: "user",
        parts: [{ text: prompt }],
      },
    ],
    generationConfig: {
      responseMimeType: "application/json",
      responseSchema: {
        type: "OBJECT",
        properties: {
          questions: {
            type: "ARRAY",
            items: {
              type: "OBJECT",
              properties: {
                question: { type: "STRING", description: "Direct question text, maximum 300 characters" },
                options: {
                  type: "ARRAY",
                  items: { type: "STRING" },
                  description: "2 to 4 distinct answer options, maximum 100 characters each",
                },
                correctOptionId: { type: "INTEGER", description: "0-based integer index of correct option" },
                explanation: { type: "STRING", description: "Clear explanation why the answer is correct, maximum 200 characters" },
                sourceReference: { type: "STRING", description: "Source section, page or topic reference, maximum 50 characters" },
                difficulty: { type: "STRING", enum: ["EASY", "MEDIUM", "HARD"] },
                topic: { type: "STRING", description: "Short topic name, maximum 40 characters" },
                bloomTaxonomy: { type: "STRING", enum: ["Recall", "Understanding", "Application", "Analysis"] },
                groundingQuote: { type: "STRING", description: "Short quote from excerpt proving the answer, maximum 150 characters" },
              },
              required: ["question", "options", "correctOptionId", "explanation"],
            },
          },
        },
        required: ["questions"],
      },
      temperature: 0.25,
      maxOutputTokens: 8192,
    },
  };

  let activeModel = requestedModel;
  let fallbackUsed = false;
  let apiRes = await callGeminiGenerateContent(requestedModel, requestBody, apiKey, 120000);

  let rawQuestions: RawGeneratedQuestion[] = [];
  if (apiRes.ok && apiRes.text) {
    try {
      rawQuestions = extractQuestionsFromJson(apiRes.text);
    } catch (parseErr) {
      console.warn(`[Gemini] Initial model '${requestedModel}' produced unparseable output:`, parseErr);
    }
  }

  // If initial model failed or parsing produced no valid questions, try fallback candidates
  if (!apiRes.ok || rawQuestions.length === 0) {
    console.warn(
      `[Gemini] Model '${requestedModel}' failed or returned invalid response (status: ${apiRes.status}). Initiating auto-fallback...`
    );

    let fetched: AvailableGeminiModel[] = [];
    try {
      fetched = await fetchAvailableGeminiModels(apiKey);
    } catch {
      // Continue with static modern candidates
    }

    const fallbackCandidates = getFallbackCandidates(requestedModel, fetched);

    for (const candidate of fallbackCandidates) {
      if (candidate === requestedModel) continue;
      console.log(`[Gemini] Attempting fallback model: ${candidate}`);
      const fallbackRes = await callGeminiGenerateContent(candidate, requestBody, apiKey, 120000);
      if (fallbackRes.ok && fallbackRes.text) {
        try {
          const candidateQuestions = extractQuestionsFromJson(fallbackRes.text);
          if (candidateQuestions.length > 0) {
            console.log(`[Gemini] Fallback succeeded with model: ${candidate} (${candidateQuestions.length} questions)`);
            apiRes = fallbackRes;
            activeModel = candidate;
            fallbackUsed = true;
            rawQuestions = candidateQuestions;
            break;
          }
        } catch (e) {
          console.warn(`[Gemini] Fallback model '${candidate}' returned unparseable output:`, e);
        }
      }
    }
  }

  if (!apiRes.ok) {
    throw new Error(`خطأ في استجابة Gemini (${apiRes.status}): ${apiRes.errorDetails}`);
  }

  const rawText = apiRes.text;
  if (!rawText) {
    throw new Error("لم يتم استلام أي نص من نموذج الذكاء الاصطناعي");
  }

  if (rawQuestions.length === 0) {
    throw new Error("لم يحتوِ رد الذكاء الاصطناعي على أي أسئلة صالحة");
  }

  // Sanitize and validate every question for Telegram compliance
  const validatedQuestions: ValidatedQuestion[] = rawQuestions.map((q, idx) =>
    validateAndSanitizeQuestion(q, idx)
  );

  const durationMs = Date.now() - startTime;
  const estimatedTokens = estimateTokens(prompt + rawText);

  return {
    questions: validatedQuestions,
    rawResponse: rawText,
    modelUsed: activeModel,
    fallbackUsed,
    estimatedTokens,
    durationMs,
  };
}

/**
 * Repairs broken/truncated JSON syntax from LLMs (e.g. unescaped newlines, trailing commas, unclosed brackets).
 */
export function repairJsonSyntax(raw: string): string {
  if (!raw || typeof raw !== "string") return "";

  let text = raw.trim();

  // Strip single-line and multi-line comments
  text = text.replace(/\/\*[\s\S]*?\*\//g, "");
  text = text.replace(/(^|[^:])\/\/[^\r\n]*/g, "$1");

  // Fix python literals
  text = text.replace(/:\s*True\b/g, ": true");
  text = text.replace(/:\s*False\b/g, ": false");
  text = text.replace(/:\s*None\b/g, ": null");

  // If single quotes are used as JSON delimiters (e.g. {'questions': [...]})
  if (text.includes("'") && !text.includes('"')) {
    text = text.replace(/'((?:\\.|[^'\\])*)'/g, '"$1"');
  }

  let inString = false;
  let isEscaped = false;
  let result = "";
  const stack: string[] = [];

  for (let i = 0; i < text.length; i++) {
    const char = text[i];

    if (inString) {
      if (isEscaped) {
        result += char;
        isEscaped = false;
      } else if (char === "\\") {
        const nextChar = text[i + 1] || "";
        if (/["\\/bfnrtu]/.test(nextChar)) {
          result += char;
          isEscaped = true;
        } else {
          // Invalid JSON escape sequence (e.g. \s in \sqrt, \alpha in math)
          // Escape the backslash itself so it becomes valid JSON literal \\
          result += "\\\\";
        }
      } else if (char === '"') {
        // Lookahead to verify if this quote really ends the string
        // In valid JSON, closing quote must be followed by optional whitespace then: , } ] : or EOF
        const nextChars = text.slice(i + 1, i + 30).trim();
        const isValidFollower =
          nextChars.length === 0 ||
          /^[,}\]:\n\r]/.test(nextChars) ||
          /^[A-Za-z0-9_"]+\s*:/.test(nextChars);

        if (isValidFollower) {
          inString = false;
          result += char;
        } else {
          // Unescaped inner quote: escape it!
          result += '\\"';
        }
      } else if (char === "\n") {
        result += "\\n";
      } else if (char === "\r") {
        result += "\\r";
      } else if (char === "\t") {
        result += "\\t";
      } else {
        result += char;
      }
    } else {
      if (char === '"') {
        inString = true;
        result += char;
      } else if (char === "{" || char === "[") {
        stack.push(char);
        result += char;
      } else if (char === "}") {
        if (stack.length > 0 && stack[stack.length - 1] === "{") {
          stack.pop();
        }
        result += char;
      } else if (char === "]") {
        if (stack.length > 0 && stack[stack.length - 1] === "[") {
          stack.pop();
        }
        result += char;
      } else {
        result += char;
      }
    }
  }

  // Close unclosed string at EOF
  if (inString) {
    result += '"';
  }

  // Remove trailing commas before closing braces/brackets
  result = result.replace(/,\s*([\]}])/g, "$1");
  // Remove trailing comma at very end of string
  result = result.replace(/,\s*$/, "");

  // If ends with a dangling incomplete key or colon (e.g. `,"topic": ` or `,"topic": "` or `,"topic"`), clean it
  result = result.replace(/,\s*"[^"]*"\s*:\s*"?$/, "");
  result = result.replace(/,\s*"[^"]*"\s*$/, "");
  result = result.replace(/,\s*$/, "");

  // Close unclosed brackets/braces from stack in reverse order
  while (stack.length > 0) {
    const openChar = stack.pop();
    if (openChar === "{") {
      result = result.replace(/,\s*$/, "") + "}";
    } else if (openChar === "[") {
      result = result.replace(/,\s*$/, "") + "]";
    }
  }

  // Final cleanup of trailing commas
  result = result.replace(/,\s*([\]}])/g, "$1");

  return result;
}

/**
 * Robust JSON extraction and parsing resilient to LLM preambles, code fences, unescaped characters, and truncated output.
 */
export function cleanAndParseJson(rawText: string): any {
  if (!rawText || typeof rawText !== "string") return null;

  let text = rawText.trim();

  // Strip BOM and all invisible/directional control characters
  text = text.replace(/^\uFEFF/, "");
  text = text.replace(/[\u200E\u200F\u202A-\u202E\u200B\u200C\u200D]/g, "");

  // Strip <thought> or <thinking> blocks (both closed and unclosed before JSON)
  text = text.replace(/<(?:thought|thinking)>[\s\S]*?<\/(?:thought|thinking)>/gi, "").trim();
  text = text.replace(/<(?:thought|thinking)>[\s\S]*?(?=\{|\[|$)/gi, "").trim();

  const tryJson = (str: string): any => {
    if (!str || typeof str !== "string") return null;
    const trimmed = str.trim();
    if (!trimmed) return null;

    // Direct
    try {
      const parsed = JSON.parse(trimmed);
      if (typeof parsed === "string") {
        try {
          const inner = JSON.parse(parsed);
          if (inner && typeof inner === "object") return inner;
        } catch {}
      }
      if (parsed && typeof parsed === "object") return parsed;
    } catch {}

    // Repaired
    try {
      const repaired = repairJsonSyntax(trimmed);
      const parsed = JSON.parse(repaired);
      if (typeof parsed === "string") {
        try {
          const inner = JSON.parse(parsed);
          if (inner && typeof inner === "object") return inner;
        } catch {}
      }
      if (parsed && typeof parsed === "object") return parsed;
    } catch {}

    // Single quotes to double quotes for python dicts
    if (trimmed.includes("'")) {
      try {
        const converted = trimmed.replace(/'((?:\\.|[^'\\])*)'/g, '"$1"');
        const parsed = JSON.parse(converted);
        if (parsed && typeof parsed === "object") return parsed;
      } catch {}
      try {
        const repaired = repairJsonSyntax(trimmed.replace(/'((?:\\.|[^'\\])*)'/g, '"$1"'));
        const parsed = JSON.parse(repaired);
        if (parsed && typeof parsed === "object") return parsed;
      } catch {}
    }

    return null;
  };

  // 1. Direct parse
  const direct = tryJson(text);
  if (direct) return direct;

  // 2. Code fences ```json ... ``` or ``` ... ```
  const fenceMatches = text.matchAll(/```(?:json)?\s*([\s\S]*?)(?:```|$)/gi);
  for (const match of fenceMatches) {
    if (match[1]) {
      const fenced = match[1].trim();
      const res = tryJson(fenced);
      if (res) return res;
    }
  }

  // 3. Search specifically around key anchors ("questions" or "question")
  const anchorMatch = text.match(/"questions?"\s*:/i);
  if (anchorMatch && anchorMatch.index !== undefined) {
    const anchorIdx = anchorMatch.index;
    const startBrace = text.lastIndexOf("{", anchorIdx);
    if (startBrace !== -1) {
      const candidate = text.slice(startBrace);
      const res = tryJson(candidate);
      if (res) return res;
    }
  }

  // 4. Outermost JSON Object `{ ... }`
  const firstBrace = text.indexOf("{");
  const lastBrace = text.lastIndexOf("}");
  if (firstBrace !== -1 && lastBrace > firstBrace) {
    const objCandidate = text.slice(firstBrace, lastBrace + 1);
    const res = tryJson(objCandidate);
    if (res) return res;
  } else if (firstBrace !== -1) {
    const res = tryJson(text.slice(firstBrace));
    if (res) return res;
  }

  // 5. Outermost JSON Array `[ ... ]`
  const firstBracket = text.indexOf("[");
  const lastBracket = text.lastIndexOf("]");
  if (firstBracket !== -1 && lastBracket > firstBracket) {
    const arrCandidate = text.slice(firstBracket, lastBracket + 1);
    const res = tryJson(arrCandidate);
    if (res) return res;
  } else if (firstBracket !== -1) {
    const res = tryJson(text.slice(firstBracket));
    if (res) return res;
  }

  return null;
}

/**
 * Fallback regex extractor that scrapes individual question objects when JSON structure is damaged.
 */
export function extractQuestionsViaRegex(rawText: string): RawGeneratedQuestion[] {
  const list: RawGeneratedQuestion[] = [];
  const qRegex = /"(?:question|questionText|prompt|title|text|نص_السؤال|السؤال)"\s*:\s*"([^"\\]*(?:\\.[^"\\]*)*)"/gi;
  let qMatch: RegExpExecArray | null;

  while ((qMatch = qRegex.exec(rawText)) !== null) {
    const questionText = qMatch[1].replace(/\\"/g, '"').replace(/\\n/g, "\n").trim();
    if (!questionText) continue;

    const startIdx = qMatch.index;
    const nextMatch = rawText.slice(startIdx + qMatch[0].length).search(/"(?:question|questionText|prompt|title|text)"\s*:/i);
    const chunkEnd = nextMatch !== -1 ? startIdx + qMatch[0].length + nextMatch : rawText.length;
    const chunk = rawText.slice(startIdx, Math.min(chunkEnd, startIdx + 3000));

    let options: string[] = [];
    const optionsBlock = chunk.match(/"(?:options|choices|answers|alternatives|items|الخيارات)"\s*:\s*\[([\s\S]*?)\]/i);
    if (optionsBlock && optionsBlock[1]) {
      const optItems = optionsBlock[1].match(/"([^"\\]*(?:\\.[^"\\]*)*)"/g);
      if (optItems && optItems.length >= 2) {
        options = optItems.map((o) => o.replace(/^"|"$/g, "").replace(/\\"/g, '"').trim());
      }
    }

    // If options array was truncated or missing closing bracket
    if (options.length < 2) {
      const optTruncMatch = chunk.match(/"(?:options|choices|answers|alternatives|items)"\s*:\s*\[([^\]]*)$/i);
      if (optTruncMatch && optTruncMatch[1]) {
        const optItems = optTruncMatch[1].match(/"([^"\\]*(?:\\.[^"\\]*)*)"/g);
        if (optItems && optItems.length >= 2) {
          options = optItems.map((o) => o.replace(/^"|"$/g, "").replace(/\\"/g, '"').trim());
        }
      }
    }

    const corrMatch = chunk.match(
      /"(?:correctOptionId|correct_option_id|correctAnswer|correct_answer|answer|correct|rightAnswer|solution|key|الإجابة_الصحيحة)"\s*:\s*["']?(\d+|[A-Za-z]|[أ-ي])["']?/i
    );
    let correctOptionId: any = 0;
    if (corrMatch && corrMatch[1]) {
      const val = corrMatch[1];
      if (/^\d+$/.test(val)) {
        correctOptionId = parseInt(val, 10);
      } else {
        correctOptionId = val;
      }
    }

    const expMatch = chunk.match(/"(?:explanation|الشرح|reason)"\s*:\s*"([^"\\]*(?:\\.[^"\\]*)*)"/i);
    const explanation = expMatch ? expMatch[1].replace(/\\"/g, '"').trim() : "";

    const diffMatch = chunk.match(/"(?:difficulty|المستوى)"\s*:\s*"([^"]+)"/i);
    const difficulty = diffMatch ? diffMatch[1].trim() : "MEDIUM";

    const topMatch = chunk.match(/"(?:topic|الموضوع)"\s*:\s*"([^"]+)"/i);
    const topic = topMatch ? topMatch[1].trim() : "عام";

    const quoteMatch = chunk.match(/"(?:groundingQuote|الاقتباس)"\s*:\s*"([^"\\]*(?:\\.[^"\\]*)*)"/i);
    const groundingQuote = quoteMatch ? quoteMatch[1].replace(/\\"/g, '"').trim() : "";

    if (options.length >= 2) {
      list.push({
        question: questionText,
        options,
        correctOptionId,
        explanation,
        difficulty,
        topic,
        groundingQuote,
      });
    }
  }

  return list;
}

/**
 * Robust JSON extraction resilient to LLM preambles, code fences, trailing commas, and truncated responses.
 */
export function extractQuestionsFromJson(rawText: string): RawGeneratedQuestion[] {
  const parsed = cleanAndParseJson(rawText);

  let rawList: any[] = [];
  if (Array.isArray(parsed)) {
    rawList = parsed;
  } else if (parsed && typeof parsed === "object") {
    const candidateKeys = [
      "questions", "quiz", "items", "data", "mcqs", "results",
      "Questions", "Quiz", "Items", "Data", "MCQs", "Results",
      "questions_list", "questionsList", "exam", "output"
    ];
    for (const key of candidateKeys) {
      if (Array.isArray(parsed[key])) {
        rawList = parsed[key];
        break;
      }
      // Check nested objects, e.g. parsed.data?.questions or parsed.result?.mcqs
      if (parsed[key] && typeof parsed[key] === "object") {
        for (const subKey of candidateKeys) {
          if (Array.isArray(parsed[key][subKey])) {
            rawList = parsed[key][subKey];
            break;
          }
        }
        if (rawList.length > 0) break;
      }
    }

    // If single question object was returned
    if (
      rawList.length === 0 &&
      (parsed.question || parsed.prompt || parsed.title || parsed.text || parsed.questionText) &&
      (Array.isArray(parsed.options) || Array.isArray(parsed.choices) || Array.isArray(parsed.answers) || typeof parsed.options === "object" || typeof parsed.choices === "object")
    ) {
      rawList = [parsed];
    }

    // Check if any property value is an array of questions
    if (rawList.length === 0) {
      for (const val of Object.values(parsed)) {
        if (
          Array.isArray(val) &&
          val.length > 0 &&
          typeof val[0] === "object" &&
          (val[0]?.question || val[0]?.prompt || val[0]?.title || val[0]?.text || val[0]?.questionText)
        ) {
          rawList = val;
          break;
        }
      }
    }
  }

  // If JSON parsing yielded no items, attempt regex extraction fallback
  if (rawList.length === 0) {
    rawList = extractQuestionsViaRegex(rawText);
  }

  if (rawList.length === 0) {
    console.error("[Gemini] Failed to parse JSON response:", rawText?.slice(0, 500));
    throw new Error("فشل فك شفرة رد الذكاء الاصطناعي كـ JSON صالح");
  }

  return rawList;
}

/**
 * Connection and key verification test with intelligent auto-fallback
 * and detection of available models.
 */
export async function testGeminiConnection(
  apiKey: string,
  model: string = DEFAULT_GEMINI_MODEL
): Promise<GeminiTestResult> {
  const startTime = Date.now();
  const cleanKey = apiKey.trim();

  if (!cleanKey) {
    return {
      success: false,
      message: "لم يتم تقديم مفتاح API صالح.",
      latencyMs: 0,
      activeModel: DEFAULT_GEMINI_MODEL,
      availableModels: [],
      fallbackUsed: false,
    };
  }

  const requestedModel = normalizeModelName(model || DEFAULT_GEMINI_MODEL);

  // Concurrently fetch available models from Google API
  const availableModelsPromise = fetchAvailableGeminiModels(cleanKey).catch(() => []);

  async function pingModel(m: string): Promise<{ ok: boolean; status: number; errorMsg: string; latencyMs: number }> {
    const clean = normalizeModelName(m);
    const pStart = Date.now();
    const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${clean}:generateContent?key=${cleanKey}`;
    try {
      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [
            {
              role: "user",
              parts: [{ text: "Ping test. Respond with: OK" }],
            },
          ],
          generationConfig: {
            maxOutputTokens: 10,
          },
        }),
        signal: AbortSignal.timeout(15000),
      });
      const latencyMs = Date.now() - pStart;
      if (!res.ok) {
        let errorMsg = "";
        try {
          const errJson = await res.json();
          errorMsg = errJson.error?.message || JSON.stringify(errJson);
        } catch {
          errorMsg = await res.text();
        }
        return { ok: false, status: res.status, errorMsg, latencyMs };
      }
      return { ok: true, status: 200, errorMsg: "", latencyMs };
    } catch (e: any) {
      return {
        ok: false,
        status: 500,
        errorMsg: e instanceof Error ? e.message : "خطأ غير معروف في الشبكة",
        latencyMs: Date.now() - pStart,
      };
    }
  }

  let pingRes = await pingModel(requestedModel);
  let activeModel = requestedModel;
  let fallbackUsed = false;

  // Auto-fallback if requested model is 404, deprecated, 503, or quota exhausted
  if (!pingRes.ok && shouldTriggerModelFallback(pingRes.status, pingRes.errorMsg)) {
    console.warn(
      `[Gemini Test] Model '${requestedModel}' failed (${pingRes.status}): ${pingRes.errorMsg}. Initiating auto-fallback...`
    );

    const availableModels = await availableModelsPromise;
    const candidates = getFallbackCandidates(requestedModel, availableModels);

    for (const candidate of candidates) {
      const fRes = await pingModel(candidate);
      if (fRes.ok) {
        pingRes = fRes;
        activeModel = candidate;
        fallbackUsed = true;
        console.log(`[Gemini Test] Fallback succeeded with model: ${candidate}`);
        break;
      }
    }
  }

  const fetchedAvailable = await availableModelsPromise;
  const availableModels: AvailableGeminiModel[] = pingRes.ok
    ? (fetchedAvailable.length > 0
        ? fetchedAvailable
        : [
            {
              id: activeModel,
              name: `models/${activeModel}`,
              displayName: activeModel,
              description: "النموذج النشط المعتمد",
              supportedGenerationMethods: ["generateContent"],
            },
          ])
    : [];

  if (pingRes.ok) {
    const successMsg = fallbackUsed
      ? `تم الاتصال بنجاح! تم التحويل تلقائياً إلى النموذج النشط (${activeModel}) بنجاح (${pingRes.latencyMs}ms) لأن النموذج السابق (${requestedModel}) لم يعد متاحاً.`
      : `تم الاتصال بنجاح بنموذج ${activeModel} خلال ${pingRes.latencyMs}ms!`;

    return {
      success: true,
      message: successMsg,
      latencyMs: pingRes.latencyMs,
      activeModel,
      availableModels,
      fallbackUsed,
    };
  }

  return {
    success: false,
    message: `فشل الاتصال بنموذج ${requestedModel} (رمز الخطأ ${pingRes.status}): ${pingRes.errorMsg.slice(0, 240)}`,
    latencyMs: pingRes.latencyMs,
    activeModel: requestedModel,
    availableModels,
    fallbackUsed: false,
  };
}

export interface DocumentOcrOptions {
  apiKey?: string;
  model?: string;
  buffer: Buffer;
  mimeType: string;
  documentTitle?: string;
  systemInstruction?: string;
}

export interface DocumentOcrResult {
  text: string;
  modelUsed: string;
  fallbackUsed?: boolean;
  tokensUsed: number;
}

export const NOTEBOOKLM_OCR_SYSTEM_INSTRUCTION = `
You are an expert OCR and document understanding engine like Google's NotebookLM.
Your mission is to transcribe and understand text, handwritten notes, tables, diagrams, equations, and section headings accurately without omissions or hallucinations.

CRITICAL OCR & TRANSCRIPTION GUIDELINES:
1. EXHAUSTIVE TRANSCRIPTION: Extract ALL textual content visible in the provided image or document. Capture printed text, handwritten notes, student annotations, margins, questions, formulas, and bullet points. Never summarize or omit information.
2. PRESERVE STRUCTURE & FORMAT:
   - Faithfully retain all chapter names, headings, sub-headings, and numbered sections (e.g. # الفصل الأول, ## المبحث الثاني, Unit 1, Lesson 2).
   - Format output using clean, readable Markdown (# for headings, - or * for lists, **bold** for key terms).
3. TABLES & DATA: Reconstruct any tables into valid Markdown table format with proper alignment.
4. DIAGRAMS & ILLUSTRATIONS: If the document contains diagrams, flowcharts, or scientific illustrations, include a clear bracketed structural explanation (e.g., [رسم بياني: ...] or [مخطط توضيحي: ...]) followed by all associated captions, labels, and text.
5. MATHEMATICAL & SCIENTIFIC NOTATION: Transcribe mathematical symbols, chemical formulas, and units of measurement (e.g. m/s², كجم, Σ, H₂O) with exact precision.
6. HANDWRITING ACCURACY: Decipher Arabic and English handwriting with the highest possible fidelity. If a word is unclear or slightly cut off, transcribe the most linguistically accurate reading based on surrounding context.
7. LANGUAGE PRESERVATION: Retain the original language of the source document (Arabic, English, French, etc.) without unsolicited translation.
`;

/**
 * NotebookLM-grade multimodal document and handwriting OCR extraction using Google Gemini.
 * Transcribes printed text, handwriting, tables, and diagrams with high precision.
 */
export async function extractDocumentTextWithGemini(
  options: DocumentOcrOptions
): Promise<DocumentOcrResult> {
  const apiKey =
    options.apiKey?.trim() ||
    process.env.GEMINI_API_KEY?.trim() ||
    "";

  if (!apiKey) {
    throw new Error(
      "لم يتم العثور على مفتاح Google Gemini API Key. يرجى إدخال المفتاح في تبويب 'إعدادات الذكاء الاصطناعي' أو إضافته في ملف البيئة (GEMINI_API_KEY) لتفعيل ميزة التعرف البصري على الصور والمستندات (OCR)."
    );
  }

  if (options.buffer.length > 14 * 1024 * 1024) {
    throw new Error(
      "حجم الملف يتجاوز الحد الأقصى المسموح للمعالجة البصرية المباشرة بالذكاء الاصطناعي (14 ميجابايت). يرجى تقليل حجم الملف أو ضغطه والمحاولة مرة أخرى."
    );
  }

  let cleanMime = (options.mimeType || "application/pdf").toLowerCase().trim();
  if (cleanMime === "image/jpg" || cleanMime === "image/pjpeg") {
    cleanMime = "image/jpeg";
  }

  const requestedModel = normalizeModelName(options.model || DEFAULT_GEMINI_MODEL);
  const base64Data = options.buffer.toString("base64");

  let prompt = `You are an expert OCR and document understanding engine like NotebookLM. Transcribe all text, handwritten notes, tables, diagrams, and section headings accurately without omissions.`;
  if (options.documentTitle) {
    prompt += `\nعنوان أو مرجع المستند: ${options.documentTitle}`;
  }
  prompt += `\nقم بنسخ وتفريغ النص كاملاً بأعلى درجات الدقة والوضوح محتفظاً بالترتيب والعناوين والجداول.`;

  const requestBody = {
    systemInstruction: {
      parts: [{ text: options.systemInstruction || NOTEBOOKLM_OCR_SYSTEM_INSTRUCTION }],
    },
    contents: [
      {
        role: "user",
        parts: [
          {
            inlineData: {
              mimeType: cleanMime,
              data: base64Data,
            },
          },
          {
            text: prompt,
          },
        ],
      },
    ],
    generationConfig: {
      temperature: 0.1,
      maxOutputTokens: 8192,
    },
  };

  let activeModel = requestedModel;
  let fallbackUsed = false;
  let apiRes = await callGeminiGenerateContent(requestedModel, requestBody, apiKey, 120000);

  if (!apiRes.ok && shouldTriggerModelFallback(apiRes.status, apiRes.errorDetails)) {
    console.warn(
      `[Gemini OCR] Model '${requestedModel}' failed (${apiRes.status}): ${apiRes.errorDetails}. Initiating auto-fallback...`
    );

    let fetched: AvailableGeminiModel[] = [];
    try {
      fetched = await fetchAvailableGeminiModels(apiKey);
    } catch {}

    const fallbackCandidates = getFallbackCandidates(requestedModel, fetched);
    for (const candidate of fallbackCandidates) {
      console.log(`[Gemini OCR] Attempting fallback model: ${candidate}`);
      const fallbackRes = await callGeminiGenerateContent(candidate, requestBody, apiKey, 120000);
      if (fallbackRes.ok && fallbackRes.text) {
        console.log(`[Gemini OCR] Fallback succeeded with model: ${candidate}`);
        apiRes = fallbackRes;
        activeModel = candidate;
        fallbackUsed = true;
        break;
      }
    }
  }

  if (!apiRes.ok) {
    throw new Error(`خطأ في استخراج النص عبر الذكاء الاصطناعي (${apiRes.status}): ${apiRes.errorDetails}`);
  }

  const text = apiRes.text.trim();
  if (!text) {
    throw new Error("لم يتمكن نموذج الذكاء الاصطناعي من استخراج نصوص مقروءة من الملف أو الصورة.");
  }

  return {
    text,
    modelUsed: activeModel,
    fallbackUsed,
    tokensUsed: estimateTokens(text),
  };
}

export interface ChunkOcrOptions {
  pages: string[];
  startPage: number;
  endPage: number;
  apiKey?: string;
  model?: string;
  documentTitle?: string;
}

export interface ChunkOcrResult {
  transcribedText: string;
  sections: { title: string; content: string }[];
  modelUsed: string;
  fallbackUsed?: boolean;
  tokensUsed: number;
}

/**
 * Multimodal OCR chunk extraction for sliced PDF pages using Google Gemini.
 * Transcribes Arabic & English text, headings, tables, and notes from page image chunks.
 */
export async function extractChunkTextWithGemini(
  options: ChunkOcrOptions
): Promise<ChunkOcrResult> {
  const apiKey =
    options.apiKey?.trim() ||
    process.env.GEMINI_API_KEY?.trim() ||
    "";

  if (!apiKey) {
    throw new Error(
      "لم يتم العثور على مفتاح Google Gemini API Key. يرجى إدخال المفتاح في تبويب 'إعدادات الذكاء الاصطناعي' أو إضافته في ملف البيئة (GEMINI_API_KEY) لتفعيل التعرف البصري على الصور والمستندات (OCR)."
    );
  }

  if (!options.pages || !Array.isArray(options.pages) || options.pages.length === 0) {
    throw new Error("لم يتم تمرير أي صفحات للمعالجة البصرية.");
  }

  const requestedModel = normalizeModelName(options.model || DEFAULT_GEMINI_MODEL);
  const startPage = options.startPage || 1;
  const endPage = options.endPage || (startPage + options.pages.length - 1);

  const parts: any[] = [];
  options.pages.forEach((pageData, idx) => {
    const pageNum = startPage + idx;
    let base64 = pageData;
    let mimeType = "image/jpeg";
    if (pageData.includes(",")) {
      const match = pageData.match(/^data:([^;]+);base64,/);
      if (match) {
        mimeType = match[1];
      }
      base64 = pageData.split(",")[1];
    }

    parts.push({
      inlineData: {
        mimeType,
        data: base64,
      },
    });
    parts.push({
      text: `[صفحة ${pageNum}]`,
    });
  });

  let prompt = `You are an expert multimodal OCR and document understanding engine like Google's NotebookLM.
Transcribe and extract ALL text, tables, diagrams, equations, notes, and chapter headings from the provided document pages (${startPage} to ${endPage}) with 100% precision and fidelity.
Capture printed text and handwriting in Arabic and English accurately.
Preserve document structure using Markdown headings (# الفصل الأول, ## المبحث, etc.), lists, and tables.
Never summarize, omit, or truncate any visible content.`;

  if (options.documentTitle) {
    prompt += `\nعنوان أو مرجع المستند: ${options.documentTitle}`;
  }

  parts.push({ text: prompt });

  const requestBody = {
    systemInstruction: {
      parts: [{ text: NOTEBOOKLM_OCR_SYSTEM_INSTRUCTION }],
    },
    contents: [
      {
        role: "user",
        parts,
      },
    ],
    generationConfig: {
      temperature: 0.1,
      maxOutputTokens: 8192,
    },
  };

  let activeModel = requestedModel;
  let fallbackUsed = false;
  let apiRes = await callGeminiGenerateContent(requestedModel, requestBody, apiKey, 120000);

  // Quick retry for transient 429 / 503 before fallback or error
  if (!apiRes.ok && (apiRes.status === 429 || apiRes.status === 503)) {
    console.warn(`[Gemini Chunk OCR] Transient ${apiRes.status} on model '${requestedModel}', waiting 2.5s before retry...`);
    await new Promise((r) => setTimeout(r, 2500));
    apiRes = await callGeminiGenerateContent(requestedModel, requestBody, apiKey, 120000);
  }

  if (!apiRes.ok && shouldTriggerModelFallback(apiRes.status, apiRes.errorDetails)) {
    console.warn(
      `[Gemini Chunk OCR] Model '${requestedModel}' failed (${apiRes.status}): ${apiRes.errorDetails}. Initiating auto-fallback...`
    );

    let fetched: AvailableGeminiModel[] = [];
    try {
      fetched = await fetchAvailableGeminiModels(apiKey);
    } catch {}

    const fallbackCandidates = getFallbackCandidates(requestedModel, fetched);
    for (const candidate of fallbackCandidates) {
      console.log(`[Gemini Chunk OCR] Attempting fallback model: ${candidate}`);
      let fallbackRes = await callGeminiGenerateContent(candidate, requestBody, apiKey, 120000);
      if (!fallbackRes.ok && (fallbackRes.status === 429 || fallbackRes.status === 503)) {
        await new Promise((r) => setTimeout(r, 2000));
        fallbackRes = await callGeminiGenerateContent(candidate, requestBody, apiKey, 120000);
      }
      if (fallbackRes.ok && fallbackRes.text) {
        console.log(`[Gemini Chunk OCR] Fallback succeeded with model: ${candidate}`);
        apiRes = fallbackRes;
        activeModel = candidate;
        fallbackUsed = true;
        break;
      }
    }
  }

  if (!apiRes.ok) {
    throw new Error(`خطأ في استخراج النص عبر الذكاء الاصطناعي (${apiRes.status}): ${apiRes.errorDetails}`);
  }

  const transcribedText = (apiRes.text || "").trim();
  const cleaned = cleanText(transcribedText);
  let sections = splitIntoSections(cleaned);
  if (sections.length === 0 && cleaned.length > 0) {
    sections = [
      {
        id: `chunk-${startPage}-${endPage}`,
        title: startPage === endPage ? `الصفحة ${startPage}` : `الصفحات ${startPage} - ${endPage}`,
        content: cleaned,
        wordCount: cleaned.split(/\s+/).filter(Boolean).length,
      },
    ];
  }

  return {
    transcribedText,
    sections: sections.map((s) => ({ title: s.title, content: s.content })),
    modelUsed: activeModel,
    fallbackUsed,
    tokensUsed: estimateTokens(transcribedText),
  };
}


