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
  ocrUsed?: boolean;
  digitalFastPath?: boolean;
  notice?: string;
  pageCount?: number;
}

export interface ClientExtractionOptions {
  title?: string;
  subject?: string;
  grade?: string;
  customTopics?: string[];
  groupId?: string;
  apiKey?: string;
  forceOcr?: boolean;
  ocrChunkUrl?: string;
  batchSize?: number;
  startPage?: number;
  endPage?: number;
  pageRange?: string;
  onProgress?: (step: string, percent: number) => void;
  processOcrChunk?: (
    pages: string[],
    startPage: number,
    endPage: number
  ) => Promise<{ transcribedText: string; sections?: any[] }>;
}

/**
 * Normalizes Eastern Arabic digits (٠١٢٣٤٥٦٧٨٩) and Persian digits (۰۱۲۳۴۵۶۷۸۹) to Western Arabic digits (0123456789).
 */
export function normalizeDigits(input: string): string {
  return input
    .replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 1632))
    .replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 1776));
}

/**
 * Parses user page range input like "1-30", "1 - 30", "١-٣٠", "من 1 إلى 30", "1 الى 30", "15", "10-", "-30", etc.
 * Supports Eastern Arabic & Persian numerals, Arabic text prefixes/connectors, and clamping against total doc pages.
 */
export function parsePageRange(
  input?: string,
  maxPages?: number
): { startPage: number; endPage: number } | null {
  if (!input || !input.trim()) return null;
  let normalized = normalizeDigits(input.trim());

  // Open-ended "from X" / "من X" (without end page)
  const fromOnlyMatch = normalized.match(/^(?:من\s+|from\s+)(\d+)$/i);
  if (fromOnlyMatch) {
    let start = parseInt(fromOnlyMatch[1], 10);
    if (isNaN(start) || start < 1) start = 1;
    let end = maxPages && maxPages > 0 ? maxPages : start;
    if (maxPages && maxPages > 0) {
      start = Math.max(1, Math.min(start, maxPages));
      end = Math.max(start, Math.min(end, maxPages));
    }
    return { startPage: start, endPage: end };
  }

  // Strip prefixes like "من", "صفحة", "صفحات", "ص", "from", "pages", "page", "p", "p.", "pg"
  normalized = normalized
    .replace(/^(?:من\s+|صفحة\s+|صفحات\s+|ص\s+|from\s+|pages?\s+|p\.?\s*|pg\.?\s*)/i, "")
    .trim();

  // 1. Open-ended start: e.g. "10-", "10 -", "10..", "10 to", "10 الى", "10 إلى", "10 حتى"
  const openStartMatch = normalized.match(
    /^(\d+)\s*(?:-|–|—|~|\.\.|:|\s+to\s*|\s+إلى\s*|\s+الى\s*|\s+حتى\s*)$/i
  );
  if (openStartMatch) {
    let start = parseInt(openStartMatch[1], 10);
    if (isNaN(start) || start < 1) start = 1;
    let end = maxPages && maxPages > 0 ? maxPages : start;
    if (maxPages && maxPages > 0) {
      start = Math.max(1, Math.min(start, maxPages));
      end = Math.max(start, Math.min(end, maxPages));
    }
    return { startPage: start, endPage: end };
  }

  // 2. Open-ended end: e.g. "-30", "- 30", "..30", "الى 30", "إلى 30", "حتى 30", "to 30"
  const openEndMatch = normalized.match(
    /^(?:-|–|—|~|\.\.|:|\s*to\s+|\s*إلى\s+|\s*الى\s+|\s*حتى\s+)\s*(\d+)$/i
  );
  if (openEndMatch) {
    let end = parseInt(openEndMatch[1], 10);
    if (isNaN(end) || end < 1) end = 1;
    if (maxPages && maxPages > 0) {
      end = Math.max(1, Math.min(end, maxPages));
    }
    return { startPage: 1, endPage: end };
  }

  // 3. Range: "1-30", "1 - 30", "1 to 30", "1 الى 30", "1 إلى 30", "1 حتى 30", "1..30", "1:30"
  const rangeMatch = normalized.match(
    /^(\d+)\s*(?:-|–|—|~|\.\.|:|\s+to\s+|\s+إلى\s+|\s+الى\s+|\s+حتى\s+|\s+لـ\s+|\s+لغاية\s+)\s*(\d+)$/i
  );
  if (rangeMatch) {
    let start = parseInt(rangeMatch[1], 10);
    let end = parseInt(rangeMatch[2], 10);
    if (isNaN(start) || start < 1) start = 1;
    if (isNaN(end) || end < 1) end = maxPages || start;
    if (start > end) {
      const tmp = start;
      start = end;
      end = tmp;
    }
    if (maxPages && maxPages > 0) {
      start = Math.max(1, Math.min(start, maxPages));
      end = Math.max(start, Math.min(end, maxPages));
    }
    return { startPage: start, endPage: end };
  }

  // 4. Single page: "15"
  const singleMatch = normalized.match(/^(\d+)$/);
  if (singleMatch) {
    let p = parseInt(singleMatch[1], 10);
    if (isNaN(p) || p < 1) p = 1;
    if (maxPages && maxPages > 0) {
      p = Math.max(1, Math.min(p, maxPages));
    }
    return { startPage: p, endPage: p };
  }

  return null;
}

/**
 * Quickly inspect page count of a PDF file in the browser without extracting full page contents.
 */
export async function getPdfPageCount(file: File): Promise<number> {
  if (!file || !file.name || !file.name.toLowerCase().endsWith(".pdf")) return 0;
  try {
    const arrayBuffer = await file.arrayBuffer();
    const uint8 = new Uint8Array(arrayBuffer);
    const pdf = await loadPdfDocument(uint8);
    const count = pdf.numPages || 0;
    try {
      if (typeof pdf.destroy === "function") {
        pdf.destroy();
      }
    } catch {}
    return count;
  } catch (e) {
    console.warn("[getPdfPageCount] Failed to read page count:", e);
    return 0;
  }
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
 * Load PDF document using pdfjs-dist in the browser environment with worker fallback.
 */
export async function loadPdfDocument(uint8: Uint8Array): Promise<any> {
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

  try {
    return await loadingTask.promise;
  } catch (loadErr: any) {
    if (
      loadErr?.name === "PasswordException" ||
      loadErr?.message?.toLowerCase().includes("password")
    ) {
      throw new Error("ملف الـ PDF محمي بكلمة مرور. يرجى إزالة كلمة المرور وإعادة الرفع.");
    }

    // If local worker failed, fallback to CDN worker
    if (pdfjs.GlobalWorkerOptions) {
      pdfjs.GlobalWorkerOptions.workerSrc = `https://unpkg.com/pdfjs-dist@${pdfjsVersion}/build/pdf.worker.min.mjs`;
      loadingTask = pdfjs.getDocument(docOptions);
      return await loadingTask.promise;
    }
    throw loadErr;
  }
}

/**
 * Render a single PDF page onto an offscreen HTML <canvas> scaled to crisp ~1024px width,
 * exported as JPEG with 0.70-0.75 quality (~50-70 KB per page).
 */
export async function renderPdfPageToJpeg(
  page: any,
  maxWidth: number = 1024,
  quality: number = 0.72
): Promise<string> {
  if (typeof document === "undefined") {
    throw new Error("تتطلب المعالجة البصرية لصفحات المستند بيئة متصفح تدعم Canvas.");
  }

  const unscaledViewport = page.getViewport({ scale: 1.0 });
  const baseWidth = unscaledViewport.width || 612;
  // Properly scale high-resolution or low-resolution pages to target maxWidth
  const targetScale = maxWidth / baseWidth;
  const scale = Math.max(0.2, Math.min(2.5, targetScale));
  const viewport = page.getViewport({ scale });

  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.floor(viewport.width));
  canvas.height = Math.max(1, Math.floor(viewport.height));

  const ctx = canvas.getContext("2d", { alpha: false });
  if (!ctx) {
    throw new Error("فشل إنشاء سياق الرسم (Canvas Context) لمعالجة صفحة المستند.");
  }

  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  const renderContext = {
    canvasContext: ctx,
    viewport,
  };

  try {
    await page.render(renderContext).promise;
  } finally {
    try {
      if (typeof page.cleanup === "function") {
        page.cleanup();
      }
    } catch {}
  }

  const dataUrl = canvas.toDataURL("image/jpeg", quality);

  // Free canvas memory
  canvas.width = 0;
  canvas.height = 0;

  return dataUrl;
}

/**
 * Call the Chunk OCR API endpoint with retry handling for rate limits and server errors.
 */
async function callOcrChunkApi(
  url: string,
  payload: {
    pages: string[];
    startPage: number;
    endPage: number;
    apiKey?: string;
    documentTitle?: string;
  },
  customHandler?: (pages: string[], start: number, end: number) => Promise<{ transcribedText: string; sections?: any[] }>,
  onStatusUpdate?: (msg: string) => void
): Promise<{ transcribedText: string; sections?: any[] }> {
  if (customHandler) {
    return await customHandler(payload.pages, payload.startPage, payload.endPage);
  }

  let attempts = 0;
  const maxAttempts = 6;

  while (attempts < maxAttempts) {
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      const resText = await res.text();
      let data: any = null;
      try {
        data = JSON.parse(resText);
      } catch {}

      const isRateLimit =
        res.status === 429 ||
        data?.error?.includes("429") ||
        data?.error?.includes("RESOURCE_EXHAUSTED");
      const isTransientServerError =
        res.status === 503 ||
        res.status === 502 ||
        data?.error?.includes("503") ||
        data?.error?.includes("overloaded");

      if (isRateLimit || isTransientServerError) {
        attempts++;
        if (attempts >= maxAttempts) {
          throw new Error(data?.error || "تم تجاوز معدل طلبات الذكاء الاصطناعي (429). يرجى الانتظار دقيقة والمحاولة ثانية.");
        }
        const backoffMs = isRateLimit
          ? Math.min(32000, 4000 * Math.pow(2, attempts - 1))
          : 2500 * attempts;
        const waitSec = Math.round(backoffMs / 1000);
        onStatusUpdate?.(
          isRateLimit
            ? `⏳ جاري الانتظار لتهدئة معدل طلبات الذكاء الاصطناعي (${waitSec} ثانية - المحاولة ${attempts + 1} من ${maxAttempts})...`
            : `⏳ جاري إعادة محاولة الاتصال بالخادم (${waitSec} ثانية)...`
        );
        await new Promise((r) => setTimeout(r, backoffMs));
        continue;
      }

      if (!res.ok) {
        throw new Error(data?.error || `خطأ في استخراج الصفحات بالذكاء الاصطناعي (${res.status})`);
      }

      if (data?.transcribedText === undefined || data?.transcribedText === null) {
        throw new Error(data?.error || "لم يتم استلام استجابة صالحة من معالجة الصفحات.");
      }

      return data;
    } catch (err: any) {
      const errMsg = err?.message || String(err);
      const isRateLimit = errMsg.includes("429") || errMsg.includes("RESOURCE_EXHAUSTED");
      const isTransient =
        isRateLimit ||
        errMsg.includes("503") ||
        errMsg.includes("Failed to fetch") ||
        errMsg.includes("NetworkError");

      if (isTransient && attempts < maxAttempts - 1) {
        attempts++;
        const backoffMs = Math.min(25000, 2500 * attempts);
        onStatusUpdate?.(`⏳ جاري إعادة محاولة استخراج الصفحات (${Math.round(backoffMs / 1000)} ثانية)...`);
        await new Promise((r) => setTimeout(r, backoffMs));
        continue;
      }
      throw err;
    }
  }

  throw new Error("فشلت المعالجة البصرية للصفحات بعد المحاولات المتكررة.");
}

/**
 * Automatically process scanned PDF pages in multi-page batches (6-8 pages per chunk)
 * using offscreen canvas rendering and multimodal Gemini OCR.
 * Reduces API requests by 3x-4x, staying comfortably within Gemini's 15 RPM rate limits.
 */
export async function processScannedPdfInBrowser(
  pdf: any,
  options?: ClientExtractionOptions
): Promise<{ rawText: string; cleanedText: string; sections: ExtractedSection[] }> {
  const totalPagesInDoc = pdf.numPages;
  if (!totalPagesInDoc || totalPagesInDoc <= 0) {
    throw new Error("ملف الـ PDF لا يحتوي على أي صفحات صالحة.");
  }

  const startPage = Math.max(1, Math.min(options?.startPage || 1, totalPagesInDoc));
  const endPage = Math.max(startPage, Math.min(options?.endPage || totalPagesInDoc, totalPagesInDoc));
  const totalPagesToProcess = endPage - startPage + 1;

  options?.onProgress?.(
    `📄 تم اكتشاف مستند ممسوح ضوئياً (معالجة ${totalPagesToProcess} صفحة: من ${startPage} إلى ${endPage} من إجمالي ${totalPagesInDoc})...`,
    20
  );

  // Multi-page batching: 6-8 pages per chunk (default 6)
  const batchSize = Math.max(1, Math.min(options?.batchSize || 6, 8));
  const allTranscribedChunks: string[] = [];

  const ocrUrl =
    options?.ocrChunkUrl ||
    (options?.groupId ? `/api/groups/${options.groupId}/curriculum/ocr-chunk` : "");

  if (!ocrUrl && !options?.processOcrChunk) {
    throw new Error("لا يوجد مسار معالجة بصرية متاح للمستند الممسوح ضوئياً.");
  }

  for (let pageNum = startPage; pageNum <= endPage; pageNum += batchSize) {
    const endBatch = Math.min(pageNum + batchSize - 1, endPage);
    const currentBatchPages: string[] = [];

    // Render pages of current batch on offscreen canvas with real-time per-page feedback
    for (let p = pageNum; p <= endBatch; p++) {
      const renderPct = Math.min(
        85,
        20 + Math.round(((p - startPage) / totalPagesToProcess) * 65)
      );
      options?.onProgress?.(
        `🔍 جاري قراءة واستخراج الصفحات بالذكاء الاصطناعي (صفحة ${p} من ${endPage})...`,
        renderPct
      );

      const page = await pdf.getPage(p);
      const jpegBase64 = await renderPdfPageToJpeg(page, 1024, 0.72);
      currentBatchPages.push(jpegBase64);
    }

    const currentPct = Math.min(
      85,
      20 + Math.round(((endBatch - startPage + 1) / totalPagesToProcess) * 65)
    );
    options?.onProgress?.(
      `🔍 جاري قراءة واستخراج الصفحات بالذكاء الاصطناعي (الصفحات ${pageNum}-${endBatch} من ${endPage})...`,
      currentPct
    );

    const chunkStartTime = Date.now();
    const chunkResult = await callOcrChunkApi(
      ocrUrl,
      {
        pages: currentBatchPages,
        startPage: pageNum,
        endPage: endBatch,
        apiKey: options?.apiKey,
        documentTitle: options?.title,
      },
      options?.processOcrChunk,
      (statusMsg) => {
        options?.onProgress?.(statusMsg, currentPct);
      }
    );

    if (chunkResult.transcribedText) {
      allTranscribedChunks.push(chunkResult.transcribedText);
    }

    // Clean up internal PDF worker font/image caches after each batch
    try {
      if (typeof pdf.cleanup === "function") {
        pdf.cleanup();
      }
    } catch {}

    // Precise Rate-Limiting Pacer:
    // Gemini Free Tier allows 15 RPM. Ensure at least ~4100ms from request start to request start (<= 14.6 RPM).
    if (endBatch < endPage) {
      const elapsed = Date.now() - chunkStartTime;
      const minIntervalMs = 4100;
      const pauseMs = Math.max(800, minIntervalMs - elapsed);
      await new Promise((r) => setTimeout(r, pauseMs));
    }
  }

  const rawText = allTranscribedChunks.join("\n\n");
  const cleanedText = cleanText(rawText);

  if (!cleanedText || cleanedText.length < 15) {
    throw new Error(
      "لم يتمكن الذكاء الاصطناعي من استخراج نصوص مقروءة من صفحات المستند الممسوح ضوئياً. تأكد من وضوح الصفحات وتفعيل مفتاح Google Gemini API Key."
    );
  }

  const sections = splitIntoSections(cleanedText);

  return {
    rawText,
    cleanedText,
    sections,
  };
}

/**
 * Extract digital text from a PDF buffer in the browser environment.
 * Supports optional page ranges (e.g. pages 1-30).
 */
export async function extractPdfTextInBrowser(
  uint8: Uint8Array,
  onProgress?: (step: string, percent: number) => void,
  range?: { startPage?: number; endPage?: number } | string
): Promise<{ text: string; pdfDoc: any; totalDocPages: number; startPage: number; endPage: number }> {
  onProgress?.("⚡ جاري قراءة واستخراج فصول الكتاب في المتصفح...", 35);
  try {
    const pdf = await loadPdfDocument(uint8);
    const pages: string[] = [];
    const totalDocPages = pdf.numPages || 1;

    let resolvedRange: { startPage: number; endPage: number } | null = null;
    if (typeof range === "string") {
      resolvedRange = parsePageRange(range, totalDocPages);
    } else if (range && (range.startPage !== undefined || range.endPage !== undefined)) {
      resolvedRange = {
        startPage: range.startPage || 1,
        endPage: range.endPage || totalDocPages,
      };
    }

    const startPage = Math.max(1, Math.min(resolvedRange?.startPage || 1, totalDocPages));
    const endPage = Math.max(startPage, Math.min(resolvedRange?.endPage || totalDocPages, totalDocPages));
    const totalToExtract = endPage - startPage + 1;

    for (let pageNum = startPage; pageNum <= endPage; pageNum++) {
      const page = await pdf.getPage(pageNum);
      try {
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

        if (totalToExtract > 5 && (pageNum - startPage + 1) % Math.max(1, Math.ceil(totalToExtract / 6)) === 0) {
          const pct = Math.min(65, 35 + Math.round(((pageNum - startPage + 1) / totalToExtract) * 30));
          onProgress?.(`⚡ جاري استخراج صفحات الكتاب (${pageNum}/${endPage})...`, pct);
        }
      } finally {
        try {
          if (typeof page.cleanup === "function") {
            page.cleanup();
          }
        } catch {}
      }
    }

    return {
      text: pages.join("\n\n"),
      pdfDoc: pdf,
      totalDocPages,
      startPage,
      endPage,
    };
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
 * Converts a client file (PDF, DOCX, TXT) into a clean, lightweight JSON material payload (< 1.5 MB).
 * 
 * SMART DIGITAL PRIORITY:
 * ALWAYS attempts digital extraction first (takes 1-2 seconds with 0 API calls).
 * If digital extraction yields substantial text (> 100 words), uses it immediately!
 * Does NOT trigger visual OCR on 133 pages even if forceOcr was checked.
 * Only falls back to visual OCR if digital text is empty (< 50 words) or for image files.
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
  let ocrUsed = false;
  let digitalFastPath = false;
  let pageCount = 0;
  let notice: string | undefined = undefined;
  let precomputedSections: ExtractedSection[] | null = null;

  if (ext === "pdf") {
    fileType = "pdf";
    const arrayBuffer = await file.arrayBuffer();
    const uint8 = new Uint8Array(arrayBuffer);

    let pdfDoc: any = null;
    let digitalWordCount = 0;
    let startExtractedPage = 1;
    let endExtractedPage = 1;

    // Resolve user range input if requested
    const requestedRange = options?.pageRange
      ? options.pageRange
      : (options?.startPage || options?.endPage)
      ? { startPage: options?.startPage || 1, endPage: options?.endPage || 999999 }
      : undefined;

    // 1. SMART DIGITAL PRIORITY:
    // ALWAYS attempt digital PDF text extraction first — EVEN IF forceOcr was checked!
    // Why: Digital textbooks (like Crop Production Book, 133 pages) contain authentic digital text
    // that extracts in 1-2 seconds with 100% precision, 0 API calls, and zero rate limits.
    try {
      const extraction = await extractPdfTextInBrowser(
        uint8,
        options?.onProgress,
        requestedRange
      );
      rawText = extraction.text;
      pdfDoc = extraction.pdfDoc;
      pageCount = extraction.totalDocPages;
      startExtractedPage = extraction.startPage;
      endExtractedPage = extraction.endPage;
      const cleanedDigital = cleanText(rawText);
      digitalWordCount = cleanedDigital.split(/\s+/).filter(Boolean).length;
    } catch (e: any) {
      if (
        e?.name === "PasswordException" ||
        /password|كلمة مرور|محمي/i.test(e?.message || "")
      ) {
        throw e;
      }
      // If digital extraction failed or crashed on scanned PDF, proceed to load for OCR
      pdfDoc = null;
    }

    const digitalCleaned = cleanText(rawText);
    const pagesExtractedCount = Math.max(1, endExtractedPage - startExtractedPage + 1);
    // Real digital documents contain substantial extractable words.
    // If digital extraction yields substantial text (> 100 words, or >= 50 words for short documents/sections):
    // Use it immediately with digitalFastPath: true!
    const hasSubstantialDigitalText =
      digitalWordCount >= 100 ||
      (digitalWordCount >= 50 && (pagesExtractedCount <= 2 || (digitalWordCount / pagesExtractedCount) >= 1.5));
    const isScannedOrEmpty = !hasSubstantialDigitalText || digitalWordCount < 50 || digitalCleaned.length < 15;

    if (hasSubstantialDigitalText) {
      // FAST PATH: Digital text extracted successfully!
      // We do NOT trigger visual OCR on 133 pages even if forceOcr was checked.
      digitalFastPath = true;
      ocrUsed = false;
      const isPartialRange = startExtractedPage > 1 || endExtractedPage < pageCount;
      const rangeLabel = isPartialRange ? ` (الصفحات ${startExtractedPage}-${endExtractedPage} من ${pageCount})` : "";

      if (options?.forceOcr) {
        notice = `تم استخراج محتوى وفصول الكتاب${rangeLabel} بنجاح وفورياً عبر محرك القراءة الرقمية عالي الدقة (تم تخطي التعرف البصري المجهد لتوفير وقت الانتظار وكوتا الذكاء الاصطناعي).`;
        options?.onProgress?.(
          `⚡ تم استخراج نصوص وفصول الكتاب${rangeLabel} رقمياً في ثوانٍ بدقة 100% وتخطي المعالجة البصرية لتوفير الوقت والكوتا...`,
          65
        );
      } else if (isPartialRange) {
        notice = `تم استخراج الصفحات المحددة${rangeLabel} بنجاح وفورياً.`;
      }
    } else if (isScannedOrEmpty) {
      // FALL BACK TO VISUAL OCR ONLY WHEN DIGITAL TEXT IS EMPTY / SCANNED (< 50 words)
      if (options?.groupId || options?.processOcrChunk || options?.ocrChunkUrl) {
        if (!pdfDoc) {
          pdfDoc = await loadPdfDocument(uint8);
        }
        pageCount = pdfDoc.numPages || 1;
        const ocrOptions: ClientExtractionOptions = {
          ...options,
          startPage: startExtractedPage,
          endPage: endExtractedPage,
        };
        const ocrResult = await processScannedPdfInBrowser(pdfDoc, ocrOptions);
        rawText = ocrResult.rawText;
        precomputedSections = ocrResult.sections;
        ocrUsed = true;
      } else {
        throw new Error(
          "ملف الـ PDF المرفوع عبارة عن مستند ممسوح ضوئياً (صور) بدون نصوص رقمية أصلية. يرجى توفير معرف المجموعة لتفعيل المعالجة التلقائية بالذكاء الاصطناعي (OCR)."
        );
      }
    }

    // Free PDF document memory
    try {
      if (pdfDoc && typeof pdfDoc.destroy === "function") {
        await pdfDoc.destroy();
      }
    } catch {}
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

  options?.onProgress?.("⚡ جاري تنظيف النصوص واستخراج الفصول...", 88);

  const cleanedText = cleanText(rawText);

  if (!cleanedText || cleanedText.length < 15) {
    throw new Error(
      "لم يتم العثور على نص كافٍ في الملف. تأكد من وضوح المحتوى واحتواء المستند على نصوص قابلة للقراءة."
    );
  }

  const sections =
    precomputedSections && precomputedSections.length > 0
      ? precomputedSections
      : splitIntoSections(cleanedText);

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
    ocrUsed,
    digitalFastPath,
    notice,
    pageCount,
  };
}
