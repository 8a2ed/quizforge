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

export interface ExtractedSection {
  id: string;
  title: string;
  content: string;
  wordCount: number;
}

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
  sections: ExtractedSection[];
  suggestedTopics: string[];
  ocrUsed?: boolean;
  digitalFallback?: boolean;
  notice?: string;
}

/**
 * Clean and normalize extracted text (Arabic & English support).
 */
export function cleanText(text: string): string {
  if (!text) return "";

  return text
    // Strip UTF-8 Byte Order Mark (BOM) if present
    .replace(/^\uFEFF/, "")
    // Replace carriage returns
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    // Remove null characters or non-printable controls
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, "")
    // Remove PDF page numbers & joiner artifacts (e.g. "-- 1 of 12 --", "Page 1 of 5", "صفحة 1 من 10")
    .replace(/--\s*\d+\s+of\s+\d+\s*--/gi, "")
    .replace(/(?:Page|صفحة)\s+\d+\s*(?:of|\/|من)\s*\d+/gi, "")
    // Normalize excessive horizontal whitespace
    .replace(/[ \t]+/g, " ")
    // Normalize excessive newlines (keep max 2 for paragraph separation)
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/**
 * Detect smart sections or chapters in curriculum text.
 */
export function splitIntoSections(cleanedText: string): ExtractedSection[] {
  if (!cleanedText) return [];

  // Patterns for common Arabic and English headings/chapters
  const headingRegex = /(?:^|\n)(?=(?:(?:الوحدة|الفصل|الدرس|المبحث|الباب|المحور|المحاضرة|الجزء|عنصر)\s*(?:[\dIVX\u0660-\u0669\u0627-\u064A]+|:)|(?:أولاً|ثانياً|ثالثاً|رابعاً|خامساً|سادساً):|(?:Chapter|Unit|Lesson|Section|Module|Lecture|Part|Topic)\s*(?:[\dIVX]+|:)|#{1,3}\s+[^\n]+))/i;

  const parts = cleanedText.split(headingRegex).map((p) => p.trim()).filter(Boolean);

  if (parts.length <= 1) {
    // Fallback: If no headings detected, split by roughly 600 words if text is large, or return single section
    const words = cleanedText.split(/\s+/).filter(Boolean);
    if (words.length > 750) {
      const chunks: ExtractedSection[] = [];
      // Scale chunkSize dynamically so large textbooks (e.g. 10k-100k words) don't create thousands of section objects
      const chunkSize = Math.max(500, Math.ceil(words.length / 50));
      for (let i = 0; i < words.length; i += chunkSize) {
        const chunkWords = words.slice(i, i + chunkSize);
        const sectionNum = Math.floor(i / chunkSize) + 1;
        const content = chunkWords.join(" ");
        chunks.push({
          id: `sec-${sectionNum}`,
          title: `القسم ${sectionNum} (الكلمات ${i + 1} - ${Math.min(i + chunkSize, words.length)})`,
          content,
          wordCount: chunkWords.length,
        });
      }
      return chunks;
    }

    return [
      {
        id: "sec-1",
        title: "كامل النص الدراسي",
        content: cleanedText,
        wordCount: words.length,
      },
    ];
  }

  const sectionsList = parts.map((part, index) => {
    // Extract first line as title
    const firstLineEnd = part.indexOf("\n");
    let title = firstLineEnd !== -1 ? part.slice(0, firstLineEnd).trim() : part.slice(0, 50).trim();
    title = title.replace(/^[#*\-•]+\s*/, "").trim();
    if (title.length > 70) title = title.slice(0, 67) + "...";
    if (!title) title = `القسم ${index + 1}`;

    const words = part.split(/\s+/).filter(Boolean);
    return {
      id: `sec-${index + 1}`,
      title,
      content: part,
      wordCount: words.length,
    };
  });

  // If heading-based parts exceed 50, merge smaller adjacent sections to keep JSON lightweight
  if (parts.length > 50) {
    const targetSize = Math.ceil(parts.length / 40);
    const merged: ExtractedSection[] = [];
    for (let i = 0; i < parts.length; i += targetSize) {
      const slice = parts.slice(i, i + targetSize);
      const firstLineEnd = slice[0].indexOf("\n");
      let title = firstLineEnd !== -1 ? slice[0].slice(0, firstLineEnd).trim() : slice[0].slice(0, 50).trim();
      title = title.replace(/^[#*\-•]+\s*/, "").trim();
      if (title.length > 70) title = title.slice(0, 67) + "...";
      const combinedContent = slice.join("\n\n");
      const wordCount = combinedContent.split(/\s+/).filter(Boolean).length;
      merged.push({
        id: `sec-${merged.length + 1}`,
        title: title || `القسم ${merged.length + 1}`,
        content: combinedContent,
        wordCount,
      });
    }
    return merged;
  }

  return sectionsList;
}

/**
 * Extract suggested topics / keywords from text.
 */
export function extractSuggestedTopics(text: string): string[] {
  const topics: Set<string> = new Set();

  // Look for keywords following common prefixes
  const topicRegex = /(?:الوحدة|الفصل|الدرس|موضوع|Chapter|Unit|Topic):\s*([^\n\r,.-]+)/gi;
  let match: RegExpExecArray | null;
  while ((match = topicRegex.exec(text)) !== null) {
    if (match[1] && match[1].trim().length > 2) {
      topics.add(match[1].trim().slice(0, 40));
    }
  }

  // Look for bold/bullet points at start of lines
  const bulletRegex = /^[•\-*]\s+([^\n\r:]{3,35}):/gm;
  while ((match = bulletRegex.exec(text)) !== null) {
    if (match[1] && match[1].trim().length > 2) {
      topics.add(match[1].trim());
    }
  }

  return Array.from(topics).slice(0, 8);
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
    // Real digital documents typically have high text density.
    // If text has < 30 words or < 150 chars, or if file is large (>80KB) with < 60 words,
    // it is almost certainly a scanned document with minimal metadata or publisher header.
    const isSparseText =
      digitalWords.length < 30 ||
      cleanedDigital.length < 150 ||
      (buffer.length > 80_000 && digitalWords.length < 60);

    const hasRichDigitalText = !digitalError && (digitalWords.length >= 100 || !isSparseText);

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
