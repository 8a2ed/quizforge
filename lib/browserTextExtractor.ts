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
  onProgress?: (step: string, percent: number) => void;
  processOcrChunk?: (
    pages: string[],
    startPage: number,
    endPage: number
  ) => Promise<{ transcribedText: string; sections?: any[] }>;
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
 * Render a single PDF page onto an offscreen HTML <canvas> scaled to crisp ~1024-1280px width,
 * exported as JPEG with 0.75-0.8 quality (~70-120 KB per page).
 */
export async function renderPdfPageToJpeg(
  page: any,
  maxWidth: number = 1152,
  quality: number = 0.78
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
  const maxAttempts = 5;

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
          ? Math.min(30000, 3000 * Math.pow(2, attempts - 1))
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
 * Automatically process scanned PDF pages in sequential small batches (2-3 pages per chunk)
 * using offscreen canvas rendering and multimodal Gemini OCR.
 */
export async function processScannedPdfInBrowser(
  pdf: any,
  options?: ClientExtractionOptions
): Promise<{ rawText: string; cleanedText: string; sections: ExtractedSection[] }> {
  const totalPages = pdf.numPages;
  if (!totalPages || totalPages <= 0) {
    throw new Error("ملف الـ PDF لا يحتوي على أي صفحات صالحة.");
  }

  options?.onProgress?.(`📄 تم اكتشاف مستند ممسوح ضوئياً (${totalPages} صفحة)...`, 20);

  const batchSize = Math.max(1, Math.min(options?.batchSize || 2, 4));
  const allTranscribedChunks: string[] = [];

  const ocrUrl =
    options?.ocrChunkUrl ||
    (options?.groupId ? `/api/groups/${options.groupId}/curriculum/ocr-chunk` : "");

  if (!ocrUrl && !options?.processOcrChunk) {
    throw new Error("لا يوجد مسار معالجة بصرية متاح للمستند الممسوح ضوئياً.");
  }

  for (let pageNum = 1; pageNum <= totalPages; pageNum += batchSize) {
    const endPage = Math.min(pageNum + batchSize - 1, totalPages);
    const currentBatchPages: string[] = [];

    // Render pages of current batch on offscreen canvas with real-time per-page feedback
    for (let p = pageNum; p <= endPage; p++) {
      const renderPct = Math.min(85, 20 + Math.round(((p - 1) / totalPages) * 65));
      options?.onProgress?.(
        `🔍 جاري قراءة واستخراج الصفحات بالذكاء الاصطناعي (صفحة ${p} من ${totalPages})...`,
        renderPct
      );

      const page = await pdf.getPage(p);
      const jpegBase64 = await renderPdfPageToJpeg(page, 1152, 0.78);
      currentBatchPages.push(jpegBase64);
    }

    const currentPct = Math.min(85, 20 + Math.round((endPage / totalPages) * 65));
    options?.onProgress?.(
      `🔍 جاري قراءة واستخراج الصفحات بالذكاء الاصطناعي (صفحة ${pageNum} من ${totalPages})...`,
      currentPct
    );

    const chunkResult = await callOcrChunkApi(
      ocrUrl,
      {
        pages: currentBatchPages,
        startPage: pageNum,
        endPage,
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

    // Polite pause between chunks to respect API rate limits
    if (endPage < totalPages) {
      await new Promise((r) => setTimeout(r, 350));
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
 */
async function extractPdfTextInBrowser(
  uint8: Uint8Array,
  onProgress?: (step: string, percent: number) => void
): Promise<{ text: string; pdfDoc: any }> {
  onProgress?.("⚡ جاري قراءة واستخراج فصول الكتاب في المتصفح...", 35);
  try {
    const pdf = await loadPdfDocument(uint8);
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

    return {
      text: pages.join("\n\n"),
      pdfDoc: pdf,
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
 * For scanned PDFs, automatically slices pages into offscreen canvas batches and runs multimodal OCR.
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
  let precomputedSections: ExtractedSection[] | null = null;

  if (ext === "pdf") {
    fileType = "pdf";
    const arrayBuffer = await file.arrayBuffer();
    const uint8 = new Uint8Array(arrayBuffer);

    let pdfDoc: any = null;

    // Fast digital text extraction attempt if not forceOcr
    if (!options?.forceOcr) {
      try {
        const extraction = await extractPdfTextInBrowser(uint8, options?.onProgress);
        rawText = extraction.text;
        pdfDoc = extraction.pdfDoc;
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
    }

    const digitalCleaned = cleanText(rawText);
    const isScannedOrEmpty = !digitalCleaned || digitalCleaned.length < 15;

    // When PDF is scanned (or forceOcr requested): automatically slice & OCR in batches!
    if (isScannedOrEmpty || options?.forceOcr) {
      if (options?.groupId || options?.processOcrChunk || options?.ocrChunkUrl) {
        if (!pdfDoc) {
          pdfDoc = await loadPdfDocument(uint8);
        }
        const ocrResult = await processScannedPdfInBrowser(pdfDoc, options);
        rawText = ocrResult.rawText;
        precomputedSections = ocrResult.sections;
        ocrUsed = true;
      } else {
        throw new Error(
          "ملف الـ PDF المرفوع عبارة عن مستند ممسوح ضوئياً (صور) بدون نصوص رقمية أصلية. يرجى توفير معرف المجموعة لتفعيل المعالجة التلقائية بالذكاء الاصطناعي (OCR)."
        );
      }
    }
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
  };
}
