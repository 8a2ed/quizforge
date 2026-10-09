import {
  RawGeneratedQuestion,
  ValidatedQuestion,
  validateAndSanitizeQuestion,
} from "./questionValidator";

export interface GenerateOptions {
  apiKey?: string;
  model?: "gemini-2.0-flash" | "gemini-1.5-flash" | "gemini-1.5-pro" | string;
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
  estimatedTokens: number;
  durationMs: number;
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
 * Estimate token count approximately (4 chars ~ 1 token).
 */
export function estimateTokens(text: string): number {
  return Math.ceil((text || "").length / 4);
}

/**
 * Generate questions via Google Gemini API with strict Zero-Hallucination grounding.
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

  const model = options.model || "gemini-2.0-flash";
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

  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;

  const res = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(requestBody),
  });

  if (!res.ok) {
    let errorDetails = "";
    try {
      const errJson = await res.json();
      errorDetails = errJson.error?.message || JSON.stringify(errJson);
    } catch {
      errorDetails = await res.text();
    }
    throw new Error(`خطأ في استجابة Gemini (${res.status}): ${errorDetails}`);
  }

  const data = await res.json();
  const rawText = data.candidates?.[0]?.content?.parts?.[0]?.text || "";

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
    modelUsed: model,
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
 * Quick connection and key verification test.
 */
export async function testGeminiConnection(
  apiKey: string,
  model: string = "gemini-2.0-flash"
): Promise<{ success: boolean; message: string; latencyMs: number }> {
  const startTime = Date.now();
  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;

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
    });

    const latencyMs = Date.now() - startTime;

    if (!res.ok) {
      const err = await res.text();
      return {
        success: false,
        message: `رمز الخطأ ${res.status}: ${err.slice(0, 200)}`,
        latencyMs,
      };
    }

    return {
      success: true,
      message: `تم الاتصال بنجاح بنموذج ${model} خلال ${latencyMs}ms!`,
      latencyMs,
    };
  } catch (e: unknown) {
    const latencyMs = Date.now() - startTime;
    return {
      success: false,
      message: `فشل الاتصال: ${e instanceof Error ? e.message : "خطأ غير معروف في الشبكة"}`,
      latencyMs,
    };
  }
}
