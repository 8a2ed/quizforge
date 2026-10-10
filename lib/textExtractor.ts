import mammoth from "mammoth";
import "./domPolyfill";
import { ensureDomPolyfills } from "./domPolyfill";
import { extractDocumentTextWithGemini } from "./gemini";

// Dynamic import or require for pdf-parse to be safe across environments
async function parsePdfBuffer(buffer: Buffer): Promise<string> {
  ensureDomPolyfills();
  let parserInstance: any = null;
  try {
    // pdf-parse v2 provides PDFParse class
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const pdfModule = require("pdf-parse");
    const PDFParse = pdfModule.PDFParse || pdfModule.default?.PDFParse || pdfModule;
    if (typeof PDFParse === "function") {
      parserInstance = new PDFParse({ data: buffer });
      const res = await parserInstance.getText({ pageJoiner: "\n\n" });
      return res?.text || "";
    }
    // Fallback if legacy v1 callable function
    if (typeof pdfModule === "function") {
      const res = await pdfModule(buffer);
      return res?.text || "";
    }
    return "";
  } catch (err: unknown) {
    console.error("[TextExtractor] Digital PDF parse error:", err);
    throw new Error(
      `فشل استخراج النص من ملف الـ PDF: ${err instanceof Error ? err.message : "صيغة غير مدعومة أو ملف محمي"}`
    );
  } finally {
    if (parserInstance && typeof parserInstance.destroy === "function") {
      await parserInstance.destroy().catch(() => {});
    }
  }
}

import {
  cleanText,
  splitIntoSections,
  extractSuggestedTopics,
  ExtractedSection,
} from "./textCleaner";

export {
  cleanText,
  splitIntoSections,
  extractSuggestedTopics,
  type ExtractedSection,
};

export type SupportedFileType = "docx" | "pdf" | "txt" | "manual" | "image";

export interface ExtractionOptions {
  apiKey?: string;
  model?: string;
  fileName?: string;
  mimeType?: string;
  forceOcr?: boolean;
}

export interface ExtractionResult {
  rawText: string;
  cleanedText: string;
  wordCount: number;
  charCount: number;
  sections: import("./textCleaner").ExtractedSection[];
  suggestedTopics: string[];
  ocrUsed?: boolean;
  digitalFallback?: boolean;
  notice?: string;
}


/**
 * Main extractor supporting docx, pdf, plain text buffers, and images (OCR).
 */
export async function extractTextFromBuffer(
  buffer: Buffer,
  fileType: SupportedFileType,
  options?: ExtractionOptions
): Promise<ExtractionResult> {
  // Global hard ceiling guard: Reject files exceeding 50MB early
  if (buffer.length > 50 * 1024 * 1024) {
    throw new Error(
      `حجم الملف (${(buffer.length / (1024 * 1024)).toFixed(1)} ميجابايت) يتجاوز الحد الأقصى المسموح به (50 ميجابايت). يرجى تقليل حجم الكتاب أو ضغطه أو تقسيمه لضمان المعالجة السليمة.`
    );
  }

  let raw = "";
  let ocrUsed = false;
  let digitalFallback = false;
  let notice: string | undefined = undefined;

  if (fileType === "image") {
    if (buffer.length > 14 * 1024 * 1024) {
      throw new Error(
        `حجم الصورة (${(buffer.length / (1024 * 1024)).toFixed(1)} ميجابايت) يتجاوز الحد الأقصى المسموح به للتعرف البصري المباشر (14 ميجابايت). يرجى ضغط الصورة أو تصغير أبعادها والمحاولة مرة أخرى.`
      );
    }
    // Images: Scanned pages, handwritten notes, textbook photos
    let mimeType = options?.mimeType;
    if (!mimeType && options?.fileName) {
      const ext = options.fileName.split(".").pop()?.toLowerCase();
      if (ext === "png") mimeType = "image/png";
      else if (ext === "webp") mimeType = "image/webp";
      else mimeType = "image/jpeg";
    }
    if (!mimeType) mimeType = "image/jpeg";

    const ocrResult = await extractDocumentTextWithGemini({
      buffer,
      mimeType,
      apiKey: options?.apiKey,
      model: options?.model,
      documentTitle: options?.fileName,
    });
    raw = ocrResult.text;
    ocrUsed = true;
  } else if (fileType === "pdf") {
    const isLargeFile = buffer.length > 14 * 1024 * 1024;
    let digitalText = "";
    let digitalError: any = null;

    // 1. Digital PDF extraction:
    // If forceOcr is NOT requested OR if the file is large (>14MB), attempt digital PDF text extraction first.
    // Why: Google Gemini REST API has a hard 20MB inline HTTP body ceiling (~14MB raw buffer).
    // Authentic digital textbooks (even 20-50MB) like Crop Production Book contain rich digital text
    // that must be parsed directly with high speed and zero timeouts instead of failing!
    if (!options?.forceOcr || isLargeFile) {
      try {
        digitalText = await parsePdfBuffer(buffer);
      } catch (err) {
        digitalError = err;
      }
    }

    const cleanedDigital = cleanText(digitalText);
    const digitalWords = cleanedDigital.split(/\s+/).filter(Boolean);
    // Real digital documents (e.g. 20-50MB textbooks like Crop Production Book) contain extractable digital text.
    // If digitalText was parsed and has valid content (>= 15 chars or >= 5 words), it is authentic digital text!
    const hasDigitalContent = !digitalError && (digitalWords.length >= 5 || cleanedDigital.length >= 15);
    const isSparseText =
      digitalWords.length < 30 ||
      cleanedDigital.length < 150 ||
      (buffer.length > 80_000 && digitalWords.length < 60);

    const hasRichDigitalText = !digitalError && (digitalWords.length >= 100 || !isSparseText || hasDigitalContent);

    if (isLargeFile) {
      // Large file (>14MB, up to 50MB):
      if (hasRichDigitalText) {
        raw = digitalText;
        ocrUsed = false;
        digitalFallback = Boolean(options?.forceOcr);
        if (options?.forceOcr) {
          notice = `تم استخراج محتوى وفصول الكتاب (${(buffer.length / (1024 * 1024)).toFixed(1)} ميجابايت) بنجاح عبر محرك القراءة الرقمية المباشر، نظراً لأن حجم الكتاب يتجاوز حد المسح البصري المباشر (14 ميجابايت) واحتوائه على نصوص رقمية أصلية عالية الدقة.`;
        }
      } else if (digitalError) {
        // Parsing failed due to corrupt, password-protected, or encrypted PDF
        const errMsg = digitalError instanceof Error ? digitalError.message : String(digitalError);
        if (/password|encrypted|محمي|كلمة مرور/i.test(errMsg)) {
          throw new Error(`ملف الـ PDF محمي بكلمة مرور. يرجى إزالة الحماية من الملف ثم إعادة رفعه.`);
        }
        throw new Error(`تعذر قراءة ملف الـ PDF: ${errMsg}. يرجى التأكد من سلامة وصحة الملف.`);
      } else {
        // Large file with virtually zero digital text (pure scanned images)
        throw new Error(
          `حجم ملف الـ PDF (${(buffer.length / (1024 * 1024)).toFixed(1)} ميجابايت) يتجاوز الحد الأقصى للمعالجة البصرية المباشرة بالذكاء الاصطناعي (14 ميجابايت)، والملف عبارة عن صور ممسوحة ضوئياً بدون نصوص رقمية جاهزة. يرجى ضغط ملف الـ PDF ليكون أقل من 14 ميجابايت لتفعيل القراءة البصرية بالذكاء الاصطناعي (OCR) أو استخدام ملف PDF يحتوي على نصوص قابلة للتحديد.`
        );
      }
    } else {
      // Normal size file (<= 14MB):
      const hasSufficientDigitalText = !digitalError && !isSparseText && !options?.forceOcr;

      if (hasSufficientDigitalText) {
        raw = digitalText;
      } else {
        // PDF has insufficient/no digital text or forceOcr was requested
        const hasApiKey = !!(options?.apiKey?.trim() || process.env.GEMINI_API_KEY?.trim());
        if (hasApiKey) {
          console.log(
            "[TextExtractor] Scanned / handwritten PDF detected or forceOcr enabled. Invoking NotebookLM Gemini Multimodal OCR..."
          );
          try {
            const ocrResult = await extractDocumentTextWithGemini({
              buffer,
              mimeType: "application/pdf",
              apiKey: options?.apiKey,
              model: options?.model,
              documentTitle: options?.fileName,
            });
            const cleanedOcr = cleanText(ocrResult.text);
            const ocrWords = cleanedOcr.split(/\s+/).filter(Boolean);
            if (ocrWords.length >= digitalWords.length || options?.forceOcr || isSparseText) {
              raw = ocrResult.text;
              ocrUsed = true;
            } else {
              raw = digitalText;
            }
          } catch (ocrErr) {
            console.error("[TextExtractor] Gemini PDF OCR failed:", ocrErr);
            // Attempt direct digital text extraction fallback if not yet fetched
            if (!digitalText) {
              try {
                digitalText = await parsePdfBuffer(buffer);
              } catch {}
            }
            if (digitalText && digitalText.trim().length > 0) {
              raw = digitalText;
              digitalFallback = true;
              notice = "تعذر إتمام التعرف البصري (OCR) عبر الذكاء الاصطناعي، وتم استخراج النصوص الرقمية المباشرة للمستند بنجاح بدلاً من ذلك.";
            } else {
              throw ocrErr;
            }
          }
        } else {
          if (options?.forceOcr) {
            throw new Error(
              "لم يتم العثور على مفتاح Google Gemini API Key. يرجى إدخال المفتاح في تبويب 'إعدادات الذكاء الاصطناعي' أو إضافته في ملف البيئة (GEMINI_API_KEY) لتفعيل ميزة التعرف البصري على الصور والمستندات (OCR)."
            );
          }
          if (digitalError) {
            throw digitalError;
          }
          raw = digitalText;
        }
      }
    }
  } else if (fileType === "docx") {
    const res = await mammoth.extractRawText({ buffer });
    raw = res.value || "";
  } else {
    // Plain text / manual: Detect UTF-8 vs Arabic Windows-1256 (ANSI)
    try {
      const utf8Str = buffer.toString("utf-8");
      // If excessive replacement characters are present, fallback to Windows-1256
      const replacementCount = (utf8Str.match(/\uFFFD/g) || []).length;
      if (replacementCount > 3 && replacementCount > utf8Str.length * 0.05) {
        try {
          const decoder = new TextDecoder("windows-1256");
          raw = decoder.decode(buffer);
        } catch {
          raw = utf8Str;
        }
      } else {
        raw = utf8Str;
      }
    } catch {
      raw = buffer.toString("utf-8");
    }
  }

  const cleanedText = cleanText(raw);
  const words = cleanedText.split(/\s+/).filter(Boolean);
  const wordCount = words.length;
  const charCount = cleanedText.length;
  const sections = splitIntoSections(cleanedText);
  const suggestedTopics = extractSuggestedTopics(cleanedText);

  return {
    rawText: raw,
    cleanedText,
    wordCount,
    charCount,
    sections,
    suggestedTopics,
    ocrUsed,
    digitalFallback,
    notice,
  };
}
