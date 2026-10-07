"use client";

import { useState, useEffect, useMemo, useRef } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { motion, AnimatePresence } from "framer-motion";
import { 
  FileText, UploadCloud, LayoutList, CheckCircle2, 
  Settings2, Copy, AlertCircle, Trash2, Sparkles,
  PlusCircle, ChevronDown, ChevronUp
} from "lucide-react";
import * as XLSX from "xlsx";
import * as mammoth from "mammoth";
import CompletionPostModal, {
  CompletionPostConfig,
  DEFAULT_COMPLETION_POST_CONFIG,
} from "@/components/CompletionPostModal";

const uid = () => Math.random().toString(36).substr(2, 9);

interface QuizPreview {
  id: string;
  question: string;
  options: string[];
  type: "quiz" | "poll";
  correctOptionId?: number | null;
  explanation?: string;
  topicId?: number;
  topicName?: string;
  collectionId?: string;
  collectionName?: string;
  collectionIds?: string[];
  isAnonymous?: boolean;
  allowsMultiple?: boolean;
  openPeriod?: number;
  tags?: string[];
  errors?: string[];
}

interface Topic { message_thread_id: number; name: string; icon_color: number; }
interface Collection { id: string; name: string; emoji: string; color: string; quizCount?: number; }
interface SmartTemplate { id: string; title: string; badge: string; description: string; sample: string; }

const TEMPLATES: SmartTemplate[] = [
  {
    id: "ar-standard",
    title: "اصطمبة شاملة",
    badge: "الأكثر استخداماً 🇸🇦",
    description: "نموذج عربي متكامل يشمل السؤال، الخيارات، الإجابة الصحيحة، الشرح، التوبيك، والتصنيف.",
    sample: "الموضوع: تكنولوجيا البرمجة\nالتصنيف: اختبارات عامة\nالوسوم: javascript, web, easy\n\nس1: ما هي لغة البرمجة الأكثر استخداماً لتطوير واجهات مواقع الويب التفاعلية؟\nأ. Python\nب. JavaScript\nج. C++\nد. Ruby\nالإجابة: ب\nالشرح: لغة JavaScript هي اللغة الأساسية لتشغيل التفاعلات البرمجية في متصفحات الويب الحديثة.\n\nس2: ما هو الاختصار لـ Cascading Style Sheets؟\nأ. CSS\nب. HTML\nج. SQL\nد. PHP\nالإجابة: أ\nالشرح: CSS هي لغة تنسيق صفحات الويب وتصميم المظهر والخطوط والألوان المتجاوبة."
  },
  {
    id: "quick-inline",
    title: "حل مباشر (صح)",
    badge: "سريعة وذكية ⚡",
    description: "ضع علامة (صح) أو ✓ بجانب الخيار الصحيح مباشرة.",
    sample: "س1: ما هي عاصمة جمهورية مصر العربية؟\n- الإسكندرية\n- القاهرة (صح)\n- الجيزة\n- أسوان\nالشرح: القاهرة هي العاصمة الرسمية وأكبر مدن جمهورية مصر العربية وأعرقها تاريخاً.\n\nس2: ما هو الكوكب الملقب بـ الكوكب الأحمر في المجموعة الشمسية؟\nأ. الزهرة\nب. المريخ (صحيح)\nج. المشتري\nد. زحل\nالشرح: يكتسب كوكب المريخ لونه الأحمر نتيجة انتشار أكسيد الحديد (الصدأ) على سطحه بكثافة."
  },
  {
    id: "en-standard",
    title: "English Standard",
    badge: "English 🇬🇧",
    description: "Full English template with Topic, Category, Question, Options, Answer, Explanation, and Tags.",
    sample: "Topic: Computer Science\nCategory: General Knowledge\nTags: tech, hardware, basics\n\n1. What does CPU stand for in computer hardware?\nA. Central Processing Unit\nB. Computer Personal Unit\nC. Central Power Utility\nD. Core Processor Unified\nAnswer: A\nExplanation: The CPU is often described as the brain of the computer, executing instructions.\n\n2. Which type of computer memory is volatile and loses data when powered off?\nA. Solid State Drive (SSD)\nB. Read-Only Memory (ROM)\nC. Random Access Memory (RAM)\nD. Magnetic Hard Disk\nAnswer: C\nExplanation: RAM is high-speed temporary memory that gets cleared when the machine turns off."
  },
  {
    id: "poll-template",
    title: "استطلاع رأي",
    badge: "تصويت 📊",
    description: "استطلاع بدون إجابة صحيحة محددة، مخصص للتصويت وقياس الآراء.",
    sample: "الموضوع: النقاشات العامة\nالوسوم: استطلاع, تصويت\n\nما هو إطار العمل المفضل لديك لتطوير وتصميم تطبيقات الويب الحديثة؟\n• Next.js / React\n• Vue.js / Nuxt\n• Svelte / SvelteKit\n• Angular\n• إطار عمل آخر"
  }
];

function validate(p: Partial<QuizPreview>): string[] {
  const e: string[] = [];
  const q = p.question?.trim() || "";
  if (!q) e.push("Question is missing");
  else if (q.length > 300) e.push(`Question exceeds 300 chars (${q.length}/300)`);

  const cleanOpts = (p.options || []).map(o => o.trim()).filter(Boolean);
  if (cleanOpts.length < 2) e.push("Need at least 2 options");
  else if (cleanOpts.length > 10) e.push("Max 10 options allowed by Telegram");

  if (cleanOpts.some(o => o.length > 100)) e.push("Each option must be 100 characters or less");

  const lower = cleanOpts.map(o => o.toLowerCase());
  if (new Set(lower).size !== lower.length) e.push("Options must be unique (duplicate answers found)");

  if (p.type === "quiz") {
    if (p.correctOptionId === undefined || p.correctOptionId === null || p.correctOptionId < 0 || p.correctOptionId >= cleanOpts.length) {
      e.push("Quiz needs a valid correct answer");
    }
  }

  if (p.type === "quiz" && p.explanation && p.explanation.trim().length > 200) {
    e.push(`Explanation exceeds 200 chars (${p.explanation.trim().length}/200)`);
  }
  return e;
}

function resolveCorrectOption(raw: string | undefined | null, options: string[]): number | null {
  if (!raw || options.length === 0) return null;
  let str = String(raw).trim().replace(/^["'\[\(\]\)\.\:\-]+|["'\[\(\]\)\.\:\-]+$/g, "").trim();
  if (!str) return null;

  // Exact match against options first (e.g. if the answer is the literal text of an option)
  const cleanStr = str.toLowerCase();
  let matchIdx = options.findIndex(o => o.trim().toLowerCase() === cleanStr);
  if (matchIdx !== -1) return matchIdx;

  // Strip prefixes like "الخيار", "خيار", "Option", "Choice", "Answer", "Ans", "الإجابة"
  const stripped = str
    .replace(/^(?:الخيار|خيار|option|choice|answer|ans|الجواب|الإجابة|الاجابة)\s*[:.\-]?\s*/i, "")
    .trim()
    .replace(/^["'\[\(\]\)\.\:\-]+|["'\[\(\]\)\.\:\-]+$/g, "")
    .trim();
  if (stripped) {
    str = stripped;
  }

  // Check Eastern Arabic numerals (١, ٢, ٣...)
  const easternDigits: Record<string, number> = { "١": 0, "٢": 1, "٣": 2, "٤": 3, "٥": 4, "٦": 5, "٧": 6, "٨": 7, "٩": 8, "١٠": 9 };
  if (str in easternDigits && easternDigits[str] < options.length) return easternDigits[str];

  // Arabic ordinals (الأول, الثاني, الثالث, الرابع, الخامس...)
  const arabicOrdinals: Record<string, number> = {
    "الاول": 0, "الأول": 0, "اول": 0, "أول": 0,
    "الثاني": 1, "ثاني": 1,
    "الثالث": 2, "ثالث": 2,
    "الرابع": 3, "رابع": 3,
    "الخامس": 4, "خامس": 4,
    "السادس": 5, "سادس": 5,
    "السابع": 6, "سابع": 6,
    "الثامن": 7, "ثامن": 7,
    "التاسع": 8, "تاسع": 8,
    "العاشر": 9, "عاشر": 9,
  };
  if (str in arabicOrdinals && arabicOrdinals[str] < options.length) return arabicOrdinals[str];

  // Arabic alphabet letter matching (Abjadi and Hijai)
  const arabicAbjadi = ["أ", "ب", "ج", "د", "هـ", "و", "ز", "ح", "ط", "ي"];
  const arabicHijai = ["أ", "ب", "ت", "ث", "ج", "ح", "خ", "د", "ذ", "ر"];
  const normalizedChar = str.replace(/^[إآا]/, "أ");

  let idx = arabicAbjadi.indexOf(normalizedChar);
  if (idx !== -1 && idx < options.length) return idx;
  idx = arabicHijai.indexOf(normalizedChar);
  if (idx !== -1 && idx < options.length) return idx;

  // English letters A-J
  if (/^[a-jA-J]$/.test(str)) {
    const eIdx = str.toUpperCase().charCodeAt(0) - 65;
    if (eIdx < options.length) return eIdx;
  }

  // Western numerals 1-10 (1-based index preferred)
  const n = Number(str);
  if (!isNaN(n) && Number.isInteger(n)) {
    if (n >= 1 && n <= options.length) return n - 1;
    if (n >= 0 && n < options.length) return n;
  }

  // Partial option text match (starts with or contained in)
  matchIdx = options.findIndex(o => {
    const optClean = o.trim().toLowerCase();
    return optClean.startsWith(cleanStr) || cleanStr.startsWith(optClean);
  });
  if (matchIdx !== -1) return matchIdx;

  return null;
}

function splitIntoQuestionChunks(text: string): string[] {
  const normalized = text.replace(/\r\n/g, "\n");
  const chunks = normalized.split(/\n\s*[-=_*]{3,}\s*\n|\n\s*\n+/).map(c => c.trim()).filter(Boolean);
  
  const questionRegex = /(?:^|\n)(?=(?:س\s*\d*|السؤال\s*(?:الأول|الثاني|الثالث|الرابع|الخامس|السادس|السابع|الثامن|التاسع|العاشر|\d+)?|Q\s*\d*|Question\s*\d*|Quiz\s*\d*|#\s*\d*)[:\.\)\-]|(?:\d+|[١-٩]|١٠)[\.\)\-]\s+\S)/i;
  
  const finalChunks: string[] = [];
  for (const chunk of chunks) {
    const subChunks = chunk.split(questionRegex).map(c => c.trim()).filter(Boolean);
    if (subChunks.length > 1) {
      finalChunks.push(...subChunks);
    } else {
      finalChunks.push(chunk);
    }
  }
  return finalChunks;
}

function parseSmartText(text: string, topicsList: Topic[] = [], collectionsList: Collection[] = []): QuizPreview[] {
  const chunks = splitIntoQuestionChunks(text);
  const items: QuizPreview[] = [];

  for (const chunk of chunks) {
    if (!chunk.trim()) continue;
    const lines = chunk.split("\n").map(l => l.trim()).filter(Boolean);
    let question = "";
    const options: string[] = [];
    let correctAnswerStr = "";
    let explanationStr = "";
    let inlineCorrectIndex: number | null = null;
    let topicNameStr = "";
    let categoryStr = "";
    let tagsList: string[] = [];

    for (const line of lines) {
      const topicMatch = line.match(/^(?:topic|توبيك|الموضوع|توبك)\s*[:=-]\s*(.+)/i);
      if (topicMatch) { topicNameStr = topicMatch[1].trim(); continue; }

      const catMatch = line.match(/^(?:category|collection|تصنيف|القسم|قسم|المجموعة)\s*[:=-]\s*(.+)/i);
      if (catMatch) { categoryStr = catMatch[1].trim(); continue; }

      const tagsMatch = line.match(/^(?:tags|tag|وسوم|الوسوم|هاشتاق)\s*[:=-]\s*(.+)/i);
      if (tagsMatch) { tagsList = tagsMatch[1].split(/[,#\s]+/).map(t => t.trim()).filter(Boolean); continue; }

      const ansMatch = line.match(/^(?:answer|correct answer|correct|ans|حل|الجواب|الإجابة|الاجابة)\s*[:=-]\s*(.+)/i);
      if (ansMatch) { correctAnswerStr = ansMatch[1].trim(); continue; }

      const expMatch = line.match(/^(?:explanation|note|reason|شرح|تفسير|ملاحظة|سبب)\s*[:=-]\s*(.+)/i);
      if (expMatch) { explanationStr = expMatch[1].trim(); continue; }

      const isLetterOption = /^[a-jA-Jأ-ي][\.\)\-]\s+\S/.test(line);
      const isEasternNumOption = /^[١-٩][\.\)\-]\s+\S/.test(line);
      const isBulletOption = /^[-•*⁃]\s+\S/.test(line);
      const isNumberedOption = /^\d+[\.\)\-]\s+\S/.test(line);

      if (isLetterOption || isEasternNumOption || isBulletOption || (isNumberedOption && question.length > 0)) {
        let optText = line
          .replace(/^[a-jA-Jأ-ي][\.\)\-]\s+/, "")
          .replace(/^[١-٩][\.\)\-]\s+/, "")
          .replace(/^[-•*⁃]\s+/, "")
          .replace(/^\d+[\.\)\-]\s+/, "")
          .trim();

        const inlineMarkerRegex = /[\(\[]?\s*(?:صح|صحيح|الصح|الإجابة الصحيحة|الاجابة الصحيحة|correct|true|right|answer|✓|✔|★|\[x\])\s*[\)\]]?$/i;
        const prefixMarkerRegex = /^(?:✓|✔|★|\[x\])\s*/i;

        if (inlineMarkerRegex.test(optText) || prefixMarkerRegex.test(optText)) {
          inlineCorrectIndex = options.length;
          optText = optText.replace(inlineMarkerRegex, "").replace(prefixMarkerRegex, "").trim();
        }
        options.push(optText);
      } else {
        if (options.length === 0) question += (question ? "\n" : "") + line;
        else explanationStr += (explanationStr ? " " : "") + line;
      }
    }

    question = question
      .replace(/^(?:q\s*\d*|question\s*\d*|س\s*\d*|السؤال\s*(?:الأول|الثاني|الثالث|الرابع|الخامس|السادس|السابع|الثامن|التاسع|العاشر|\d+)?)\s*[:.\)\-]\s*/i, "")
      .replace(/^(?:\d+|[١-٩]|١٠)[\.\)\-]\s+/, "")
      .trim();

    const cleanOpts = options.map(o => o.trim()).filter(Boolean);
    let correctOptionId: number | null = null;
    if (inlineCorrectIndex !== null && inlineCorrectIndex < cleanOpts.length) correctOptionId = inlineCorrectIndex;
    else if (correctAnswerStr) correctOptionId = resolveCorrectOption(correctAnswerStr, cleanOpts);

    let topicId: number | undefined;
    let topicName: string | undefined;
    if (topicNameStr && topicsList.length > 0) {
      const match = topicsList.find(t => t.name.toLowerCase().includes(topicNameStr.toLowerCase()) || topicNameStr.toLowerCase().includes(t.name.toLowerCase()));
      if (match) { topicId = match.message_thread_id; topicName = match.name; }
      else topicName = topicNameStr;
    }

    let collectionId: string | undefined;
    let collectionName: string | undefined;
    let collectionIds: string[] | undefined;
    if (categoryStr && collectionsList.length > 0) {
      const match = collectionsList.find(c => c.name.toLowerCase().includes(categoryStr.toLowerCase()) || categoryStr.toLowerCase().includes(c.name.toLowerCase()));
      if (match) { collectionId = match.id; collectionName = `${match.emoji} ${match.name}`; collectionIds = [match.id]; }
      else collectionName = categoryStr;
    }

    if (question || cleanOpts.length > 0) {
      const partial: Partial<QuizPreview> = {
        question, options: cleanOpts, correctOptionId, explanation: explanationStr || undefined,
        type: correctOptionId !== null ? "quiz" : "poll", topicId, topicName, collectionId, collectionName, collectionIds,
        tags: tagsList.length > 0 ? tagsList : undefined, isAnonymous: true,
      };
      items.push({ id: uid(), ...partial, errors: validate(partial) } as QuizPreview);
    }
  }
  return items;
}

function parseTabularData(
  rawRows: any[][],
  topicsList: Topic[] = [],
  collectionsList: Collection[] = []
): QuizPreview[] {
  if (!rawRows || rawRows.length === 0) return [];

  // Normalize rows into strings and remove empty rows
  const rows: string[][] = rawRows
    .map(r => (Array.isArray(r) ? r : []).map(c => String(c ?? "").trim()))
    .filter(r => r.some(c => c.length > 0));

  if (rows.length === 0) return [];

  const norm = (s: string) =>
    s
      .toLowerCase()
      .replace(/[\u064B-\u065F\s_:\-\.\(\)\[\]\/\\]/g, "")
      .replace(/[إأآ]/g, "ا");

  // Check row 0 (or row 1) for header keywords
  let headerRowIdx = -1;
  let qCol = -1;
  let ansCol = -1;
  let expCol = -1;
  let topicCol = -1;
  let catCol = -1;
  let tagsCol = -1;
  let combinedOptsCol = -1;
  const optCols: number[] = [];

  for (let rIdx = 0; rIdx < Math.min(3, rows.length); rIdx++) {
    const candidate = rows[rIdx];
    const foundQ = candidate.findIndex(c => {
      const n = norm(c);
      return (
        n === "سؤال" ||
        n === "السؤال" ||
        n === "نصالسؤال" ||
        n.includes("question") ||
        n === "q"
      );
    });

    if (foundQ !== -1) {
      headerRowIdx = rIdx;
      qCol = foundQ;

      candidate.forEach((colName, cIdx) => {
        if (cIdx === qCol) return;
        const n = norm(colName);

        // Answer
        if (
          ansCol === -1 &&
          (n === "إجابة" ||
            n === "الإجابة" ||
            n === "الاجابة" ||
            n === "اجابة" ||
            n === "الجواب" ||
            n === "جواب" ||
            n === "حل" ||
            n === "الحل" ||
            n === "صحيح" ||
            n.includes("answer") ||
            n.includes("correct") ||
            n === "key" ||
            n === "ans")
        ) {
          ansCol = cIdx;
          return;
        }

        // Explanation
        if (
          expCol === -1 &&
          (n === "شرح" ||
            n === "الشرح" ||
            n === "تفسير" ||
            n === "التفسير" ||
            n === "ملاحظة" ||
            n === "ملاحظات" ||
            n === "سبب" ||
            n.includes("explanation") ||
            n.includes("reason") ||
            n === "notes")
        ) {
          expCol = cIdx;
          return;
        }

        // Topic
        if (
          topicCol === -1 &&
          (n === "موضوع" || n === "الموضوع" || n === "توبيك" || n === "توبك" || n === "topic")
        ) {
          topicCol = cIdx;
          return;
        }

        // Category / Collection
        if (
          catCol === -1 &&
          (n === "تصنيف" ||
            n === "التصنيف" ||
            n === "قسم" ||
            n === "القسم" ||
            n === "مجموعة" ||
            n.includes("category") ||
            n.includes("collection"))
        ) {
          catCol = cIdx;
          return;
        }

        // Tags
        if (
          tagsCol === -1 &&
          (n === "وسوم" || n === "الوسوم" || n === "هاشتاق" || n === "تاق" || n.includes("tag"))
        ) {
          tagsCol = cIdx;
          return;
        }

        // Combined options
        if (
          combinedOptsCol === -1 &&
          (n === "خيارات" || n === "الخيارات" || n === "options" || n === "choices")
        ) {
          combinedOptsCol = cIdx;
          return;
        }

        // Individual options
        if (
          n.includes("خيار") ||
          n.includes("اختيار") ||
          n.includes("option") ||
          n.includes("choice") ||
          /^[a-j]$/.test(n) ||
          /^[أ-ي]$/.test(n) ||
          /^[1-9]$/.test(n)
        ) {
          optCols.push(cIdx);
          return;
        }
      });
      break;
    }
  }

  const items: QuizPreview[] = [];

  // Case A: Header row found
  if (headerRowIdx !== -1) {
    const dataRows = rows.slice(headerRowIdx + 1);

    for (const cols of dataRows) {
      const question = cols[qCol]?.replace(/^"|"$/g, "").trim();
      if (!question) continue;

      let options: string[] = [];
      const correctAnswerStr = ansCol !== -1 ? cols[ansCol]?.replace(/^"|"$/g, "").trim() : "";
      const explanation = expCol !== -1 ? cols[expCol]?.replace(/^"|"$/g, "").trim() || undefined : undefined;
      const topicNameStr = topicCol !== -1 ? cols[topicCol]?.replace(/^"|"$/g, "").trim() : "";
      const categoryStr = catCol !== -1 ? cols[catCol]?.replace(/^"|"$/g, "").trim() : "";
      const tagsList = tagsCol !== -1 ? cols[tagsCol]?.split(/[,#\s]+/).map(t => t.trim()).filter(Boolean) : [];

      if (combinedOptsCol !== -1 && cols[combinedOptsCol]) {
        const rawOpts = cols[combinedOptsCol].split(/\r?\n|\||؛/).map(o => o.trim()).filter(Boolean);
        options = rawOpts.map(o => o.replace(/^[a-jA-Jأ-ي1-9][\.\)\:\-]\s*/, "").trim());
      } else if (optCols.length > 0) {
        options = optCols.map(idx => cols[idx]?.replace(/^"|"$/g, "").trim()).filter(Boolean);
      } else {
        const candidateCols = cols.filter((_, idx) => idx !== qCol && idx !== ansCol && idx !== expCol && idx !== topicCol && idx !== catCol && idx !== tagsCol);
        options = candidateCols.map(o => o?.replace(/^"|"$/g, "").trim()).filter(Boolean);
      }

      let inlineCorrect: number | null = null;
      options = options.map((opt, oIdx) => {
        const markerRegex = /[\(\[]?\s*(?:صح|صحيح|الصح|الإجابة الصحيحة|الاجابة الصحيحة|correct|true|right|answer|✓|✔|★|\[x\])\s*[\)\]]?$/i;
        const prefixRegex = /^(?:✓|✔|★|\[x\])\s*/i;
        if (markerRegex.test(opt) || prefixRegex.test(opt)) {
          inlineCorrect = oIdx;
          return opt.replace(markerRegex, "").replace(prefixRegex, "").trim();
        }
        return opt;
      });

      let correctOptionId: number | null = null;
      if (inlineCorrect !== null) {
        correctOptionId = inlineCorrect;
      } else if (correctAnswerStr) {
        correctOptionId = resolveCorrectOption(correctAnswerStr, options);
      }

      let topicId: number | undefined;
      let topicName: string | undefined;
      if (topicNameStr && topicsList.length > 0) {
        const match = topicsList.find(t => t.name.toLowerCase().includes(topicNameStr.toLowerCase()) || topicNameStr.toLowerCase().includes(t.name.toLowerCase()));
        if (match) { topicId = match.message_thread_id; topicName = match.name; }
        else topicName = topicNameStr;
      } else if (topicNameStr) {
        topicName = topicNameStr;
      }

      let collectionId: string | undefined;
      let collectionName: string | undefined;
      let collectionIds: string[] | undefined;
      if (categoryStr && collectionsList.length > 0) {
        const match = collectionsList.find(c => c.name.toLowerCase().includes(categoryStr.toLowerCase()) || categoryStr.toLowerCase().includes(c.name.toLowerCase()));
        if (match) { collectionId = match.id; collectionName = `${match.emoji} ${match.name}`; collectionIds = [match.id]; }
        else collectionName = categoryStr;
      } else if (categoryStr) {
        collectionName = categoryStr;
      }

      const partial: Partial<QuizPreview> = {
        question,
        options,
        correctOptionId,
        explanation,
        type: correctOptionId !== null ? "quiz" : "poll",
        topicId,
        topicName,
        collectionId,
        collectionName,
        collectionIds,
        tags: tagsList && tagsList.length > 0 ? tagsList : undefined,
        isAnonymous: true,
      };

      items.push({ id: uid(), ...partial, errors: validate(partial) } as QuizPreview);
    }

    return items;
  }

  // Case B: No header row detected (headless table or positional format)
  const startIdx = (rows[0]?.[0]?.toLowerCase().includes("question") || rows[0]?.[0]?.includes("سؤال")) ? 1 : 0;
  for (let i = startIdx; i < rows.length; i++) {
    const cols = rows[i];
    if (cols.length < 3) continue;
    const question = cols[0]?.replace(/^"|"$/g, "").trim();
    if (!question) continue;

    let correctOptionId: number | null = null;
    let explanation: string | undefined = undefined;
    let options: string[] = [];

    if (cols.length >= 6) {
      const possibleAns = cols[5]?.replace(/^"|"$/g, "").trim();
      const testOpts = [cols[1], cols[2], cols[3], cols[4]].map(o => o?.replace(/^"|"$/g, "").trim()).filter(Boolean);
      const resolved = resolveCorrectOption(possibleAns, testOpts);
      if (resolved !== null) {
        options = testOpts;
        correctOptionId = resolved;
        explanation = cols[6]?.replace(/^"|"$/g, "").trim() || undefined;
      }
    }

    if (options.length === 0) {
      let foundCol = -1;
      let resolvedOpt: number | null = null;
      let candidateOptions: string[] = [];
      for (let cIdx = cols.length - 1; cIdx >= 2; cIdx--) {
        const candidateAns = cols[cIdx]?.replace(/^"|"$/g, "").trim();
        const candOpts = cols.slice(1, cIdx).map(o => o?.replace(/^"|"$/g, "").trim()).filter(Boolean);
        if (candOpts.length >= 2) {
          const res = resolveCorrectOption(candidateAns, candOpts);
          if (res !== null) { foundCol = cIdx; resolvedOpt = res; candidateOptions = candOpts; break; }
        }
      }
      if (foundCol !== -1) {
        options = candidateOptions;
        correctOptionId = resolvedOpt;
        explanation = cols.slice(foundCol + 1).join(" ").replace(/^"|"$/g, "").trim() || undefined;
      } else {
        options = cols.slice(1).map(o => o?.replace(/^"|"$/g, "").trim()).filter(Boolean);
      }
    }

    const partial = {
      question,
      options,
      correctOptionId,
      explanation: explanation || undefined,
      type: correctOptionId !== null ? ("quiz" as const) : ("poll" as const),
      isAnonymous: true,
    };
    items.push({ id: uid(), ...partial, errors: validate(partial) } as QuizPreview);
  }

  return items;
}

function parseCSV(text: string, topicsList: Topic[] = [], collectionsList: Collection[] = []): QuizPreview[] {
  const clean = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  const rows: string[][] = [];
  let currentRow: string[] = [];
  let currentCell = "";
  let inQuotes = false;

  for (let i = 0; i < clean.length; i++) {
    const char = clean[i];
    if (char === '"') {
      if (inQuotes && clean[i + 1] === '"') { currentCell += '"'; i++; }
      else inQuotes = !inQuotes;
    } else if (char === ',' && !inQuotes) {
      currentRow.push(currentCell.trim()); currentCell = "";
    } else if ((char === '\r' || char === '\n') && !inQuotes) {
      if (char === '\r' && clean[i + 1] === '\n') i++;
      currentRow.push(currentCell.trim()); currentCell = "";
      if (currentRow.some(c => c.length > 0)) rows.push(currentRow);
      currentRow = [];
    } else currentCell += char;
  }
  if (currentCell.length > 0 || currentRow.length > 0) {
    currentRow.push(currentCell.trim());
    if (currentRow.some(c => c.length > 0)) rows.push(currentRow);
  }

  return parseTabularData(rows, topicsList, collectionsList);
}

export default function BulkPage() {
  const { groupId } = useParams() as { groupId: string };
  const [mode, setMode] = useState<"smart" | "file">("smart");
  const [rawText, setRawText] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [queue, setQueue] = useState<QuizPreview[]>([]);
  const [uploading, setUploading] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; processed?: number; errors?: string[] } | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [notification, setNotification] = useState<{ type: "success" | "info" | "error"; msg: string } | null>(null);
  const [progress, setProgress] = useState<{
    total: number;
    current: number;
    successCount: number;
    failCount: number;
    currentQuestion: string;
    isSending: boolean;
  } | null>(null);
  const abortRef = useRef<boolean>(false);

  const [activeTemplateTab, setActiveTemplateTab] = useState<string>("ar-standard");
  const [showTemplates, setShowTemplates] = useState<boolean>(true);

  const [queueSearch, setQueueSearch] = useState<string>("");
  const [queueFilter, setQueueFilter] = useState<"all" | "valid" | "errors" | "quiz" | "poll">("all");

  const [globalTopicId, setGlobalTopicId] = useState<number | "">("");
  const [globalTopicName, setGlobalTopicName] = useState("");
  const [globalCollectionId, setGlobalCollectionId] = useState("");
  const [globalCollectionName, setGlobalCollectionName] = useState("");
  const [globalAnonymous, setGlobalAnonymous] = useState(true);
  const [globalDuration, setGlobalDuration] = useState(0);
  const [globalAllowMultiple, setGlobalAllowMultiple] = useState(false);
  const [globalTags, setGlobalTags] = useState("");
  const [topics, setTopics] = useState<Topic[]>([]);
  const [collections, setCollections] = useState<Collection[]>([]);

  // Completion Post state
  const [groupTitle, setGroupTitle] = useState("المجموعة");
  const [showCompletionPostModal, setShowCompletionPostModal] = useState(false);
  const [completionPostConfig, setCompletionPostConfig] = useState<CompletionPostConfig>(DEFAULT_COMPLETION_POST_CONFIG);

  useEffect(() => {
    fetch(`/api/groups/${groupId}/topics`).then(r => r.json()).then(d => setTopics(d.topics || [])).catch(() => {});
    fetch("/api/collections").then(r => r.json()).then(d => setCollections(d.collections || [])).catch(() => {});
  }, [groupId]);

  useEffect(() => {
    fetch(`/api/groups/${groupId}`)
      .then(r => r.json())
      .then(d => {
        if (d.group?.title) setGroupTitle(d.group.title);
      })
      .catch(() => {});
  }, [groupId]);

  useEffect(() => {
    try {
      const saved = localStorage.getItem(`qf_completion_post_${groupId}`);
      if (saved) {
        setCompletionPostConfig(JSON.parse(saved));
      }
    } catch {}
  }, [groupId]);

  const handleSaveCompletionPostConfig = (newCfg: CompletionPostConfig) => {
    setCompletionPostConfig(newCfg);
    try {
      localStorage.setItem(`qf_completion_post_${groupId}`, JSON.stringify(newCfg));
    } catch {
      try {
        const fallbackCfg = { ...newCfg, mediaBase64: undefined };
        localStorage.setItem(`qf_completion_post_${groupId}`, JSON.stringify(fallbackCfg));
      } catch {}
    }
  };

  const notify = (type: "success" | "info" | "error", msg: string) => {
    setNotification({ type, msg });
    setTimeout(() => setNotification(null), 3000);
  };

  const handleCopyTemplate = (text: string) => {
    navigator.clipboard.writeText(text);
    notify("success", "📋 تم النسخ بنجاح!");
  };

  const addToQueue = (items: QuizPreview[]) => {
    if (items.length === 0) return;
    setQueue(prev => [...prev, ...items]);
  };

  const handleExtract = () => {
    const items = parseSmartText(rawText, topics, collections);
    if (items.length === 0) { notify("info", "لم يتم العثور على أي أسئلة"); return; }
    addToQueue(items.map(item => ({
      ...item,
      topicId: item.topicId ?? (globalTopicId === "" ? undefined : (globalTopicId as number)),
      topicName: item.topicName ?? (globalTopicName || undefined),
      collectionId: item.collectionId ?? (globalCollectionId || undefined),
      collectionName: item.collectionName ?? (globalCollectionName || undefined),
      collectionIds: item.collectionIds ?? (globalCollectionId ? [globalCollectionId] : undefined),
    })));
    notify("success", `تمت إضافة ${items.length} سؤال إلى القائمة`);
    setRawText("");
  };

  const processFile = async (f: File) => {
    setFile(f);

    try {
      let items: QuizPreview[] = [];
      const fileNameLower = f.name.toLowerCase();

      if (fileNameLower.endsWith(".json")) {
        const text = await f.text();
        const json = JSON.parse(text);
        const raw = Array.isArray(json) ? json : json.quizzes || json.templates || [];
        items = raw.map((item: any) => {
          const type: "quiz" | "poll" = item.correctOptionId !== undefined && item.correctOptionId !== null ? "quiz" : "poll";
          const partial = {
            question: item.question || "",
            options: Array.isArray(item.options) ? item.options : [],
            correctOptionId: item.correctOptionId ?? null,
            explanation: item.explanation || undefined,
            type,
            topicId: item.topicId,
            topicName: item.topicName,
            collectionId: item.collectionId,
            collectionName: item.collectionName,
            collectionIds: item.collectionIds,
            tags: item.tags,
            isAnonymous: item.isAnonymous ?? true,
          };
          return { id: uid(), ...partial, errors: validate(partial) } as QuizPreview;
        });
      } else if (fileNameLower.endsWith(".xlsx") || fileNameLower.endsWith(".xls")) {
        const buffer = await f.arrayBuffer();
        const workbook = XLSX.read(buffer, { type: "array" });
        if (!workbook.SheetNames || workbook.SheetNames.length === 0) {
          throw new Error("الملف فارغ أو لا يحتوي على صفحات عمل.");
        }
        for (const sheetName of workbook.SheetNames) {
          const worksheet = workbook.Sheets[sheetName];
          if (!worksheet) continue;
          const rawRows: any[][] = XLSX.utils.sheet_to_json(worksheet, { header: 1, defval: "" });
          const sheetItems = parseTabularData(rawRows, topics, collections);
          if (sheetItems.length > 0) {
            items.push(...sheetItems);
          }
        }
      } else if (fileNameLower.endsWith(".docx")) {
        const buffer = await f.arrayBuffer();
        const { value: docText } = await mammoth.extractRawText({ arrayBuffer: buffer });
        items = parseSmartText(docText, topics, collections);
      } else if (fileNameLower.endsWith(".csv")) {
        const text = await f.text();
        const workbook = XLSX.read(text, { type: "string" });
        for (const sheetName of workbook.SheetNames) {
          const worksheet = workbook.Sheets[sheetName];
          if (!worksheet) continue;
          const rawRows: any[][] = XLSX.utils.sheet_to_json(worksheet, { header: 1, defval: "" });
          const sheetItems = parseTabularData(rawRows, topics, collections);
          if (sheetItems.length > 0) {
            items.push(...sheetItems);
          }
        }
        if (items.length === 0) {
          items = parseCSV(text, topics, collections);
        }
      } else if (fileNameLower.endsWith(".txt")) {
        const text = await f.text();
        items = parseSmartText(text, topics, collections);
        if (items.length === 0) {
          try {
            const workbook = XLSX.read(text, { type: "string" });
            const sheetName = workbook.SheetNames[0];
            if (sheetName) {
              const worksheet = workbook.Sheets[sheetName];
              const rawRows: any[][] = XLSX.utils.sheet_to_json(worksheet, { header: 1, defval: "" });
              items = parseTabularData(rawRows, topics, collections);
            }
          } catch {}
        }
      } else {
        notify("error", "صيغة الملف غير مدعومة. يرجى اختيار ملف Excel (.xlsx) أو Word (.docx) أو CSV أو TXT أو JSON.");
        setFile(null);
        return;
      }

      if (items.length === 0) {
        notify("info", "لم يتم العثور على أي أسئلة صالحة داخل الملف.");
      } else {
        addToQueue(items.map(item => ({
          ...item,
          topicId: item.topicId ?? (globalTopicId === "" ? undefined : (globalTopicId as number)),
          topicName: item.topicName ?? (globalTopicName || undefined),
          collectionId: item.collectionId ?? (globalCollectionId || undefined),
          collectionName: item.collectionName ?? (globalCollectionName || undefined),
          collectionIds: item.collectionIds ?? (globalCollectionId ? [globalCollectionId] : undefined),
        })));
        notify("success", `تم استخراج ${items.length} سؤال من الملف بنجاح!`);
      }
      setFile(null);
    } catch (err: any) {
      console.error("File parsing error:", err);
      notify("error", `فشل استخراج الأسئلة من الملف: ${err.message || "خطأ غير متوقع"}`);
      setFile(null);
    }
  };

  const handleFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (f) {
      processFile(f);
      e.target.value = "";
    }
  };

  const handleSend = async (action: "send" | "save") => {
    if (queue.length === 0) return;

    if (action === "save") {
      setUploading(true);
      setResult(null);
      try {
        const res = await fetch(`/api/groups/${groupId}/bulk`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            action: "save",
            collectionId: globalCollectionId || undefined,
            collectionIds: globalCollectionId ? [globalCollectionId] : undefined,
            quizzes: queue,
          }),
        });
        const data = await res.json();
        setResult({
          ok: res.ok,
          processed: data.processed,
          errors: data.errors || (!res.ok ? [data.error] : undefined),
        });
        if (res.ok) {
          notify("success", `تم حفظ ${data.processed || queue.length} سؤال في المكتبة بنجاح!`);
          setQueue([]);
        } else {
          notify("error", data.error || "فشل حفظ الأسئلة");
        }
      } catch {
        setResult({ ok: false, errors: ["Network error saving quizzes"] });
        notify("error", "حدث خطأ في الشبكة أثناء الحفظ");
      } finally {
        setUploading(false);
      }
      return;
    }

    // ── Progressive Client-Orchestrated Dispatch for "send" ──
    const validQuizzes = queue.filter((q) => !q.errors?.length);
    if (validQuizzes.length === 0) {
      notify("error", "لا توجد أسئلة صالحة للإرسال. يرجى مراجعة الأخطاء أولاً.");
      return;
    }

    setUploading(true);
    setResult(null);
    abortRef.current = false;

    let successCount = 0;
    let failCount = 0;
    const accumulatedErrors: string[] = [];

    setProgress({
      total: validQuizzes.length,
      current: 0,
      successCount: 0,
      failCount: 0,
      currentQuestion: "",
      isSending: true,
    });

    for (let i = 0; i < validQuizzes.length; i++) {
      if (abortRef.current) {
        accumulatedErrors.push("تم إيقاف الإرسال بواسطة المستخدم / Dispatch cancelled by user");
        break;
      }

      const q = validQuizzes[i];
      setProgress({
        total: validQuizzes.length,
        current: i + 1,
        successCount,
        failCount,
        currentQuestion: q.question.slice(0, 50),
        isSending: true,
      });

      try {
        let res = await fetch(`/api/groups/${groupId}/bulk`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            action: "send",
            collectionId: globalCollectionId || undefined,
            collectionIds: globalCollectionId ? [globalCollectionId] : undefined,
            quizzes: [q],
          }),
        });
        let data = await res.json();

        // Handle Telegram 429 Rate Limiting with intelligent backoff
        if (!res.ok || (data.errors && data.errors.length > 0)) {
          const rawErr = String(data.errors?.[0] || data.error || "");
          if (rawErr.includes("429") || rawErr.toLowerCase().includes("too many requests") || rawErr.toLowerCase().includes("retry after")) {
            const retryMatch = rawErr.match(/retry after (\d+)/i);
            const waitSec = retryMatch ? Math.min(10, Math.max(2, parseInt(retryMatch[1], 10))) : 4;
            await new Promise((r) => setTimeout(r, waitSec * 1000));

            if (!abortRef.current) {
              res = await fetch(`/api/groups/${groupId}/bulk`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                  action: "send",
                  collectionId: globalCollectionId || undefined,
                  collectionIds: globalCollectionId ? [globalCollectionId] : undefined,
                  quizzes: [q],
                }),
              });
              data = await res.json();
            }
          }
        }

        if (res.ok && data.processed > 0) {
          successCount++;
          // Remove from local queue so sent items don't linger
          setQueue((prev) => prev.filter((item) => item.id !== q.id));
        } else {
          failCount++;
          const errDesc = data.errors?.[0] || data.error || `فشل إرسال السؤال #${i + 1}`;
          accumulatedErrors.push(`سؤال "${q.question.slice(0, 30)}...": ${errDesc}`);
        }
      } catch {
        failCount++;
        accumulatedErrors.push(`سؤال "${q.question.slice(0, 30)}...": خطأ في الاتصال بالشبكة`);
      }

      // Safe throttle pause between quizzes (750ms) to respect Telegram API rate limits
      if (i < validQuizzes.length - 1 && !abortRef.current) {
        await new Promise((r) => setTimeout(r, 750));
      }
    }

    setProgress(null);
    setUploading(false);

    setResult({
      ok: failCount === 0 && successCount > 0,
      processed: successCount,
      errors: accumulatedErrors.length > 0 ? accumulatedErrors : undefined,
    });

    if (successCount > 0 && failCount === 0) {
      notify("success", `🚀 تم إرسال جميع الأسئلة (${successCount}) بنجاح إلى تيليجرام!`);
    } else if (successCount > 0) {
      notify("info", `تم إرسال ${successCount} سؤال بنجاح، مع تعذر إرسال ${failCount} سؤال.`);
    } else {
      notify("error", "فشل إرسال الأسئلة إلى تيليجرام.");
    }

    // ── Automatic Completion Post (بوست الختام) ───────────────────
    if (!abortRef.current && completionPostConfig.enabled && successCount > 0) {
      try {
        const targetTopicId = completionPostConfig.useCustomTopic
          ? (completionPostConfig.topicId || undefined)
          : (globalTopicId || undefined);

        const now = new Date();
        const dateFormatted = now.toLocaleDateString("ar-EG", {
          year: "numeric",
          month: "long",
          day: "numeric",
        });
        const timeFormatted = now.toLocaleTimeString("ar-EG", {
          hour: "2-digit",
          minute: "2-digit",
        });

        const postPayload = {
          text: completionPostConfig.text,
          parseMode: completionPostConfig.parseMode,
          topicId: targetTopicId,
          mediaUrl: completionPostConfig.attachMedia && completionPostConfig.mediaType === "url" ? completionPostConfig.mediaUrl : undefined,
          mediaBase64: completionPostConfig.attachMedia && completionPostConfig.mediaType === "file" ? completionPostConfig.mediaBase64 : undefined,
          mediaMimeType: completionPostConfig.attachMedia && completionPostConfig.mediaType === "file" ? completionPostConfig.mediaMimeType : undefined,
          buttons: completionPostConfig.buttonRows.map(r => r.map(b => ({ text: b.text, url: b.url }))),
          pinMessage: completionPostConfig.pinMessage,
          disableNotification: completionPostConfig.disableNotification,
          variables: {
            count: successCount,
            successCount: successCount,
            total: validQuizzes.length,
            failedCount: validQuizzes.length - successCount,
            groupTitle: groupTitle,
            title: groupTitle,
            date: dateFormatted,
            time: timeFormatted,
          },
        };

        const postRes = await fetch(`/api/groups/${groupId}/messages/send`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(postPayload),
        });
        const postData = await postRes.json();
        if (postRes.ok) {
          notify(
            "success",
            `تم إرسال بوست الختام بنجاح! ${
              postData.pinned
                ? "📌 وتم تثبيته."
                : postData.pinError
                ? "⚠️ (لم يتم التثبيت: البوت لا يملك صلاحية التثبيت)"
                : ""
            }`
          );
        } else {
          notify("error", `فشل إرسال بوست الختام: ${postData.error || "خطأ غير معروف"}`);
        }
      } catch {
        notify("error", "حدث خطأ في الشبكة أثناء إرسال بوست الختام");
      }
    }
  };

  const filteredQueue = useMemo(() => queue.filter(item => {
    if (queueFilter === "valid" && item.errors?.length) return false;
    if (queueFilter === "errors" && !item.errors?.length) return false;
    if (queueFilter === "quiz" && item.type !== "quiz") return false;
    if (queueFilter === "poll" && item.type !== "poll") return false;
    if (queueSearch.trim()) {
      const q = queueSearch.trim().toLowerCase();
      return item.question?.toLowerCase().includes(q) || item.options?.some(o => o.toLowerCase().includes(q)) || item.explanation?.toLowerCase().includes(q) || item.topicName?.toLowerCase().includes(q) || item.tags?.some(t => t.toLowerCase().includes(q));
    }
    return true;
  }), [queue, queueFilter, queueSearch]);

  const updateItem = (id: string, updates: Partial<QuizPreview>) => setQueue(prev => prev.map(p => p.id === id ? { ...p, ...updates, errors: validate({ ...p, ...updates }) } : p));
  const deleteItem = (id: string) => setQueue(prev => prev.filter(p => p.id !== id));

  return (
    <div dir="auto" className="mx-auto max-w-6xl pb-24" style={{ display: "flex", flexDirection: "column", gap: "2rem" }}>
      <AnimatePresence>
        {notification && (
          <motion.div initial={{ opacity: 0, y: -20 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -20 }}
            style={{ position: "fixed", top: 80, right: 24, zIndex: 1000, padding: "12px 20px", borderRadius: "12px", background: notification.type === "success" ? "#10B981" : notification.type === "error" ? "#EF4444" : "#3B82F6", color: "white", display: "flex", alignItems: "center", gap: "8px", boxShadow: "0 10px 15px -3px rgba(0, 0, 0, 0.1)" }}>
            {notification.type === "success" ? <CheckCircle2 size={20} /> : <AlertCircle size={20} />}
            <span style={{ fontWeight: 600, fontSize: "0.95rem" }}>{notification.msg}</span>
          </motion.div>
        )}
      </AnimatePresence>

      <div style={{ display: "flex", flexWrap: "wrap", justifyContent: "space-between", alignItems: "flex-end", gap: "1rem" }}>
        <div>
          <h1 style={{ fontSize: "2rem", fontWeight: 800, margin: "0 0 0.5rem 0", display: "flex", alignItems: "center", gap: "10px" }}>
            <Sparkles className="text-primary" /> Smart Import
          </h1>
          <p style={{ color: "var(--clr-text-muted)", margin: 0, fontSize: "0.95rem" }}>Paste, extract, configure topics, and mass-deploy quizzes effortlessly.</p>
        </div>
        <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap", alignItems: "center" }}>
          <button
            type="button"
            onClick={() => setShowCompletionPostModal(true)}
            className="btn btn-ghost"
            style={{
              border: completionPostConfig.enabled ? "1px solid var(--clr-brand)" : "1px solid var(--clr-border)",
              color: completionPostConfig.enabled ? "var(--clr-brand)" : "var(--clr-text-secondary)",
              background: completionPostConfig.enabled ? "var(--clr-brand-muted)" : "transparent",
              display: "flex",
              alignItems: "center",
              gap: 6,
              fontSize: "0.85rem",
            }}
            title="إعداد وتخصيص بوست الختام التلقائي بعد إرسال الدفعة"
          >
            <span>📢 بوست الختام</span>
            <span style={{ fontWeight: 700, color: completionPostConfig.enabled ? "var(--clr-success)" : "var(--clr-text-muted)" }}>
              {completionPostConfig.enabled ? "✓ مفعّل" : "معطّل"}
            </span>
          </button>
          <Link href={`/dashboard/${groupId}/library`} className="btn btn-ghost"><LayoutList size={16} /> Library</Link>
          <Link href={`/dashboard/${groupId}/quiz/new`} className="btn btn-ghost"><PlusCircle size={16} /> New Quiz</Link>
        </div>
      </div>

      <div className="card" style={{ padding: "1.5rem", border: "1px solid var(--clr-border)", borderRadius: "16px", background: "var(--clr-bg-surface)" }}>
        <div style={{ display: "flex", gap: "1rem", marginBottom: "1.5rem", borderBottom: "1px solid var(--clr-border)", paddingBottom: "1rem" }}>
          <button onClick={() => setMode("smart")} className={`btn ${mode === "smart" ? "btn-primary" : "btn-ghost"}`} style={{ display: "flex", alignItems: "center", gap: "8px" }}><FileText size={18} /> Smart Paste</button>
          <button onClick={() => setMode("file")} className={`btn ${mode === "file" ? "btn-primary" : "btn-ghost"}`} style={{ display: "flex", alignItems: "center", gap: "8px" }}><UploadCloud size={18} /> File Upload</button>
        </div>

        {mode === "smart" && (
          <div style={{ display: "flex", flexDirection: "column", gap: "1.5rem" }}>
            <div style={{ border: "1px solid var(--clr-border)", borderRadius: "12px", overflow: "hidden" }}>
              <div onClick={() => setShowTemplates(!showTemplates)} style={{ padding: "12px 16px", background: "rgba(0,0,0,0.03)", display: "flex", justifyContent: "space-between", cursor: "pointer", alignItems: "center" }}>
                <span style={{ fontWeight: 600, display: "flex", alignItems: "center", gap: "8px" }}><LayoutList size={18} /> قوالب ذكية للنسخ</span>
                {showTemplates ? <ChevronUp size={18} /> : <ChevronDown size={18} />}
              </div>
              <AnimatePresence>
                {showTemplates && (
                  <motion.div initial={{ height: 0 }} animate={{ height: "auto" }} exit={{ height: 0 }} style={{ overflow: "hidden" }}>
                    <div style={{ padding: "16px" }}>
                      <div style={{ display: "flex", gap: "8px", flexWrap: "wrap", marginBottom: "1rem" }}>
                        {TEMPLATES.map(t => (
                          <button key={t.id} onClick={() => setActiveTemplateTab(t.id)} className={`btn btn-sm ${activeTemplateTab === t.id ? "btn-secondary" : "btn-ghost"}`}>{t.title}</button>
                        ))}
                      </div>
                      {(() => {
                        const t = TEMPLATES.find(x => x.id === activeTemplateTab)!;
                        return (
                          <div style={{ background: "var(--clr-bg-elevated)", padding: "1rem", borderRadius: "8px", border: "1px solid var(--clr-border)" }}>
                            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "1rem", flexWrap: "wrap", gap: "8px" }}>
                              <p style={{ fontSize: "0.85rem", color: "var(--clr-text-muted)", margin: 0 }}>{t.description}</p>
                              <div style={{ display: "flex", gap: "8px" }}>
                                <button onClick={() => setRawText(t.sample)} className="btn btn-ghost btn-sm">تطبيق بالصندوق</button>
                                <button onClick={() => handleCopyTemplate(t.sample)} className="btn btn-primary btn-sm"><Copy size={14} /> نسخ</button>
                              </div>
                            </div>
                            <pre style={{ margin: 0, fontSize: "0.85rem", fontFamily: "monospace", whiteSpace: "pre-wrap", color: "var(--clr-text-primary)" }}>{t.sample}</pre>
                          </div>
                        );
                      })()}
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
            
            <textarea className="input" style={{ minHeight: "200px", fontFamily: "monospace", fontSize: "0.9rem", resize: "vertical", padding: "1rem" }} placeholder="انسخ والصق أسئلتك هنا..." value={rawText} onChange={e => setRawText(e.target.value)} />
            <button className="btn btn-primary" style={{ width: "100%", padding: "0.8rem", fontSize: "1rem" }} onClick={handleExtract}><Sparkles size={20} /> استخراج الأسئلة</button>
          </div>
        )}
        
        {mode === "file" && (
          <div
            onDragOver={(e) => {
              e.preventDefault();
              e.stopPropagation();
              setIsDragging(true);
            }}
            onDragEnter={(e) => {
              e.preventDefault();
              e.stopPropagation();
              setIsDragging(true);
            }}
            onDragLeave={(e) => {
              e.preventDefault();
              e.stopPropagation();
              setIsDragging(false);
            }}
            onDrop={(e) => {
              e.preventDefault();
              e.stopPropagation();
              setIsDragging(false);
              const droppedFiles = e.dataTransfer.files;
              if (droppedFiles && droppedFiles.length > 0) {
                processFile(droppedFiles[0]);
              }
            }}
            style={{
              padding: "2.5rem 1.5rem",
              border: isDragging ? "2px dashed var(--clr-brand)" : "2px dashed var(--clr-border)",
              borderRadius: "14px",
              textAlign: "center",
              background: isDragging ? "rgba(99, 102, 241, 0.12)" : "rgba(99, 102, 241, 0.03)",
              boxShadow: isDragging ? "0 0 24px rgba(99, 102, 241, 0.25)" : "none",
              transition: "all 0.2s ease",
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              justifyContent: "center",
              gap: "1rem",
            }}
          >
            <div
              style={{
                width: 60,
                height: 60,
                borderRadius: "50%",
                background: "var(--clr-brand-muted)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                color: "var(--clr-brand)",
                transform: isDragging ? "scale(1.1)" : "scale(1)",
                transition: "transform 0.2s ease",
              }}
            >
              <UploadCloud size={30} />
            </div>

            <div>
              <h3 style={{ margin: "0 0 6px 0", fontSize: "1.15rem" }}>
                رفع واستيراد ملف الأسئلة • Smart File Upload
              </h3>
              <p style={{ margin: 0, color: "var(--clr-text-secondary)", fontSize: "0.88rem", maxWidth: 540 }}>
                يدعم جداول Excel وملفات CSV ومستندات Word والنصوص المهيكلة مع السحب والإفلات والكشف التلقائي عن الأعمدة والخيارات والإجابات الصحيحة.
              </p>
            </div>

            {/* Supported file type badges */}
            <div style={{ display: "flex", gap: "8px", flexWrap: "wrap", justifyContent: "center" }}>
              <span className="badge badge-brand" style={{ fontSize: "0.78rem", padding: "4px 10px" }}>
                📊 Excel (.xlsx, .xls)
              </span>
              <span className="badge badge-accent" style={{ fontSize: "0.78rem", padding: "4px 10px" }}>
                📄 CSV (.csv)
              </span>
              <span className="badge badge-brand" style={{ fontSize: "0.78rem", padding: "4px 10px", background: "rgba(59, 130, 246, 0.12)", color: "#3b82f6", borderColor: "rgba(59, 130, 246, 0.3)" }}>
                📘 Word (.docx)
              </span>
              <span className="badge badge-muted" style={{ fontSize: "0.78rem", padding: "4px 10px" }}>
                📝 Text (.txt)
              </span>
              <span className="badge badge-muted" style={{ fontSize: "0.78rem", padding: "4px 10px" }}>
                📦 JSON (.json)
              </span>
            </div>

            <input
              type="file"
              accept=".csv,.xlsx,.xls,.docx,.txt,.json"
              onChange={handleFile}
              style={{ display: "none" }}
              id="bulk-upload"
            />
            <label
              htmlFor="bulk-upload"
              className="btn btn-primary"
              style={{ cursor: "pointer", display: "inline-flex", alignItems: "center", gap: 8, padding: "8px 22px" }}
            >
              <UploadCloud size={18} />
              <span>اختر ملف من جهازك / Select File</span>
            </label>

            <p style={{ margin: 0, color: "var(--clr-text-muted)", fontSize: "0.82rem" }}>
              {isDragging
                ? "📂 أفلت الملف الآن ليتم تحليله واستيراده فوراً!"
                : file
                ? `✓ جاري قراءة الملف: ${file.name}`
                : "يمكنك سحب وإفلات الملف هنا مباشرة أو النقر على الزر أعلاه"}
            </p>
          </div>
        )}
      </div>

      {queue.length > 0 && (
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="card" style={{ padding: "1.5rem", border: "1px solid var(--clr-border)", borderRadius: "16px", background: "var(--clr-bg-surface)" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1rem" }}>
            <h3 style={{ margin: 0, display: "flex", alignItems: "center", gap: "8px" }}><Settings2 size={20} /> Global Settings</h3>
            <button className="btn btn-secondary btn-sm" onClick={() => {
              const tags = globalTags.split(",").map(t => t.trim()).filter(Boolean);
              setQueue(prev => prev.map(p => ({
                ...p, topicId: globalTopicId === "" ? undefined : (globalTopicId as number), topicName: globalTopicName || undefined, collectionId: globalCollectionId || undefined, collectionName: globalCollectionName || undefined, collectionIds: globalCollectionId ? [globalCollectionId] : undefined, isAnonymous: globalAnonymous, openPeriod: globalDuration > 0 ? globalDuration : undefined, allowsMultiple: p.type === "poll" ? globalAllowMultiple : false, tags: tags.length > 0 ? tags : undefined
              })));
              notify("success", "Applied to all items");
            }}>⚡ Apply to All</button>
          </div>
          
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: "1rem" }}>
            <div>
              <label className="input-label">Topic</label>
              <select className="select" value={globalTopicId} onChange={e => { setGlobalTopicId(e.target.value ? Number(e.target.value) : ""); setGlobalTopicName(topics.find(t => t.message_thread_id === Number(e.target.value))?.name || ""); }}>
                <option value="">📌 General</option>
                {topics.map(t => <option key={t.message_thread_id} value={t.message_thread_id}>📂 {t.name}</option>)}
              </select>
            </div>
            <div>
              <label className="input-label">Category</label>
              <select className="select" value={globalCollectionId} onChange={e => { setGlobalCollectionId(e.target.value); setGlobalCollectionName(collections.find(c => c.id === e.target.value)?.name || ""); }}>
                <option value="">📂 None</option>
                {collections.map(c => <option key={c.id} value={c.id}>{c.emoji} {c.name}</option>)}
              </select>
            </div>
            <div>
              <label className="input-label">Tags</label>
              <input className="input" value={globalTags} onChange={e => setGlobalTags(e.target.value)} placeholder="comma separated" />
            </div>
            <div>
              <label className="input-label">Duration (sec)</label>
              <input type="number" className="input" value={globalDuration} min={0} onChange={e => setGlobalDuration(Number(e.target.value))} />
            </div>
          </div>
        </motion.div>
      )}

      {/* Result Summary Banner (shown even if queue becomes empty) */}
      {result && (
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          style={{
            padding: "1.2rem 1.5rem",
            borderRadius: "14px",
            background: result.ok ? "rgba(16, 185, 129, 0.08)" : "rgba(239, 68, 68, 0.08)",
            border: `1px solid ${result.ok ? "var(--clr-success)" : "var(--clr-danger)"}`,
            display: "flex",
            justifyContent: "space-between",
            alignItems: "flex-start",
            flexWrap: "wrap",
            gap: "12px",
          }}
        >
          <div>
            <div style={{ fontWeight: 700, fontSize: "1rem", color: result.ok ? "var(--clr-success)" : "var(--clr-danger)" }}>
              {result.ok ? `✅ اكتملت العملية بنجاح! تم معالجة ${result.processed || 0} سؤال.` : `⚠️ اكتملت العملية مع وجود تنبيهات:`}
            </div>
            {result.errors && result.errors.length > 0 && (
              <ul style={{ margin: "8px 0 0 0", paddingInlineStart: "20px", fontSize: "0.84rem", color: "var(--clr-text-secondary)" }}>
                {result.errors.map((err, i) => (
                  <li key={i}>{err}</li>
                ))}
              </ul>
            )}
          </div>
          <button className="btn btn-ghost btn-sm" onClick={() => setResult(null)}>✕ إغلاق</button>
        </motion.div>
      )}

      {/* Live Progressive Dispatch Progress Indicator (rendered independently of queue state) */}
      {progress && progress.isSending && (
        <motion.div
          initial={{ opacity: 0, scale: 0.98 }}
          animate={{ opacity: 1, scale: 1 }}
          style={{
            padding: "1.25rem",
            borderRadius: "14px",
            background: "linear-gradient(135deg, rgba(79, 127, 255, 0.12), rgba(124, 58, 237, 0.12))",
            border: "1px solid var(--clr-brand)",
            marginBottom: "1.25rem",
            boxShadow: "0 8px 24px rgba(0,0,0,0.15)",
          }}
        >
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "8px", flexWrap: "wrap", gap: "8px" }}>
            <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
              <span style={{ fontSize: "1.4rem" }}>🚀</span>
              <div>
                <div style={{ fontWeight: 700, fontSize: "1rem" }}>
                  جاري إرسال الأسئلة تدريجياً إلى تيليجرام... ({progress.current} / {progress.total})
                </div>
                <div style={{ fontSize: "0.8rem", color: "var(--clr-text-muted)", marginTop: "2px" }}>
                  {progress.currentQuestion ? `السؤال الحالي: "${progress.currentQuestion}..."` : "بدء الإرسال..."}
                </div>
              </div>
            </div>
            <div style={{ display: "flex", gap: "12px", alignItems: "center" }}>
              <span style={{ fontSize: "0.85rem", color: "var(--clr-success)", fontWeight: 600 }}>
                ✓ {progress.successCount} تم إرساله
              </span>
              {progress.failCount > 0 && (
                <span style={{ fontSize: "0.85rem", color: "var(--clr-danger)", fontWeight: 600 }}>
                  ✗ {progress.failCount} تعذر إرساله
                </span>
              )}
              <button
                className="btn btn-ghost btn-sm"
                style={{ color: "var(--clr-danger)", border: "1px solid rgba(239, 68, 68, 0.3)" }}
                onClick={() => { abortRef.current = true; }}
              >
                🛑 إيقاف الإرسال
              </button>
            </div>
          </div>

          {/* Progress Bar Track & Fill */}
          <div style={{ height: "8px", borderRadius: "999px", background: "rgba(255,255,255,0.1)", overflow: "hidden", marginTop: "10px" }}>
            <div
              style={{
                height: "100%",
                borderRadius: "999px",
                background: "linear-gradient(90deg, var(--clr-brand) 0%, #a855f7 100%)",
                width: `${Math.round((progress.current / Math.max(1, progress.total)) * 100)}%`,
                transition: "width 0.3s ease",
              }}
            />
          </div>
          <div style={{ display: "flex", justifyContent: "space-between", fontSize: "0.75rem", color: "var(--clr-text-muted)", marginTop: "4px" }}>
            <span>النسبة: {Math.round((progress.current / Math.max(1, progress.total)) * 100)}%</span>
            <span>متبقي: {Math.max(0, progress.total - progress.current)}</span>
          </div>
        </motion.div>
      )}

      {(queue.length > 0 || uploading) && (
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="card" style={{ padding: "1.5rem", border: "1px solid var(--clr-brand)", borderRadius: "16px", background: "var(--clr-bg-surface)" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1rem", flexWrap: "wrap", gap: "1rem" }}>
            <div>
              <h3 style={{ margin: 0, fontSize: "1.4rem" }}>Queue <span style={{ opacity: 0.5, fontSize: "1rem" }}>({queue.length} items)</span></h3>
              <p style={{ margin: "4px 0 0 0", fontSize: "0.85rem", color: queue.some(q => q.errors?.length) ? "var(--clr-danger)" : "var(--clr-success)" }}>
                {queue.filter(q => !q.errors?.length).length} valid • {queue.filter(q => q.errors?.length).length} errors
              </p>
            </div>
            <div style={{ display: "flex", gap: "0.5rem", alignItems: "center", flexWrap: "wrap" }}>
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                style={{
                  border: completionPostConfig.enabled ? "1px solid var(--clr-brand)" : "1px solid var(--clr-border)",
                  color: completionPostConfig.enabled ? "var(--clr-brand)" : "var(--clr-text-secondary)",
                  background: completionPostConfig.enabled ? "var(--clr-brand-muted)" : "transparent",
                  display: "flex",
                  alignItems: "center",
                  gap: 6,
                }}
                onClick={() => setShowCompletionPostModal(true)}
                title="تخصيص بوست الختام التلقائي بعد إرسال الكويزات"
              >
                <span>📢 بوست الختام:</span>
                <span style={{ fontWeight: 700, color: completionPostConfig.enabled ? "var(--clr-success)" : "var(--clr-text-muted)" }}>
                  {completionPostConfig.enabled ? "مفعّل ✓" : "معطّل"}
                </span>
              </button>
              <button className="btn btn-ghost" style={{ color: "var(--clr-danger)" }} onClick={() => setQueue([])}>Clear</button>
              <button className="btn btn-secondary" onClick={() => handleSend("save")} disabled={uploading}>📁 Save</button>
              <button className="btn btn-primary" onClick={() => handleSend("send")} disabled={uploading || queue.filter(q => !q.errors?.length).length === 0}>
                {uploading && progress ? `🚀 جارٍ الإرسال (${progress.current}/${progress.total})` : `🚀 Send (${queue.filter(q => !q.errors?.length).length})`}
              </button>
            </div>
          </div>
          
          <div style={{ display: "flex", gap: "1rem", flexWrap: "wrap", marginBottom: "1rem", borderBottom: "1px solid var(--clr-border)", paddingBottom: "1rem" }}>
             <input type="text" className="input" style={{ flex: 1, minWidth: "200px" }} placeholder="Search queue..." value={queueSearch} onChange={e => setQueueSearch(e.target.value)} />
             <div style={{ display: "flex", gap: "0.5rem", overflowX: "auto", paddingBottom: "4px" }}>
               {["all", "valid", "errors", "quiz", "poll"].map(f => (
                 <button key={f} className={`btn btn-sm ${queueFilter === f ? "btn-primary" : "btn-ghost"}`} onClick={() => setQueueFilter(f as any)}>{f.toUpperCase()}</button>
               ))}
             </div>
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: "1rem", maxHeight: "600px", overflowY: "auto", paddingRight: "8px" }}>
            {filteredQueue.map((p, idx) => {
              const isEditing = editingId === p.id;
              const hasErr = p.errors && p.errors.length > 0;
              return (
                <div key={p.id} style={{ border: `1px solid ${hasErr ? "var(--clr-danger)" : "var(--clr-border)"}`, borderRadius: "12px", background: "var(--clr-bg-elevated)", padding: "1rem" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: "1rem" }}>
                    <div style={{ flex: 1 }}>
                      <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "8px", flexWrap: "wrap" }}>
                        <span className={`badge ${p.type === "quiz" ? "badge-brand" : "badge-accent"}`}>{p.type.toUpperCase()}</span>
                        <span style={{ fontSize: "0.8rem", color: "var(--clr-text-muted)" }}>#{idx + 1}</span>
                        {p.topicName && <span className="badge badge-muted">📍 {p.topicName}</span>}
                        {p.collectionName && <span className="badge badge-muted">📁 {p.collectionName}</span>}
                      </div>
                      <div style={{ fontWeight: 600, fontSize: "1rem", marginBottom: "8px", whiteSpace: "pre-wrap" }}>{p.question || "Untitled Question"}</div>
                      {!isEditing && p.options.map((opt, i) => (
                        <div key={i} style={{ display: "flex", alignItems: "center", gap: "8px", fontSize: "0.9rem", color: p.correctOptionId === i ? "var(--clr-success)" : "var(--clr-text-primary)", marginBottom: "4px" }}>
                          {p.correctOptionId === i ? <CheckCircle2 size={16} /> : <div style={{ width: 16, height: 16, borderRadius: "50%", border: "1px solid var(--clr-border)" }} />}
                          {opt}
                        </div>
                      ))}
                      {hasErr && <div style={{ marginTop: "8px", fontSize: "0.85rem", color: "var(--clr-danger)" }}>{p.errors?.join(" • ")}</div>}
                    </div>
                    <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
                      <button className="btn btn-ghost btn-sm" onClick={() => setEditingId(isEditing ? null : p.id)}>{isEditing ? "Done" : "Edit"}</button>
                      <button className="btn btn-ghost btn-sm" style={{ color: "var(--clr-danger)" }} onClick={() => deleteItem(p.id)}><Trash2 size={16} /></button>
                    </div>
                  </div>
                  
                  {isEditing && (
                    <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} style={{ marginTop: "1rem", paddingTop: "1rem", borderTop: "1px solid var(--clr-border)", display: "flex", flexDirection: "column", gap: "1rem" }}>
                      <textarea className="input" rows={2} value={p.question} onChange={e => updateItem(p.id, { question: e.target.value })} placeholder="Question text" />
                      <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
                        {p.options.map((opt, oIdx) => (
                          <div key={oIdx} style={{ display: "flex", gap: "8px", alignItems: "center" }}>
                            {p.type === "quiz" && <input type="radio" checked={p.correctOptionId === oIdx} onChange={() => updateItem(p.id, { correctOptionId: oIdx })} style={{ width: "1.2rem", height: "1.2rem" }} />}
                            <input className="input" value={opt} onChange={e => { const opts = [...p.options]; opts[oIdx] = e.target.value; updateItem(p.id, { options: opts }); }} style={{ flex: 1 }} />
                            <button className="btn btn-ghost btn-sm text-danger" onClick={() => updateItem(p.id, { options: p.options.filter((_, i) => i !== oIdx) })}>✕</button>
                          </div>
                        ))}
                        {p.options.length < 10 && <button className="btn btn-secondary btn-sm" style={{ alignSelf: "flex-start" }} onClick={() => updateItem(p.id, { options: [...p.options, ""] })}>+ Add Option</button>}
                      </div>
                      {p.type === "quiz" && <input className="input" value={p.explanation || ""} onChange={e => updateItem(p.id, { explanation: e.target.value })} placeholder="Explanation (optional)" />}
                    </motion.div>
                  )}
                </div>
              );
            })}
          </div>
        </motion.div>
      )}

      <CompletionPostModal
        isOpen={showCompletionPostModal}
        onClose={() => setShowCompletionPostModal(false)}
        groupId={groupId}
        groupTitle={groupTitle}
        topics={topics}
        selectedTopicId={globalTopicId}
        selectedCount={queue.filter(q => !q.errors?.length).length}
        config={completionPostConfig}
        onSaveConfig={handleSaveCompletionPostConfig}
        showToast={(type, msg) => notify(type, msg)}
      />
    </div>
  );
}
