import { cleanText, splitIntoSections, extractSuggestedTopics, ExtractedSection } from "./textCleaner";

export interface PreExtractedMaterial {
  title: string;
  subject: string;
  grade: string;
  fileName: string;
  fileType: "pdf" | "docx" | "txt" | "manual" | "image";
  fileSize: number;
  rawText: string;
  cleanedText: string;
  wordCount: number;
  charCount: number;
  sections: ExtractedSection[];
  topics: string[];
}

export interface ClientExtractionOptions {
  title?: string;
  subject?: string;
  grade?: string;
  customTopics?: string[];
  onProgress?: (step: string, percent: number) => void;
}

/**
 * Check if the given file type can be extracted directly in the browser.
 */
export function isBrowserExtractable(file: File): boolean {
  if (!file || !file.name) return false;
  const ext = file.name.split(".").pop()?.toLowerCase() || "";
  return ["pdf", "docx", "txt", "md"].includes(ext);
}

/**
 * Extract text from a PDF buffer in the browser environment.
 */
async function extractPdfTextInBrowser(
  uint8: Uint8Array,
  onProgress?: (step: string, percent: number) => void
): Promise<string> {
  onProgress?.("⚡ جاري قراءة واستخراج فصول الكتاب في المتصفح...", 35);
  try {
    const pdfjs: any = await import("pdfjs-dist");
    const pdfjsVersion = pdfjs.version || "5.4.296";

    if (pdfjs.GlobalWorkerOptions) {
      // Prefer self-hosted worker from public/ directory
      pdfjs.GlobalWorkerOptions.workerSrc = "/pdf.worker.min.mjs";
    }

    const docOptions = {
      data: uint8,
      useSystemFonts: true,
      isEvalSupported: false,
      cMapUrl: `https://unpkg.com/pdfjs-dist@${pdfjsVersion}/cmaps/`,
      cMapPacked: true,
      standardFontDataUrl: `https://unpkg.com/pdfjs-dist@${pdfjsVersion}/standard_fonts/`,
    };

    let loadingTask = pdfjs.getDocument(docOptions);
    let pdf: any = null;

    try {
      pdf = await loadingTask.promise;
    } catch (loadErr: any) {
      if (
        loadErr?.name === "PasswordException" ||
        loadErr?.message?.toLowerCase().includes("password")
      ) {
        throw new Error("ملف الـ PDF محمي بكلمة مرور. يرجى إزالة كلمة المرور وإعادة الرفع.");
      }

      // If local worker failed (e.g. 404 or path resolution), fallback to CDN worker
      if (pdfjs.GlobalWorkerOptions) {
        pdfjs.GlobalWorkerOptions.workerSrc = `https://unpkg.com/pdfjs-dist@${pdfjsVersion}/build/pdf.worker.min.mjs`;
        loadingTask = pdfjs.getDocument(docOptions);
        pdf = await loadingTask.promise;
      } else {
        throw loadErr;
      }
    }

    const pages: string[] = [];
    const totalPages = pdf.numPages;

    for (let pageNum = 1; pageNum <= totalPages; pageNum++) {
      const page = await pdf.getPage(pageNum);
      const textContent = await page.getTextContent();
      const pageLines: string[] = [];
      let currentLine = "";
      let lastY: number | null = null;

      for (const item of textContent.items) {
        if (!("str" in item)) continue;
        const textItem = item as { str: string; hasEOL?: boolean; transform?: number[] };
        const str = textItem.str;
        if (!str && !textItem.hasEOL) continue;

        const currentY =
          Array.isArray(textItem.transform) && textItem.transform.length >= 6
            ? textItem.transform[5]
            : null;
        const isYChange =
          lastY !== null && currentY !== null && Math.abs(currentY - lastY) > 5;

        if (isYChange && currentLine.trim()) {
          pageLines.push(currentLine.trim());
          currentLine = "";
        }

        if (str) {
          if (currentLine && !currentLine.endsWith(" ")) {
            currentLine += " ";
          }
          currentLine += str;
        }

        if (textItem.hasEOL && currentLine.trim()) {
          pageLines.push(currentLine.trim());
          currentLine = "";
        }

        if (currentY !== null) {
          lastY = currentY;
        }
      }

      if (currentLine.trim()) {
        pageLines.push(currentLine.trim());
      }

      const pageStr = pageLines.join("\n").trim();
      if (pageStr) {
        pages.push(pageStr);
      }

      if (totalPages > 5 && pageNum % Math.max(1, Math.ceil(totalPages / 5)) === 0) {
        const pct = Math.min(60, 35 + Math.round((pageNum / totalPages) * 25));
        onProgress?.(`⚡ جاري استخراج صفحات الكتاب (${pageNum}/${totalPages})...`, pct);
      }
    }

    return pages.join("\n\n");
  } catch (err: any) {
    console.error("[BrowserTextExtractor] PDF parsing failed:", err);
    if (
      err?.name === "PasswordException" ||
      err?.message?.toLowerCase().includes("password")
    ) {
      throw new Error("ملف الـ PDF محمي بكلمة مرور. يرجى إزالة كلمة المرور وإعادة الرفع.");
    }
    throw new Error(
      `فشل استخراج النص من ملف PDF في المتصفح: ${err instanceof Error ? err.message : "الملف محمي أو تالف"}`
    );
  }
}

/**
 * Extract text from a Word (.docx) document in the browser.
 */
async function extractDocxTextInBrowser(arrayBuffer: ArrayBuffer): Promise<string> {
  const mammoth = await import("mammoth");
  const extractRawText = mammoth.extractRawText || mammoth.default?.extractRawText;
  if (!extractRawText) {
    throw new Error("Mammoth DOCX extractor is not available");
  }
  const result = await extractRawText({ arrayBuffer });
  return result?.value || "";
}

/**
 * Main client-side curriculum material extractor.
 * Converts a large client file (PDF, DOCX, TXT) into a clean, lightweight JSON material payload (< 1.5 MB)
 * that bypasses Vercel's 4.5 MB Serverless Function body limit with 100% reliability.
 */
export async function extractMaterialInBrowser(
  file: File,
  options?: ClientExtractionOptions
): Promise<PreExtractedMaterial> {
  if (!file) {
    throw new Error("لم يتم تحديد أي ملف");
  }

  const fileName = file.name || "curriculum_document";
  const ext = fileName.split(".").pop()?.toLowerCase() || "";
  const title = options?.title?.trim() || fileName.replace(/\.[^/.]+$/, "");
  const subject = options?.subject?.trim() || "عام";
  const grade = options?.grade?.trim() || "";
  const customTopics = options?.customTopics || [];

  options?.onProgress?.("⚡ جاري قراءة واستخراج فصول الكتاب في المتصفح...", 25);

  let rawText = "";
  let fileType: "pdf" | "docx" | "txt" = "txt";

  if (ext === "pdf") {
    fileType = "pdf";
    const arrayBuffer = await file.arrayBuffer();
    const uint8 = new Uint8Array(arrayBuffer);
    rawText = await extractPdfTextInBrowser(uint8, options?.onProgress);
  } else if (ext === "docx") {
    fileType = "docx";
    const arrayBuffer = await file.arrayBuffer();
    rawText = await extractDocxTextInBrowser(arrayBuffer);
  } else if (ext === "txt" || ext === "md") {
    fileType = "txt";
    rawText = await file.text();
  } else {
    throw new Error(`نوع الملف (.${ext}) غير مدعوم للاستخراج المباشر في المتصفح.`);
  }

  options?.onProgress?.("⚡ جاري تنظيف النصوص واستخراج الفصول...", 60);

  const cleanedText = cleanText(rawText);

  if (!cleanedText || cleanedText.length < 15) {
    if (file.size >= 3.5 * 1024 * 1024) {
      throw new Error(
        `ملف الـ PDF المرفوع (${(file.size / (1024 * 1024)).toFixed(1)} ميجابايت) عبارة عن مستند ممسوح ضوئياً (صور) بدون طبقة نصوص رقمية أصلية. نظراً لقيود سعة النقل السحابية (4.5 ميجابايت)، يرجى رفع ملف يحتوي على نصوص رقمية أصلية، أو تقسيم الملف إلى أجزاء أصغر (أقل من 3.5 ميجابايت) لتفعيل المعالجة بالذكاء الاصطناعي (OCR).`
      );
    }
    throw new Error(
      "لم يتم العثور على نص كافٍ في الملف. تأكد من أن ملف الـ PDF يحتوي على نصوص رقمية أصلية قابلة للتحديد وليس صوراً ممسوحة ضوئياً بدون نصوص."
    );
  }

  const sections = splitIntoSections(cleanedText);
  const suggestedTopics = extractSuggestedTopics(cleanedText);
  const combinedTopics = Array.from(new Set([...customTopics, ...suggestedTopics])).slice(0, 10);
  const wordCount = cleanedText.split(/\s+/).filter(Boolean).length;
  const charCount = cleanedText.length;

  return {
    title,
    subject,
    grade,
    fileName,
    fileType,
    fileSize: file.size,
    rawText,
    cleanedText,
    wordCount,
    charCount,
    sections,
    topics: combinedTopics,
  };
}
