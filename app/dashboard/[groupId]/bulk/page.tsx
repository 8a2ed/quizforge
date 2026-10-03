"use client";

import { useState, useEffect, useMemo } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { motion, AnimatePresence } from "framer-motion";
import { 
  FileText, UploadCloud, LayoutList, CheckCircle2, 
  Settings2, Copy, AlertCircle, Trash2, Sparkles,
  PlusCircle, ChevronDown, ChevronUp
} from "lucide-react";

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
  const str = String(raw).trim().replace(/^["'\[\(\]\)]+|["'\[\(\]\)]+$/g, "").trim();
  if (!str) return null;

  const easternDigits: Record<string, number> = { "١": 0, "٢": 1, "٣": 2, "٤": 3, "٥": 4, "٦": 5, "٧": 6, "٨": 7, "٩": 8, "١٠": 9 };
  if (str in easternDigits && easternDigits[str] < options.length) return easternDigits[str];

  const arabicAbjadi = ["أ", "ب", "ج", "د", "هـ", "و", "ز", "ح", "ط", "ي"];
  const arabicHijai = ["أ", "ب", "ت", "ث", "ج", "ح", "خ", "د", "ذ", "ر"];
  const normalizedChar = str.replace(/^[إآا]/, "أ");

  let idx = arabicAbjadi.indexOf(normalizedChar);
  if (idx !== -1 && idx < options.length) return idx;
  idx = arabicHijai.indexOf(normalizedChar);
  if (idx !== -1 && idx < options.length) return idx;

  if (/^[a-jA-J]$/.test(str)) {
    const eIdx = str.toUpperCase().charCodeAt(0) - 65;
    if (eIdx < options.length) return eIdx;
  }

  const cleanStr = str.toLowerCase();
  let matchIdx = options.findIndex(o => o.trim().toLowerCase() === cleanStr);
  if (matchIdx !== -1) return matchIdx;

  matchIdx = options.findIndex(o => {
    const optClean = o.trim().toLowerCase();
    return optClean.startsWith(cleanStr) || cleanStr.startsWith(optClean);
  });
  if (matchIdx !== -1) return matchIdx;

  const n = Number(str);
  if (!isNaN(n) && Number.isInteger(n)) {
    if (n >= 1 && n <= options.length) return n - 1;
    if (n >= 0 && n < options.length) return n;
  }
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

function parseCSV(text: string): QuizPreview[] {
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

  if (rows.length < 2) return [];
  const items: QuizPreview[] = [];
  for (let i = 1; i < rows.length; i++) {
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
        options = testOpts; correctOptionId = resolved;
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
        options = candidateOptions; correctOptionId = resolvedOpt;
        explanation = cols.slice(foundCol + 1).join(" ").replace(/^"|"$/g, "").trim() || undefined;
      } else options = cols.slice(1).map(o => o?.replace(/^"|"$/g, "").trim()).filter(Boolean);
    }

    const partial = { question, options, correctOptionId, explanation: explanation || undefined, type: correctOptionId !== null ? "quiz" as const : "poll" as const };
    items.push({ id: uid(), ...partial, errors: validate(partial) });
  }
  return items;
}

export default function BulkPage() {
  const { groupId } = useParams() as { groupId: string };
  const [mode, setMode] = useState<"smart" | "file">("smart");
  const [rawText, setRawText] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [queue, setQueue] = useState<QuizPreview[]>([]);
  const [uploading, setUploading] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; processed?: number; errors?: string[] } | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [notification, setNotification] = useState<{ type: "success" | "info" | "error"; msg: string } | null>(null);

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

  useEffect(() => {
    fetch(`/api/groups/${groupId}/topics`).then(r => r.json()).then(d => setTopics(d.topics || [])).catch(() => {});
    fetch("/api/collections").then(r => r.json()).then(d => setCollections(d.collections || [])).catch(() => {});
  }, [groupId]);

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
    notify("success", `تمت إضافة ${items.length} سؤال`);
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
    setRawText("");
  };

  const handleFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (!f) return;
    setFile(f);
    const text = await f.text();
    try {
      let items: QuizPreview[];
      if (f.name.endsWith(".json")) {
        const json = JSON.parse(text);
        const raw = Array.isArray(json) ? json : json.quizzes || [];
        items = raw.map((item: QuizPreview) => {
          const type = item.correctOptionId !== undefined && item.correctOptionId !== null ? "quiz" : "poll";
          return { ...item, id: uid(), type, errors: validate({ ...item, type }) };
        });
      } else { items = parseCSV(text); }
      addToQueue(items);
      e.target.value = ""; setFile(null);
    } catch { notify("error", "Failed to parse file."); }
  };

  const handleSend = async (action: "send" | "save") => {
    if (queue.length === 0) return;
    setUploading(true); setResult(null);
    try {
      const res = await fetch(`/api/groups/${groupId}/bulk`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, collectionId: globalCollectionId || undefined, collectionIds: globalCollectionId ? [globalCollectionId] : undefined, quizzes: queue })
      });
      const data = await res.json();
      setResult({ ok: res.ok, processed: data.processed, errors: data.errors || (!res.ok ? [data.error] : undefined) });
      if (res.ok) setQueue([]);
    } catch { setResult({ ok: false, errors: ["Network error"] }); }
    finally { setUploading(false); }
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
        <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
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
          <div style={{ padding: "3rem", border: "2px dashed var(--clr-border)", borderRadius: "12px", textAlign: "center" }}>
            <UploadCloud size={48} style={{ color: "var(--clr-text-muted)", margin: "0 auto 1rem" }} />
            <input type="file" accept=".csv,.json,.txt" onChange={handleFile} style={{ display: "none" }} id="bulk-upload" />
            <label htmlFor="bulk-upload" className="btn btn-primary" style={{ cursor: "pointer", display: "inline-flex" }}>Select File</label>
            <p style={{ marginTop: "1rem", color: "var(--clr-text-muted)", fontSize: "0.9rem" }}>{file ? `✓ ${file.name}` : "CSV, JSON, or TXT (Appends to existing queue)"}</p>
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

      {queue.length > 0 && (
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="card" style={{ padding: "1.5rem", border: "1px solid var(--clr-brand)", borderRadius: "16px", background: "var(--clr-bg-surface)" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1rem", flexWrap: "wrap", gap: "1rem" }}>
            <div>
              <h3 style={{ margin: 0, fontSize: "1.4rem" }}>Queue <span style={{ opacity: 0.5, fontSize: "1rem" }}>({queue.length} items)</span></h3>
              <p style={{ margin: "4px 0 0 0", fontSize: "0.85rem", color: queue.some(q => q.errors?.length) ? "var(--clr-danger)" : "var(--clr-success)" }}>
                {queue.filter(q => !q.errors?.length).length} valid • {queue.filter(q => q.errors?.length).length} errors
              </p>
            </div>
            <div style={{ display: "flex", gap: "0.5rem" }}>
              <button className="btn btn-ghost" style={{ color: "var(--clr-danger)" }} onClick={() => setQueue([])}>Clear</button>
              <button className="btn btn-secondary" onClick={() => handleSend("save")} disabled={uploading}>📁 Save</button>
              <button className="btn btn-primary" onClick={() => handleSend("send")} disabled={uploading || queue.filter(q => !q.errors?.length).length === 0}>🚀 Send ({queue.filter(q => !q.errors?.length).length})</button>
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
    </div>
  );
}
