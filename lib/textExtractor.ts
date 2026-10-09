import mammoth from "mammoth";

// Dynamic import or require for pdf-parse to be safe across environments
async function parsePdfBuffer(buffer: Buffer): Promise<string> {
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
    console.error("[TextExtractor] PDF parse error:", err);
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

export interface ExtractionResult {
  rawText: string;
  cleanedText: string;
  wordCount: number;
  charCount: number;
  sections: ExtractedSection[];
  suggestedTopics: string[];
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
      const chunkSize = 500;
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

  return parts.map((part, index) => {
    // Extract first line as title
    const firstLineEnd = part.indexOf("\n");
    let title = firstLineEnd !== -1 ? part.slice(0, firstLineEnd).trim() : part.slice(0, 50).trim();
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
 * Main extractor supporting docx, pdf, and plain text buffers.
 */
export async function extractTextFromBuffer(
  buffer: Buffer,
  fileType: "docx" | "pdf" | "txt" | "manual"
): Promise<ExtractionResult> {
  let raw = "";

  if (fileType === "docx") {
    const res = await mammoth.extractRawText({ buffer });
    raw = res.value || "";
  } else if (fileType === "pdf") {
    raw = await parsePdfBuffer(buffer);
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
  };
}
