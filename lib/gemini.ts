import {
  RawGeneratedQuestion,
  ValidatedQuestion,
  validateAndSanitizeQuestion,
} from "./questionValidator";

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
  {
    id: "gemini-2.0-flash",
    labelAr: "gemini-2.0-flash (الجيل السابق)",
    labelEn: "gemini-2.0-flash (Previous Generation)",
    description: "الجيل السابق",
  },
  {
    id: "gemini-1.5-flash",
    labelAr: "gemini-1.5-flash (سريع مع نافذة سياق 1M Token)",
    labelEn: "gemini-1.5-flash (Fast & Lightweight)",
    description: "نافذة سياق 1M Token",
  },
  {
    id: "gemini-1.5-pro",
    labelAr: "gemini-1.5-pro (تفكير أكاديمي متقدم للكتب الضخمة)",
    labelEn: "gemini-1.5-pro (Deep Academic Reasoning)",
    description: "تفكير أكاديمي متقدم",
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
You are an uncompromising academic examination specialist and curriculum assessor.
Your mission is to generate high-yield, crystal-clear Multiple-Choice Questions (MCQs) STRICTLY AND EXCLUSIVELY based upon the textbook excerpt provided.

CRITICAL ZERO-HALLUCINATION RULES:
1. STRICT GROUNDING: Every question, every correct answer, and every explanation MUST be directly, unambiguously verifiable within the excerpt text provided.
2. NO EXTERNAL KNOWLEDGE: Never bring in external facts, dates, names, or formulas from outside the text, even if true in reality. If it is not in the text, it is considered non-existent.
3. CREDIBLE DISTRACTORS: Incorrect options must be plausible within the domain, but definitively false according to the text. Avoid absurd or giveaway options.
4. EXACT EVIDENCE: Every question MUST include "groundingQuote" quoting verbatim the exact phrase or sentence from the excerpt proving the answer.
5. TELEGRAM CONSTRAINTS COMPLIANCE:
   - "question": Concise, direct, max 300 characters.
   - "options": Exactly 4 distinct options (or 2-4 if true/false). Max 100 characters per option. NO duplicate options.
   - "correctOptionId": 0-based integer index pointing to the correct option.
   - "explanation": Clear reasoning, max 200 characters.
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
 * Known legacy models that have been deprecated or failed with 404 in Google Gemini API.
 */
export const KNOWN_DEPRECATED_MODELS = new Set([
  "gemini-2.0-flash",
  "gemini-1.5-flash",
  "gemini-1.5-pro",
  "gemini-1.0-pro",
]);

/**
 * Builds an ordered list of fallback candidates:
 * 1. DEFAULT_GEMINI_MODEL (gemini-3.8-flash)
 * 2. gemini-2.5-flash
 * 3. gemini-2.5-pro
 * 4. Any models returned by dynamic ListModels API
 * Filters out the failed model and known deprecated models.
 */
export function getFallbackCandidates(
  failedModel: string,
  dynamicModels: AvailableGeminiModel[] = []
): string[] {
  const cleanFailed = normalizeModelName(failedModel);
  const candidates: string[] = [];

  const addIfValid = (m: string) => {
    const clean = normalizeModelName(m);
    if (!clean || clean === cleanFailed) return;
    if (KNOWN_DEPRECATED_MODELS.has(clean)) return;
    if (!candidates.includes(clean)) {
      candidates.push(clean);
    }
  };

  addIfValid(DEFAULT_GEMINI_MODEL);
  addIfValid("gemini-2.5-flash");
  addIfValid("gemini-2.5-pro");

  for (const m of dynamicModels) {
    const clean = normalizeModelName(m.id);
    if (clean && clean !== cleanFailed && !candidates.includes(clean)) {
      candidates.push(clean);
    }
  }

  return candidates;
}

function getModelSortScore(id: string): number {
  if (id === DEFAULT_GEMINI_MODEL) return 1000;
  if (id.includes("3.8") && id.includes("flash")) return 900;
  if (id.includes("3.8")) return 850;
  if (id.includes("2.5") && id.includes("flash")) return 800;
  if (id.includes("2.5") && id.includes("pro")) return 750;
  if (id.includes("2.5")) return 700;
  if (id.includes("flash")) return 600;
  if (id.includes("pro")) return 500;
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
 * Estimate token count approximately (4 chars ~ 1 token).
 */
export function estimateTokens(text: string): number {
  return Math.ceil((text || "").length / 4);
}

/**
 * Helper to call Gemini generateContent endpoint.
 */
async function callGeminiGenerateContent(
  model: string,
  requestBody: any,
  apiKey: string
): Promise<{ ok: boolean; status: number; text: string; errorDetails: string }> {
  const cleanModel = normalizeModelName(model);
  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${cleanModel}:generateContent?key=${apiKey}`;

  try {
    const res = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(requestBody),
      signal: AbortSignal.timeout(60000),
    });

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
    const rawText = data.candidates?.[0]?.content?.parts?.[0]?.text || "";
    if (!rawText && data.candidates?.[0]?.finishReason && data.candidates[0].finishReason !== "STOP") {
      return {
        ok: false,
        status: 200,
        text: "",
        errorDetails: `النموذج أنهى التوليد بسبب (${data.candidates[0].finishReason})`,
      };
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

  const requestedModel = normalizeModelName(options.model || DEFAULT_GEMINI_MODEL);
  const count = Math.min(Math.max(options.questionCount || 5, 1), 25);
  const difficulty = options.difficulty || "mixed";

  let prompt = `يرجى توليد عدد (${count}) أسئلة اختيار من متعدد (MCQs) فائقة الدقة بالاعتماد الصارم والحصري على النص الدراسي التالي فقط.\n\n`;
  if (options.materialTitle) {
    prompt += `عنوان المادة/الكتاب: ${options.materialTitle}\n`;
  }
  if (options.topic) {
    prompt += `التركيز على موضوع/فصل: ${options.topic}\n`;
  }
  prompt += `مستوى الصعوبة المطلوب: ${difficulty}\n`;
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
                question: { type: "STRING" },
                options: {
                  type: "ARRAY",
                  items: { type: "STRING" },
                },
                correctOptionId: { type: "INTEGER" },
                explanation: { type: "STRING" },
                difficulty: { type: "STRING" },
                topic: { type: "STRING" },
                bloomTaxonomy: { type: "STRING" },
                groundingQuote: { type: "STRING" },
              },
              required: ["question", "options", "correctOptionId", "explanation"],
            },
          },
        },
        required: ["questions"],
      },
      temperature: 0.15, // Low temperature for deterministic grounding
      maxOutputTokens: 8192,
    },
  };

  let activeModel = requestedModel;
  let fallbackUsed = false;
  let apiRes = await callGeminiGenerateContent(requestedModel, requestBody, apiKey);

  // If model fails with 404 or deprecation, trigger intelligent fallback
  if (!apiRes.ok && isModelNotFoundError(apiRes.status, apiRes.errorDetails)) {
    console.warn(
      `[Gemini] Model '${requestedModel}' failed with (${apiRes.status}): ${apiRes.errorDetails}. Initiating auto-fallback...`
    );

    let fetched: AvailableGeminiModel[] = [];
    try {
      fetched = await fetchAvailableGeminiModels(apiKey);
    } catch {
      // Continue with static modern candidates
    }

    const fallbackCandidates = getFallbackCandidates(requestedModel, fetched);

    for (const candidate of fallbackCandidates) {
      console.log(`[Gemini] Attempting fallback model: ${candidate}`);
      const fallbackRes = await callGeminiGenerateContent(candidate, requestBody, apiKey);
      if (fallbackRes.ok && fallbackRes.text) {
        console.log(`[Gemini] Fallback succeeded with model: ${candidate}`);
        apiRes = fallbackRes;
        activeModel = candidate;
        fallbackUsed = true;
        break;
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

  // Resilient multi-stage structured JSON parser
  const rawQuestions = extractQuestionsFromJson(rawText);

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
 * Robust JSON extraction resilient to LLM preambles, code fences, and trailing commas.
 */
export function extractQuestionsFromJson(rawText: string): RawGeneratedQuestion[] {
  const tryParse = (str: string): any => {
    // Strip trailing commas before closing braces/brackets
    const sanitized = str.replace(/,\s*([}\]])/g, "$1").trim();
    return JSON.parse(sanitized);
  };

  let parsed: any = null;

  // 1. Direct parse attempt
  try {
    parsed = tryParse(rawText);
  } catch {}

  // 2. Code fence extraction ```json ... ```
  if (!parsed) {
    const fenceMatch = rawText.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
    if (fenceMatch?.[1]) {
      try {
        parsed = tryParse(fenceMatch[1]);
      } catch {}
    }
  }

  // 3. Outermost JSON object search `{ ... }`
  if (!parsed) {
    const firstBrace = rawText.indexOf("{");
    const lastBrace = rawText.lastIndexOf("}");
    if (firstBrace !== -1 && lastBrace > firstBrace) {
      try {
        parsed = tryParse(rawText.slice(firstBrace, lastBrace + 1));
      } catch {}
    }
  }

  // 4. Outermost JSON array search `[ ... ]`
  if (!parsed) {
    const firstBracket = rawText.indexOf("[");
    const lastBracket = rawText.lastIndexOf("]");
    if (firstBracket !== -1 && lastBracket > firstBracket) {
      try {
        parsed = tryParse(rawText.slice(firstBracket, lastBracket + 1));
      } catch {}
    }
  }

  if (!parsed) {
    console.error("[Gemini] Failed to parse JSON response:", rawText);
    throw new Error("فشل فك شفرة رد الذكاء الاصطناعي كـ JSON صالح");
  }

  // Extract questions array from varied object shapes
  if (Array.isArray(parsed)) {
    return parsed;
  }
  if (Array.isArray(parsed.questions)) {
    return parsed.questions;
  }
  if (Array.isArray(parsed.quiz)) {
    return parsed.quiz;
  }
  if (Array.isArray(parsed.items)) {
    return parsed.items;
  }
  if (Array.isArray(parsed.data)) {
    return parsed.data;
  }

  return [];
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

  // Auto-fallback if requested model is 404 or deprecated
  if (!pingRes.ok && isModelNotFoundError(pingRes.status, pingRes.errorMsg)) {
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
