"use client";

import { useEffect, useState, useCallback, useRef, useMemo } from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import {
  Sparkles,
  Plus,
  Trash2,
  ChevronUp,
  ChevronDown,
  Shuffle,
  Send,
  Calendar,
  Clock,
  Image as ImageIcon,
  Tag,
  MessageSquare,
  AlertCircle,
  CheckCircle2,
  RotateCcw,
  FileText,
  BookOpen,
  Layers,
  Lightbulb,
  Check,
  X,
  HelpCircle,
  Eye,
  Settings,
  Edit3,
  Save,
  UploadCloud,
} from "lucide-react";
import { E } from "@/lib/emoji";

// ── Types ─────────────────────────────────────────────────────────────────────

interface Topic {
  message_thread_id: number;
  name: string;
  icon_color: number;
  is_closed?: boolean;
}

interface Toast {
  id: number;
  type: "success" | "error" | "info";
  message: string;
}

interface TemplateItem {
  id: string;
  question: string;
  options: string[];
  type: string;
  correctOptionId: number | null;
  explanation: string | null;
  isAnonymous: boolean;
  allowsMultiple: boolean;
  allowAddingOptions: boolean;
  allowRevoting: boolean;
  openPeriod: number | null;
  tags: string[];
}

interface CollectionItem {
  id: string;
  name: string;
  emoji: string;
  color: string;
}

// Telegram Bot API Timer Presets (strictly 5s - 600s)
const OPEN_PERIOD_PRESETS = [
  { label: "15s", value: 15 },
  { label: "30s", value: 30 },
  { label: "45s", value: 45 },
  { label: "1 min", value: 60 },
  { label: "2 min", value: 120 },
  { label: "3 min", value: 180 },
  { label: "5 min", value: 300 },
  { label: "10 min", value: 600 },
];

// Quick Option Presets
const OPTION_PRESETS = [
  {
    label: "صح / خطأ",
    sub: "True / False",
    type: "quiz" as const,
    options: ["صح", "خطأ"],
  },
  {
    label: "نعم / لا / ربما",
    sub: "Yes / No / Maybe",
    type: "poll" as const,
    options: ["نعم", "لا", "ربما"],
  },
  {
    label: "4 خيارات (A-D)",
    sub: "4 Choices",
    type: "quiz" as const,
    options: ["الخيار الأول (A)", "الخيار الثاني (B)", "الخيار الثالث (C)", "الخيار الرابع (D)"],
  },
  {
    label: "3 خيارات (A-C)",
    sub: "3 Choices",
    type: "quiz" as const,
    options: ["الخيار الأول (A)", "الخيار الثاني (B)", "الخيار الثالث (C)"],
  },
  {
    label: "موافق / محايد / معارض",
    sub: "Agree / Neutral / Disagree",
    type: "poll" as const,
    options: ["موافق تماماً", "محايد", "غير موافق"],
  },
  {
    label: "مقياس الرضا (1-5 ⭐)",
    sub: "Rating Scale",
    type: "poll" as const,
    options: ["⭐⭐⭐⭐⭐ ممتاز", "⭐⭐⭐⭐ جيد جداً", "⭐⭐⭐ مقبول", "⭐⭐ ضعيف", "⭐ غير مرضي"],
  },
];

let toastIdCounter = 0;

// Helper to get local ISO string for datetime-local min attribute
function getLocalDatetimeMin(): string {
  const now = new Date();
  now.setMinutes(now.getMinutes() - now.getTimezoneOffset());
  return now.toISOString().slice(0, 16);
}

// Regex to clean bullet points, numbering, and markers from pasted options
// Handles Arabic numerals (١-١٠), Western numerals (1-10), Arabic letters (أ، ب، ج، د), English letters (A-Z), parentheses, dashes, bullets
const BULLET_CLEAN_REGEX =
  /^(\(?[\d\u0660-\u0669\u06F0-\u06F9a-zA-Z\u0600-\u064A]{1,3}[\.\)\:\-\/]\s*|\([\d\u0660-\u0669\u06F0-\u06F9a-zA-Z\u0600-\u064A]{1,3}\)\s*|\[[\d\u0660-\u0669\u06F0-\u06F9a-zA-Z\u0600-\u064A]{1,3}\]\s*|[\*\-\•\–\—\▪\▫\✦\✓\✔\⁃\➢\➔\>]\s*)/;

export default function NewQuizPage() {
  const params = useParams();
  const router = useRouter();
  const searchParams = useSearchParams();
  const groupId = (params.groupId as string) || "";

  // ── Form State ──────────────────────────────────────────────────────────────
  const [question, setQuestion] = useState("");
  const [options, setOptions] = useState<string[]>(["", "", "", ""]);
  const [correctOptionId, setCorrectOptionId] = useState<number | null>(null);
  const [explanation, setExplanation] = useState("");
  const [type, setType] = useState<"quiz" | "poll">("quiz");
  const [isAnonymous, setIsAnonymous] = useState(true);
  const [allowsMultiple, setAllowsMultiple] = useState(false);
  const [openPeriod, setOpenPeriod] = useState<number>(60);
  const [showDuration, setShowDuration] = useState(false);
  const [selectedTopic, setSelectedTopic] = useState<Topic | null>(null);
  const [scheduledAt, setScheduledAt] = useState<string>("");
  const [recurrence, setRecurrence] = useState<string>("");

  // Media Attachment
  const [imageMode, setImageMode] = useState<"url" | "file">("url");
  const [mediaUrl, setMediaUrl] = useState<string>("");
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [imageBase64, setImageBase64] = useState<string>("");
  const [imageMimeType, setImageMimeType] = useState<string>("image/jpeg");
  const [imagePreviewUrl, setImagePreviewUrl] = useState<string>("");

  // Poll Behaviours
  const [shuffleOptions, setShuffleOptions] = useState(false);
  const [allowAddingOptions, setAllowAddingOptions] = useState(false);
  const [allowRevoting, setAllowRevoting] = useState(false);

  // Topics
  const [topics, setTopics] = useState<Topic[]>([]);
  const [loadingTopics, setLoadingTopics] = useState(false);
  const [topicError, setTopicError] = useState<string | null>(null);
  const [showManualTopic, setShowManualTopic] = useState(false);
  const [manualTopicId, setManualTopicId] = useState("");
  const [manualTopicName, setManualTopicName] = useState("");
  const [addingTopic, setAddingTopic] = useState(false);

  // Tags
  const [tags, setTags] = useState<string[]>([]);
  const [tagInput, setTagInput] = useState("");

  // UI Flow & Modals
  const [sending, setSending] = useState(false);
  const [savingTemplate, setSavingTemplate] = useState(false);
  const [sentCount, setSentCount] = useState(0);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [showImport, setShowImport] = useState(false);
  const [importTemplates, setImportTemplates] = useState<TemplateItem[]>([]);
  const [importSearch, setImportSearch] = useState("");
  const [importLoading, setImportLoading] = useState(false);
  const [showSaveModal, setShowSaveModal] = useState(false);
  const [saveCollId, setSaveCollId] = useState<string>("");
  const [saveCollections, setSaveCollections] = useState<CollectionItem[]>([]);

  // Bulk Paste / Smart Import Modal
  const [showBulkPasteModal, setShowBulkPasteModal] = useState(false);
  const [bulkPasteTab, setBulkPasteTab] = useState<"options" | "smart">("options");
  const [bulkPasteText, setBulkPasteText] = useState("");

  // Mobile layout switch
  const [activeMobileTab, setActiveMobileTab] = useState<"editor" | "settings" | "preview">("editor");

  // Interactive preview simulation (multi-answer set)
  const [previewVotedIndices, setPreviewVotedIndices] = useState<Set<number>>(new Set());
  const [showPreviewExplanation, setShowPreviewExplanation] = useState(false);

  // Auto-saved draft banner
  const draftStorageKey = useMemo(() => `quizforge_draft_v4_${groupId}`, [groupId]);
  const [showDraftBanner, setShowDraftBanner] = useState(false);
  const [draftSavedDate, setDraftSavedDate] = useState<string>("");

  const fileInputRef = useRef<HTMLInputElement>(null);
  const imagePreviewUrlRef = useRef<string>("");
  const isInitializedRef = useRef<boolean>(false);
  const optionInputRefs = useRef<(HTMLInputElement | null)[]>([]);

  // ── Toast Helper ────────────────────────────────────────────────────────────
  const addToast = useCallback((t: Toast["type"], message: string) => {
    const id = ++toastIdCounter;
    setToasts((prev) => [...prev, { id, type: t, message }]);
    setTimeout(() => {
      setToasts((prev) => prev.filter((item) => item.id !== id));
    }, 4500);
  }, []);

  const removeToast = useCallback((id: number) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  // ── Image ObjectURL Cleanup (Prevents Memory Leaks) ──────────────────────────
  const clearImage = useCallback(() => {
    if (imagePreviewUrlRef.current && imagePreviewUrlRef.current.startsWith("blob:")) {
      try {
        URL.revokeObjectURL(imagePreviewUrlRef.current);
      } catch {}
    }
    imagePreviewUrlRef.current = "";
    setImagePreviewUrl("");
    setImageFile(null);
    setImageBase64("");
    setMediaUrl("");
    if (fileInputRef.current) fileInputRef.current.value = "";
  }, []);

  useEffect(() => {
    return () => {
      if (imagePreviewUrlRef.current && imagePreviewUrlRef.current.startsWith("blob:")) {
        try {
          URL.revokeObjectURL(imagePreviewUrlRef.current);
        } catch {}
      }
    };
  }, []);

  // ── Draft Loading: URL Params or sessionStorage or LocalStorage ──────────────
  useEffect(() => {
    let draftRaw = searchParams.get("draft");
    let fromStorage = false;
    if (!draftRaw && searchParams.get("fromLibrary")) {
      try {
        draftRaw = sessionStorage.getItem("quiz-draft");
        fromStorage = true;
      } catch {}
    }

    if (draftRaw) {
      try {
        let draft: any;
        try {
          draft = JSON.parse(draftRaw);
        } catch {
          draft = JSON.parse(decodeURIComponent(draftRaw));
        }
        if (draft.question) setQuestion(draft.question);
        if (Array.isArray(draft.options) && draft.options.length >= 2) {
          setOptions(draft.options.slice(0, 10));
        }
        if (draft.type) setType(String(draft.type).toLowerCase() === "poll" ? "poll" : "quiz");
        if (draft.correctOptionId !== undefined && draft.correctOptionId !== null) {
          setCorrectOptionId(Number(draft.correctOptionId));
        }
        if (draft.explanation) setExplanation(draft.explanation);
        if (draft.isAnonymous !== undefined) setIsAnonymous(Boolean(draft.isAnonymous));
        if (draft.allowsMultiple !== undefined) setAllowsMultiple(Boolean(draft.allowsMultiple));
        if (draft.openPeriod && Number(draft.openPeriod) >= 5 && Number(draft.openPeriod) <= 600) {
          setShowDuration(true);
          setOpenPeriod(Number(draft.openPeriod));
        }
        if (draft.tags && Array.isArray(draft.tags)) setTags(draft.tags.slice(0, 5));
        if (draft.allowAddingOptions !== undefined) setAllowAddingOptions(Boolean(draft.allowAddingOptions));
        if (draft.allowRevoting !== undefined) setAllowRevoting(Boolean(draft.allowRevoting));
        if (draft.topicId && draft.topicName) {
          setSelectedTopic({ message_thread_id: Number(draft.topicId), name: draft.topicName, icon_color: 0 });
        }
        if (fromStorage) {
          try {
            sessionStorage.removeItem("quiz-draft");
          } catch {}
        }
      } catch (err) {
        console.error("Failed to parse draft", err);
      }
      isInitializedRef.current = true;
      return;
    }

    // Check for auto-saved localStorage draft if no URL draft
    try {
      const saved = localStorage.getItem(draftStorageKey);
      if (saved) {
        const parsed = JSON.parse(saved);
        if (parsed.question?.trim() || parsed.options?.some((o: string) => o.trim())) {
          setShowDraftBanner(true);
          if (parsed.savedAt) {
            setDraftSavedDate(new Date(parsed.savedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }));
          }
        }
      }
    } catch {}

    isInitializedRef.current = true;
  }, [searchParams, draftStorageKey]);

  // ── Debounced Auto-Save to LocalStorage (Safe from Accidental Erasure) ─────────
  useEffect(() => {
    // Critical: Do NOT run before initial draft detection completes
    if (!isInitializedRef.current) return;

    const isDirty = question.trim() !== "" || options.some((o) => o.trim() !== "");
    // If user has not typed anything, do NOT wipe an existing saved draft from previous session
    if (!isDirty) return;

    const timer = setTimeout(() => {
      try {
        localStorage.setItem(
          draftStorageKey,
          JSON.stringify({
            question,
            options,
            type,
            correctOptionId,
            explanation,
            isAnonymous,
            allowsMultiple,
            openPeriod,
            showDuration,
            tags,
            shuffleOptions,
            allowAddingOptions,
            allowRevoting,
            savedAt: new Date().toISOString(),
          })
        );
      } catch {}
    }, 800);

    return () => clearTimeout(timer);
  }, [
    question,
    options,
    type,
    correctOptionId,
    explanation,
    isAnonymous,
    allowsMultiple,
    openPeriod,
    showDuration,
    tags,
    shuffleOptions,
    allowAddingOptions,
    allowRevoting,
    draftStorageKey,
  ]);

  const restoreLocalDraft = useCallback(() => {
    try {
      const saved = localStorage.getItem(draftStorageKey);
      if (!saved) return;
      const d = JSON.parse(saved);
      if (d.question) setQuestion(d.question);
      if (Array.isArray(d.options) && d.options.length >= 2) setOptions(d.options);
      if (d.type) setType(d.type === "poll" ? "poll" : "quiz");
      if (d.correctOptionId !== undefined) setCorrectOptionId(d.correctOptionId);
      if (d.explanation) setExplanation(d.explanation);
      if (d.isAnonymous !== undefined) setIsAnonymous(d.isAnonymous);
      if (d.allowsMultiple !== undefined) setAllowsMultiple(d.allowsMultiple);
      if (d.showDuration !== undefined) setShowDuration(d.showDuration);
      if (d.openPeriod) setOpenPeriod(Math.min(600, Math.max(5, d.openPeriod)));
      if (Array.isArray(d.tags)) setTags(d.tags);
      if (d.shuffleOptions !== undefined) setShuffleOptions(d.shuffleOptions);
      if (d.allowAddingOptions !== undefined) setAllowAddingOptions(d.allowAddingOptions);
      if (d.allowRevoting !== undefined) setAllowRevoting(d.allowRevoting);
      setShowDraftBanner(false);
      setPreviewVotedIndices(new Set());
      addToast("success", "Unsaved draft restored successfully!");
    } catch {
      addToast("error", "Failed to restore draft.");
    }
  }, [draftStorageKey, addToast]);

  const discardLocalDraft = useCallback(() => {
    try {
      localStorage.removeItem(draftStorageKey);
    } catch {}
    setShowDraftBanner(false);
    addToast("info", "Draft discarded.");
  }, [draftStorageKey, addToast]);

  // ── Unsaved Changes Browser Protection ─────────────────────────────────────
  useEffect(() => {
    const isDirty = question.trim() !== "" || options.some((o) => o.trim() !== "");
    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      if (isDirty && !sending) {
        e.preventDefault();
        e.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => window.removeEventListener("beforeunload", handleBeforeUnload);
  }, [question, options, sending]);

  // ── Load Topics ─────────────────────────────────────────────────────────────
  const loadTopics = useCallback(() => {
    if (!groupId) return;
    setLoadingTopics(true);
    setTopicError(null);
    fetch(`/api/groups/${groupId}/topics`)
      .then((r) => r.json())
      .then((d) => {
        setTopics(d.topics || []);
        if (d.telegramError) setTopicError(d.telegramError);
        setLoadingTopics(false);
      })
      .catch(() => {
        setTopicError("Network error fetching topics");
        setLoadingTopics(false);
      });
  }, [groupId]);

  useEffect(() => {
    loadTopics();
  }, [loadTopics]);

  const handleAddManualTopic = async () => {
    if (!manualTopicId || !manualTopicName.trim()) return;
    setAddingTopic(true);
    try {
      const res = await fetch(`/api/groups/${groupId}/topics`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ topicId: Number(manualTopicId), name: manualTopicName.trim() }),
      });
      const data = await res.json();
      if (data.ok) {
        setManualTopicId("");
        setManualTopicName("");
        setShowManualTopic(false);
        loadTopics();
        addToast("success", `Topic "${data.topic.name}" added!`);
      } else {
        addToast("error", data.error || "Failed to add topic");
      }
    } catch {
      addToast("error", "Network error adding topic");
    } finally {
      setAddingTopic(false);
    }
  };

  // ── Duplicate Detection (Memoized) ──────────────────────────────────────────
  const duplicateIndices = useMemo(() => {
    const indices = new Set<number>();
    const trimmed = options.map((o) => o.trim().toLowerCase());
    trimmed.forEach((val, idx) => {
      if (val) {
        const firstIdx = trimmed.indexOf(val);
        if (firstIdx !== idx) {
          indices.add(idx);
          indices.add(firstIdx);
        }
      }
    });
    return indices;
  }, [options]);

  const hasDuplicateOptions = duplicateIndices.size > 0;

  // ── Strict Validation (Memoized) ───────────────────────────────────────────
  const validationErrors = useMemo(() => {
    const errs: string[] = [];
    const cleanQ = question.trim();

    if (!cleanQ) {
      errs.push("Question is required (1-300 characters).");
    } else if (cleanQ.length > 300) {
      errs.push(`Question exceeds 300 characters (${cleanQ.length}/300).`);
    }

    if (options.length < 2) {
      errs.push("Telegram requires at least 2 options.");
    } else if (options.length > 10) {
      errs.push("Telegram supports at most 10 options.");
    }

    const emptyCount = options.filter((o) => !o.trim()).length;
    if (emptyCount > 0) {
      errs.push(`${emptyCount} option field${emptyCount > 1 ? "s are" : " is"} empty.`);
    }

    const overLimit = options.filter((o) => o.trim().length > 100).length;
    if (overLimit > 0) {
      errs.push(`${overLimit} option${overLimit > 1 ? "s exceed" : " exceeds"} 100 characters limit.`);
    }

    if (hasDuplicateOptions) {
      errs.push("Duplicate options detected. Telegram rejects polls with identical options.");
    }

    if (type === "quiz" && correctOptionId === null) {
      errs.push("Please select the correct answer for Quiz mode.");
    }

    if (type === "quiz" && explanation.trim().length > 200) {
      errs.push(`Explanation exceeds 200 characters (${explanation.trim().length}/200).`);
    }

    if (showDuration && (openPeriod < 5 || openPeriod > 600)) {
      errs.push("Duration timer must be between 5 and 600 seconds.");
    }

    if (scheduledAt) {
      const scheduledTime = new Date(scheduledAt).getTime();
      if (isNaN(scheduledTime) || scheduledTime < Date.now() + 30_000) {
        errs.push("Scheduled time must be at least 1 minute in the future.");
      }
    }

    return errs;
  }, [question, options, hasDuplicateOptions, type, correctOptionId, explanation, showDuration, openPeriod, scheduledAt]);

  const isValid = validationErrors.length === 0;

  // ── Option Manipulations (Performance Optimized) ───────────────────────────
  const handleOptionChange = useCallback((idx: number, val: string) => {
    const sliced = val.slice(0, 100);
    setOptions((prev) => {
      if (prev[idx] === sliced) return prev;
      const next = [...prev];
      next[idx] = sliced;
      return next;
    });
  }, []);

  const addOption = useCallback(() => {
    if (options.length >= 10) {
      addToast("error", "Maximum 10 options allowed by Telegram.");
      return;
    }
    setOptions((prev) => [...prev, ""]);
    // Focus next input on next tick
    setTimeout(() => {
      const nextIdx = options.length;
      optionInputRefs.current[nextIdx]?.focus();
    }, 50);
  }, [options.length, addToast]);

  const deleteOption = useCallback(
    (idx: number) => {
      if (options.length <= 2) {
        addToast("error", "A poll must have at least 2 options.");
        return;
      }
      setOptions((prev) => prev.filter((_, i) => i !== idx));

      // Correct Option Index Adjustment
      setCorrectOptionId((prev) => {
        if (prev === null) return null;
        if (prev === idx) return null;
        if (prev > idx) return prev - 1;
        return prev;
      });

      // Interactive Preview Voting Index Adjustment
      setPreviewVotedIndices((prev) => {
        const next = new Set<number>();
        prev.forEach((i) => {
          if (i === idx) return; // removed
          if (i > idx) next.add(i - 1);
          else next.add(i);
        });
        return next;
      });
    },
    [options.length, addToast]
  );

  const moveOption = useCallback(
    (idx: number, direction: "up" | "down") => {
      const targetIdx = direction === "up" ? idx - 1 : idx + 1;
      if (targetIdx < 0 || targetIdx >= options.length) return;

      setOptions((prev) => {
        const next = [...prev];
        const temp = next[idx];
        next[idx] = next[targetIdx];
        next[targetIdx] = temp;
        return next;
      });

      // Update Correct Option
      setCorrectOptionId((prev) => {
        if (prev === null) return null;
        if (prev === idx) return targetIdx;
        if (prev === targetIdx) return idx;
        return prev;
      });

      // Update Preview Voted Indices
      setPreviewVotedIndices((prev) => {
        const next = new Set<number>();
        prev.forEach((i) => {
          if (i === idx) next.add(targetIdx);
          else if (i === targetIdx) next.add(idx);
          else next.add(i);
        });
        return next;
      });
    },
    [options.length]
  );

  const shuffleOptionsInEditor = useCallback(() => {
    if (options.length < 2) return;
    const indexed = options.map((opt, i) => ({ opt, i }));
    for (let i = indexed.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [indexed[i], indexed[j]] = [indexed[j], indexed[i]];
    }

    setOptions(indexed.map((x) => x.opt));

    // Remap Correct Option
    if (correctOptionId !== null) {
      const newCorrect = indexed.findIndex((x) => x.i === correctOptionId);
      setCorrectOptionId(newCorrect >= 0 ? newCorrect : null);
    }

    // Remap Preview Votes
    setPreviewVotedIndices((prev) => {
      const next = new Set<number>();
      prev.forEach((oldIdx) => {
        const newIdx = indexed.findIndex((x) => x.i === oldIdx);
        if (newIdx >= 0) next.add(newIdx);
      });
      return next;
    });

    addToast("info", "Options shuffled in editor 🔀");
  }, [options, correctOptionId, addToast]);

  const applyPreset = useCallback(
    (preset: (typeof OPTION_PRESETS)[0]) => {
      setOptions([...preset.options]);
      setType(preset.type);
      setCorrectOptionId(null);
      setPreviewVotedIndices(new Set());
      setShowPreviewExplanation(false);
      addToast("info", `Applied "${preset.label}" preset`);
    },
    [addToast]
  );

  // Keyboard navigation inside options (Enter to add next, Backspace to delete empty)
  const handleOptionKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>, idx: number) => {
      if (e.key === "Enter") {
        e.preventDefault();
        if (options.length < 10) {
          addOption();
        }
      } else if (e.key === "Backspace" && !options[idx] && options.length > 2) {
        e.preventDefault();
        deleteOption(idx);
        const prevIdx = Math.max(0, idx - 1);
        setTimeout(() => optionInputRefs.current[prevIdx]?.focus(), 50);
      }
    },
    [options, addOption, deleteOption]
  );

  // ── Smart Bulk Paste & Full Quiz Text Parser ───────────────────────────────
  const handleBulkPasteApply = useCallback(() => {
    if (!bulkPasteText.trim()) return;

    if (bulkPasteTab === "options") {
      // Clean lines and strip numbers/bullets
      const lines = bulkPasteText
        .split("\n")
        .map((l) => l.replace(BULLET_CLEAN_REGEX, "").trim())
        .filter((l) => l.length > 0)
        .slice(0, 10);

      if (lines.length < 2) {
        addToast("error", "Please provide at least 2 lines for options.");
        return;
      }

      setOptions(lines.map((l) => l.slice(0, 100)));
      setCorrectOptionId(null);
      setPreviewVotedIndices(new Set());
      setShowBulkPasteModal(false);
      setBulkPasteText("");
      addToast("success", `Loaded ${lines.length} options from text!`);
    } else {
      // Smart Full Quiz Parser Mode
      // Parses question, options, answer indicator, and explanation
      const rawLines = bulkPasteText
        .split("\n")
        .map((l) => l.trim())
        .filter((l) => l.length > 0);

      if (rawLines.length < 3) {
        addToast("error", "Smart import requires question and at least 2 options.");
        return;
      }

      let detectedQ = "";
      const detectedOpts: string[] = [];
      let detectedAns: number | null = null;
      let detectedExp = "";

      // Regex for answer line: "Answer: B", "الإجابة: أ", "الجواب: 2", "الحل: D", "Key: 1"
      const ansRegex =
        /^(?:[اإ]ل[اإ]جابة(?:\s+الصحيحة)?|[اإ]جابة|الجواب|الحل|حل|answer|ans|key|correct)\s*[:\-\=]\s*([a-zA-Z\d\u0660-\u0669\u0621-\u064A])/i;
      // Regex for explanation: "Explanation: ...", "الشرح: ...", "التوضيح: ...", "Note: ..."
      const expRegex = /^(?:[اإ]ل?توضيح|[اإ]ل?شرح|شرح|explanation|exp|note|reason)\s*[:\-\=]\s*(.+)/i;

      let inOptions = false;

      for (let i = 0; i < rawLines.length; i++) {
        const line = rawLines[i];

        // Check for Answer line
        const ansMatch = line.match(ansRegex);
        if (ansMatch) {
          const char = ansMatch[1].trim().toUpperCase();
          // Western digit 1-9
          if (/^[1-9]$/.test(char)) {
            detectedAns = parseInt(char, 10) - 1;
          }
          // Arabic digit ١-٩
          else if (/^[\u0661-\u0669]$/.test(char)) {
            detectedAns = char.charCodeAt(0) - 0x0661;
          }
          // English letter A-J
          else if (/^[A-J]$/.test(char)) {
            detectedAns = char.charCodeAt(0) - 65;
          }
          // Arabic letter أ، ب، ج، د، هـ
          else {
            const arLetters = ["أ", "ب", "ج", "د", "ه", "و", "ز", "ح", "ط", "ي"];
            const pos = arLetters.indexOf(char);
            if (pos >= 0) detectedAns = pos;
          }
          continue;
        }

        // Check for Explanation line
        const expMatch = line.match(expRegex);
        if (expMatch) {
          detectedExp = expMatch[1].trim().slice(0, 200);
          continue;
        }

        // First non-metadata line is Question if not set
        if (!detectedQ) {
          detectedQ = line.replace(/^(?:سؤال|السؤال|question|q)\s*[:\-\.]\s*/i, "").trim().slice(0, 300);
          inOptions = true;
          continue;
        }

        // Subsequent lines are Options
        if (inOptions && detectedOpts.length < 10) {
          const cleanOpt = line.replace(BULLET_CLEAN_REGEX, "").trim().slice(0, 100);
          if (cleanOpt) detectedOpts.push(cleanOpt);
        }
      }

      if (detectedQ) setQuestion(detectedQ);
      if (detectedOpts.length >= 2) setOptions(detectedOpts);
      if (detectedAns !== null && detectedAns >= 0 && detectedAns < detectedOpts.length) {
        setCorrectOptionId(detectedAns);
      }
      if (detectedExp) setExplanation(detectedExp);

      setType("quiz");
      setPreviewVotedIndices(new Set());
      setShowBulkPasteModal(false);
      setBulkPasteText("");
      addToast(
        "success",
        `Parsed Question + ${detectedOpts.length} Options${detectedAns !== null ? " + Answer" : ""}${
          detectedExp ? " + Explanation" : ""
        }!`
      );
    }
  }, [bulkPasteText, bulkPasteTab, addToast]);

  // ── Interactive Preview Voting Simulation ───────────────────────────────────
  const handlePreviewVote = useCallback(
    (idx: number) => {
      setPreviewVotedIndices((prev) => {
        const next = new Set(prev);
        if (type === "poll" && allowsMultiple) {
          if (next.has(idx)) next.delete(idx);
          else next.add(idx);
        } else {
          next.clear();
          next.add(idx);
        }
        return next;
      });

      // In Quiz mode, answering automatically reveals explanation
      if (type === "quiz" && explanation) {
        setShowPreviewExplanation(true);
      }
    },
    [type, allowsMultiple, explanation]
  );

  // ── File Selection & Image Reader ──────────────────────────────────────────
  const handleFileChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file) return;

      if (file.size > 5 * 1024 * 1024) {
        addToast("error", "Image too large - maximum size is 5 MB.");
        return;
      }

      if (imagePreviewUrlRef.current && imagePreviewUrlRef.current.startsWith("blob:")) {
        try {
          URL.revokeObjectURL(imagePreviewUrlRef.current);
        } catch {}
      }

      setImageFile(file);
      setImageMimeType(file.type || "image/jpeg");

      const blobUrl = URL.createObjectURL(file);
      imagePreviewUrlRef.current = blobUrl;
      setImagePreviewUrl(blobUrl);

      const reader = new FileReader();
      reader.onload = (ev) => {
        const result = ev.target?.result as string;
        const base64 = result.split(",")[1] || "";
        setImageBase64(base64);
      };
      reader.readAsDataURL(file);
    },
    [addToast]
  );

  // ── Reset Form ─────────────────────────────────────────────────────────────
  const resetForm = useCallback(() => {
    setQuestion("");
    setOptions(["", "", "", ""]);
    setCorrectOptionId(null);
    setExplanation("");
    setScheduledAt("");
    setRecurrence("");
    clearImage();
    setTags([]);
    setTagInput("");
    setPreviewVotedIndices(new Set());
    setShowPreviewExplanation(false);
    try {
      localStorage.removeItem(draftStorageKey);
    } catch {}
  }, [clearImage, draftStorageKey]);

  // ── Send to Telegram ───────────────────────────────────────────────────────
  const handleSend = async () => {
    if (!isValid) {
      addToast("error", validationErrors[0] || "Please resolve form validation issues.");
      return;
    }

    const cleanQ = question.trim();
    let finalOptions = options.map((o) => o.trim());
    let finalCorrectId = correctOptionId;

    // Shuffling on send if enabled
    if (shuffleOptions && finalOptions.length > 1) {
      const indexed = finalOptions.map((opt, i) => ({ opt, i }));
      for (let i = indexed.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [indexed[i], indexed[j]] = [indexed[j], indexed[i]];
      }
      finalOptions = indexed.map((x) => x.opt);
      if (correctOptionId !== null) {
        finalCorrectId = indexed.findIndex((x) => x.i === correctOptionId);
      }
    }

    setSending(true);
    try {
      const res = await fetch(`/api/groups/${groupId}/quiz/send`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          question: cleanQ,
          options: finalOptions,
          type,
          isAnonymous,
          correctOptionId: type === "quiz" ? finalCorrectId : undefined,
          explanation: type === "quiz" && explanation.trim() ? explanation.trim() : undefined,
          allowsMultiple: type === "poll" ? allowsMultiple : false,
          openPeriod: showDuration && openPeriod >= 5 && openPeriod <= 600 ? openPeriod : undefined,
          topicId: selectedTopic?.message_thread_id,
          topicName: selectedTopic?.name,
          scheduledAt: scheduledAt || undefined,
          mediaUrl: imageMode === "url" ? mediaUrl.trim() || undefined : undefined,
          mediaBase64: imageMode === "file" && imageBase64 ? imageBase64 : undefined,
          mediaMimeType: imageMode === "file" && imageBase64 ? imageMimeType : undefined,
          recurrence: scheduledAt && recurrence ? recurrence : undefined,
          tags: tags.length > 0 ? tags : undefined,
          allowAddingOptions: type === "poll" ? allowAddingOptions : undefined,
          allowRevoting: type === "poll" ? allowRevoting : undefined,
        }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to send poll");

      const newCount = sentCount + 1;
      setSentCount(newCount);
      addToast(
        "success",
        scheduledAt
          ? `⏰ Quiz #${newCount} scheduled successfully!`
          : `${E.ok} Quiz #${newCount} sent to Telegram!`
      );
      resetForm();
    } catch (e) {
      addToast("error", e instanceof Error ? e.message : "Unknown error occurred");
    } finally {
      setSending(false);
    }
  };

  // ── Save to Library ────────────────────────────────────────────────────────
  const openSaveModal = async () => {
    if (!question.trim()) {
      return addToast("error", "Question is required before saving to library.");
    }
    if (options.some((o) => !o.trim())) {
      return addToast("error", "All option fields must be filled before saving.");
    }
    if (hasDuplicateOptions) {
      return addToast("error", "Options must be unique before saving.");
    }
    if (type === "quiz" && correctOptionId === null) {
      return addToast("error", "Select the correct answer for Quiz before saving.");
    }

    if (saveCollections.length === 0) {
      try {
        const r = await fetch("/api/collections");
        const d = await r.json();
        setSaveCollections(d.collections || []);
      } catch {}
    }
    setShowSaveModal(true);
  };

  const doSaveTemplate = async () => {
    setSavingTemplate(true);
    setShowSaveModal(false);
    try {
      const res = await fetch("/api/templates", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          question: question.trim(),
          options: options.map((o) => o.trim()),
          type,
          isAnonymous,
          correctOptionId: type === "quiz" ? correctOptionId : null,
          explanation: type === "quiz" && explanation.trim() ? explanation.trim() : null,
          allowsMultiple: type === "poll" ? allowsMultiple : false,
          allowAddingOptions: type === "poll" ? allowAddingOptions : false,
          allowRevoting: type === "poll" ? allowRevoting : false,
          openPeriod: showDuration && openPeriod >= 5 && openPeriod <= 600 ? openPeriod : null,
          tags: tags.length > 0 ? tags : [],
          topicId: selectedTopic?.message_thread_id,
          topicName: selectedTopic?.name,
          collectionIds: saveCollId ? [saveCollId] : [],
        }),
      });

      if (!res.ok) {
        const err = await res.json();
        addToast("error", err.error || "Failed to save template");
        return;
      }

      if (saveCollId) {
        const col = saveCollections.find((c) => c.id === saveCollId);
        addToast("success", `Saved to library & added to "${col?.name || "collection"}" ${E.ok}`);
      } else {
        addToast("success", `Saved to library ${E.ok}`);
      }
      setSaveCollId("");
    } catch {
      addToast("error", "Network error saving template");
    } finally {
      setSavingTemplate(false);
    }
  };

  // ── Import from Library Modal ──────────────────────────────────────────────
  const handleImportOpen = async () => {
    setShowImport(true);
    if (importTemplates.length > 0) return;
    setImportLoading(true);
    try {
      const r = await fetch("/api/templates");
      const d = await r.json();
      setImportTemplates(d.templates || []);
    } catch {
      addToast("error", "Failed to load library templates");
    } finally {
      setImportLoading(false);
    }
  };

  const handleImportPick = (tmpl: TemplateItem) => {
    setQuestion(tmpl.question);
    const opts = tmpl.options.length >= 2 ? tmpl.options : [...tmpl.options, "", ""];
    setOptions(opts.slice(0, 10));
    setType(tmpl.type === "POLL" ? "poll" : "quiz");
    setCorrectOptionId(tmpl.correctOptionId);
    setExplanation(tmpl.explanation || "");
    setIsAnonymous(tmpl.isAnonymous);
    setAllowsMultiple(tmpl.allowsMultiple);
    setAllowAddingOptions(tmpl.allowAddingOptions ?? false);
    setAllowRevoting(tmpl.allowRevoting ?? false);
    if (tmpl.openPeriod && tmpl.openPeriod >= 5 && tmpl.openPeriod <= 600) {
      setShowDuration(true);
      setOpenPeriod(tmpl.openPeriod);
    } else {
      setShowDuration(false);
      setOpenPeriod(60);
    }
    setTags(tmpl.tags || []);
    setPreviewVotedIndices(new Set());
    setShowPreviewExplanation(false);
    setShowImport(false);
    addToast("success", "Template loaded into builder ✓");
  };

  const filteredTemplates = useMemo(() => {
    if (!importSearch.trim()) return importTemplates;
    const q = importSearch.toLowerCase();
    return importTemplates.filter(
      (t) =>
        t.question.toLowerCase().includes(q) ||
        t.tags?.some((tag) => tag.toLowerCase().includes(q)) ||
        t.options.some((opt) => opt.toLowerCase().includes(q))
    );
  }, [importTemplates, importSearch]);

  const topicColor = (color: number) => `#${color.toString(16).padStart(6, "0")}`;

  return (
    <div className="quiz-new-container">
      {/* ── Toast Notifications ───────────────────────────────────────────── */}
      <div className="toast-container" role="status" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} className={`toast toast-${t.type} animate-fade-in`}>
            <span style={{ fontSize: "1.1rem" }}>
              {t.type === "success" ? E.ok : t.type === "error" ? E.cross : E.info}
            </span>
            <span style={{ flex: 1, fontSize: "0.875rem" }}>{t.message}</span>
            <button
              onClick={() => removeToast(t.id)}
              className="toast-dismiss-btn"
              title="Dismiss"
              aria-label="Dismiss notification"
            >
              <X size={14} />
            </button>
          </div>
        ))}
      </div>

      {/* ── Unsaved Draft Recovery Banner ─────────────────────────────────── */}
      {showDraftBanner && (
        <div className="draft-banner animate-fade-up">
          <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap", flex: 1 }}>
            <span style={{ fontSize: "1.3rem" }}>💾</span>
            <div>
              <div style={{ fontWeight: 600, fontSize: "0.88rem", color: "var(--clr-text-primary)" }}>
                Unsaved Draft Found
              </div>
              <div style={{ fontSize: "0.78rem", color: "var(--clr-text-muted)" }}>
                You have an auto-saved draft {draftSavedDate ? `from ${draftSavedDate}` : "from a previous session"}.
              </div>
            </div>
          </div>
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <button className="btn btn-primary btn-sm" onClick={restoreLocalDraft}>
              <RotateCcw size={14} /> Restore Draft
            </button>
            <button className="btn btn-ghost btn-sm" onClick={discardLocalDraft}>
              Discard
            </button>
          </div>
        </div>
      )}

      {/* ── Top Header & Actions ──────────────────────────────────────────── */}
      <header className="section-header animate-fade-up" style={{ marginBottom: "var(--space-6)" }}>
        <div>
          <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
            <h1 style={{ margin: 0, fontSize: "clamp(1.5rem, 3vw, 2rem)", letterSpacing: "-0.02em" }}>
              {searchParams.get("draft") ? "Edit Quiz Duplicate" : "Telegram Quiz Studio"}
            </h1>
            <span
              className={`badge ${type === "quiz" ? "badge-brand" : "badge-accent"}`}
              style={{
                padding: "4px 10px",
                fontSize: "0.75rem",
                textTransform: "uppercase",
                fontWeight: 700,
                letterSpacing: "0.04em",
              }}
            >
              {type === "quiz" ? "🎯 Quiz Mode" : "📊 Poll Mode"}
            </span>
          </div>
          <p style={{ display: "flex", alignItems: "center", gap: "var(--space-2)", marginTop: 4, flexWrap: "wrap" }}>
            Create, simulate, and broadcast interactive Telegram polls and quizzes
            {sentCount > 0 && (
              <span
                style={{
                  background: "var(--clr-success-muted)",
                  color: "var(--clr-success)",
                  border: "1px solid rgba(16,185,129,0.3)",
                  borderRadius: "var(--radius-full)",
                  padding: "2px 10px",
                  fontSize: "0.75rem",
                  fontWeight: 700,
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 4,
                }}
              >
                <CheckCircle2 size={13} /> {sentCount} sent this session
              </span>
            )}
          </p>
        </div>

        <div className="header-action-group">
          <Link href={`/dashboard/${groupId}/library`} className="btn btn-ghost btn-sm header-btn">
            <BookOpen size={14} /> Library
          </Link>
          <Link href={`/dashboard/${groupId}/bulk`} className="btn btn-ghost btn-sm header-btn">
            <Layers size={14} /> Bulk
          </Link>
          <button className="btn btn-ghost btn-sm header-btn" onClick={handleImportOpen}>
            <FileText size={14} /> Import
          </button>
          <button
            className="btn btn-secondary btn-sm header-btn"
            onClick={openSaveModal}
            disabled={savingTemplate}
          >
            <Save size={14} /> {savingTemplate ? "Saving..." : "Save"}
          </button>
          <button
            className={`btn btn-primary btn-sm send-btn-desktop ${!isValid ? "btn-dimmed" : ""}`}
            onClick={handleSend}
            disabled={sending}
            title={isValid ? "Send quiz to Telegram" : validationErrors[0]}
          >
            {sending ? (
              <>
                <span className="spinner-icon" />
                Sending...
              </>
            ) : (
              <>
                <Send size={15} />
                {scheduledAt ? "Schedule Quiz" : "Send to Telegram"}
              </>
            )}
          </button>
        </div>
      </header>

      {/* ── Mobile View Tabs (< 1024px) ───────────────────────────────────── */}
      <div className="mobile-view-tabs" role="tablist">
        <button
          role="tab"
          aria-selected={activeMobileTab === "editor"}
          className={`mobile-tab-btn ${activeMobileTab === "editor" ? "active" : ""}`}
          onClick={() => setActiveMobileTab("editor")}
        >
          <Edit3 size={15} /> Editor
          {!isValid && <span className="tab-error-dot" title="Validation issues" />}
        </button>
        <button
          role="tab"
          aria-selected={activeMobileTab === "settings"}
          className={`mobile-tab-btn ${activeMobileTab === "settings" ? "active" : ""}`}
          onClick={() => setActiveMobileTab("settings")}
        >
          <Settings size={15} /> Settings
          {(imagePreviewUrl || tags.length > 0 || scheduledAt) && <span className="tab-active-dot" />}
        </button>
        <button
          role="tab"
          aria-selected={activeMobileTab === "preview"}
          className={`mobile-tab-btn ${activeMobileTab === "preview" ? "active" : ""}`}
          onClick={() => setActiveMobileTab("preview")}
        >
          <Eye size={15} /> Live Preview
        </button>
      </div>

      {/* ── Validation Notification Bar (if errors present) ───────────────── */}
      {!isValid && (
        <div className="validation-bar animate-fade-in">
          <AlertCircle size={17} style={{ color: "var(--clr-warning)", flexShrink: 0 }} />
          <div style={{ flex: 1, fontSize: "0.82rem", lineHeight: 1.4 }}>
            <strong>Ready check:</strong> {validationErrors[0]}
            {validationErrors.length > 1 && (
              <span style={{ opacity: 0.8, marginLeft: 6 }}>
                (+{validationErrors.length - 1} more issue{validationErrors.length > 2 ? "s" : ""})
              </span>
            )}
          </div>
        </div>
      )}

      {/* ── Main Quiz Studio Grid ─────────────────────────────────────────── */}
      <div className="quiz-studio-layout">
        {/* ═══════════ LEFT COLUMN: FORM / BUILDER ═══════════ */}
        <section
          className={`quiz-builder-col ${activeMobileTab === "editor" ? "mobile-show" : "mobile-hide"}`}
          aria-label="Quiz Editor"
        >
          {/* Quiz / Poll Type Toggle */}
          <div className="card card-glow-subtle animate-fade-up">
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
              <h4 style={{ margin: 0, fontSize: "0.95rem" }}>Quiz Format</h4>
              <span style={{ fontSize: "0.75rem", color: "var(--clr-text-muted)" }}>Telegram Bot API 7.0+</span>
            </div>
            <div className="type-toggle-grid">
              <button
                type="button"
                className={`type-card-btn ${type === "quiz" ? "selected" : ""}`}
                onClick={() => setType("quiz")}
              >
                <div className="type-card-icon">{E.quiz}</div>
                <div style={{ textAlign: "left", flex: 1 }}>
                  <div className="type-card-title">Quiz Mode</div>
                  <div className="type-card-desc">Has one correct answer + explanation</div>
                </div>
                {type === "quiz" && <Check size={18} className="type-card-check" />}
              </button>

              <button
                type="button"
                className={`type-card-btn ${type === "poll" ? "selected" : ""}`}
                onClick={() => {
                  setType("poll");
                  setCorrectOptionId(null);
                  setPreviewVotedIndices(new Set());
                }}
              >
                <div className="type-card-icon">{E.poll}</div>
                <div style={{ textAlign: "left", flex: 1 }}>
                  <div className="type-card-title">Poll Mode</div>
                  <div className="type-card-desc">Public opinion, multiple choices & voting</div>
                </div>
                {type === "poll" && <Check size={18} className="type-card-check" />}
              </button>
            </div>
          </div>

          {/* Quick Presets Bar */}
          <div className="card animate-fade-up animate-delay-1" style={{ padding: "14px 18px" }}>
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                marginBottom: 10,
                flexWrap: "wrap",
                gap: 6,
              }}
            >
              <span
                style={{
                  fontSize: "0.78rem",
                  fontWeight: 700,
                  color: "var(--clr-text-muted)",
                  textTransform: "uppercase",
                  letterSpacing: "0.06em",
                  display: "flex",
                  alignItems: "center",
                  gap: 5,
                }}
              >
                <Sparkles size={14} style={{ color: "var(--clr-brand)" }} /> Quick Option Presets
              </span>
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                onClick={() => {
                  setBulkPasteTab("smart");
                  setShowBulkPasteModal(true);
                }}
                style={{ fontSize: "0.76rem", padding: "3px 8px", color: "var(--clr-brand)" }}
              >
                <Sparkles size={13} /> Smart Text Importer
              </button>
            </div>
            <div className="presets-pill-list">
              {OPTION_PRESETS.map((p) => (
                <button
                  key={p.label}
                  type="button"
                  className="preset-chip"
                  onClick={() => applyPreset(p)}
                  title={`${p.sub} (${p.options.length} options)`}
                >
                  <span style={{ fontWeight: 600 }}>{p.label}</span>
                  <span className="preset-chip-sub">({p.options.length})</span>
                </button>
              ))}
            </div>
          </div>

          {/* Question Box */}
          <div className="card animate-fade-up animate-delay-2">
            <div className="input-wrapper">
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
                <label className="input-label" style={{ margin: 0 }}>
                  Question <span style={{ color: "var(--clr-danger)" }}>*</span>
                </label>
                <div
                  className={`char-count-pill ${
                    question.length > 280 ? "count-danger" : question.length > 240 ? "count-warn" : ""
                  }`}
                >
                  {question.length}/300
                </div>
              </div>
              <textarea
                dir="auto"
                className="input custom-textarea"
                placeholder="What would you like to ask? (Telegram max: 300 characters)"
                value={question}
                onChange={(e) => setQuestion(e.target.value.slice(0, 300))}
                rows={3}
                style={{
                  fontSize: "1rem",
                  borderColor: question.length > 290 ? "var(--clr-danger)" : undefined,
                }}
              />
              {/* Question progress bar */}
              <div className="char-progress-bar">
                <div
                  className={`char-progress-fill ${
                    question.length > 280 ? "fill-danger" : question.length > 240 ? "fill-warn" : ""
                  }`}
                  style={{ width: `${Math.min(100, (question.length / 300) * 100)}%` }}
                />
              </div>
            </div>
          </div>

          {/* Options Section */}
          <div className="card animate-fade-up animate-delay-3">
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                marginBottom: 14,
                flexWrap: "wrap",
                gap: 10,
              }}
            >
              <div>
                <h4 style={{ margin: 0, fontSize: "0.95rem" }}>Answer Options</h4>
                <p style={{ margin: 0, fontSize: "0.78rem", color: "var(--clr-text-muted)", marginTop: 2 }}>
                  {type === "quiz"
                    ? "Tap the circle beside the correct answer (2 to 10 options)"
                    : "Between 2 and 10 options"}
                </p>
              </div>

              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <button
                  type="button"
                  className="btn btn-ghost btn-sm"
                  onClick={shuffleOptionsInEditor}
                  title="Shuffle current options order"
                  style={{ fontSize: "0.78rem", padding: "4px 8px" }}
                >
                  <Shuffle size={13} /> Shuffle Order
                </button>
                <div className="step-display-compact">
                  <span className="step-count-pill">{options.length} / 10</span>
                </div>
              </div>
            </div>

            {/* In-quiz instructions */}
            {type === "quiz" && (
              <div className="quiz-hint-banner">
                <CheckCircle2 size={16} style={{ color: "var(--clr-success)", flexShrink: 0 }} />
                <span>
                  {correctOptionId !== null
                    ? `Correct answer set to Option ${String.fromCharCode(65 + correctOptionId)} ("${
                        options[correctOptionId] || "..."
                      }")`
                    : "Click the radio icon beside the correct answer to designate it"}
                </span>
              </div>
            )}

            {/* Options List */}
            <div className="options-stack">
              {options.map((opt, idx) => {
                const isCorrect = type === "quiz" && correctOptionId === idx;
                const isDup = duplicateIndices.has(idx);
                const optLen = opt.length;
                const isEmpty = !opt.trim();

                return (
                  <div
                    key={idx}
                    className={`option-editor-row ${isCorrect ? "row-correct" : ""} ${isDup ? "row-duplicate" : ""}`}
                  >
                    {/* Correct Selector / Option Letter */}
                    {type === "quiz" ? (
                      <button
                        type="button"
                        className={`option-check-btn ${isCorrect ? "selected" : ""}`}
                        onClick={() => setCorrectOptionId(idx)}
                        title={isCorrect ? "Correct answer" : "Mark as correct answer"}
                        aria-label={`Mark option ${String.fromCharCode(65 + idx)} as correct`}
                      >
                        {isCorrect ? (
                          <Check size={16} strokeWidth={3} />
                        ) : (
                          <span style={{ fontSize: "0.75rem", fontWeight: 700, color: "var(--clr-text-muted)" }}>
                            {String.fromCharCode(65 + idx)}
                          </span>
                        )}
                      </button>
                    ) : (
                      <div className="option-letter-badge">{String.fromCharCode(65 + idx)}</div>
                    )}

                    {/* Option Text Input */}
                    <div style={{ flex: 1, position: "relative" }}>
                      <input
                        ref={(el) => {
                          optionInputRefs.current[idx] = el;
                        }}
                        dir="auto"
                        className={`input option-input-field ${isCorrect ? "border-success" : ""} ${
                          isDup ? "border-danger" : ""
                        }`}
                        placeholder={`Option ${String.fromCharCode(65 + idx)}${isCorrect ? " (Correct Answer)" : ""}`}
                        value={opt}
                        onChange={(e) => handleOptionChange(idx, e.target.value)}
                        onKeyDown={(e) => handleOptionKeyDown(e, idx)}
                        maxLength={100}
                      />
                      {/* Duplicate badge */}
                      {isDup && opt.trim() && (
                        <span className="option-badge-warning" title="Telegram rejects identical options">
                          ⚠️ Duplicate
                        </span>
                      )}
                      {/* Character meter when long */}
                      {optLen > 70 && (
                        <span className={`option-len-tag ${optLen > 95 ? "len-danger" : "len-warn"}`}>
                          {optLen}/100
                        </span>
                      )}
                    </div>

                    {/* Move Up / Down Controls */}
                    <div className="option-row-actions">
                      <button
                        type="button"
                        className="option-action-btn"
                        onClick={() => moveOption(idx, "up")}
                        disabled={idx === 0}
                        title="Move Up"
                        aria-label="Move Up"
                      >
                        <ChevronUp size={14} />
                      </button>
                      <button
                        type="button"
                        className="option-action-btn"
                        onClick={() => moveOption(idx, "down")}
                        disabled={idx === options.length - 1}
                        title="Move Down"
                        aria-label="Move Down"
                      >
                        <ChevronDown size={14} />
                      </button>
                      <button
                        type="button"
                        className="option-action-btn delete-btn"
                        onClick={() => deleteOption(idx)}
                        disabled={options.length <= 2}
                        title={options.length <= 2 ? "Minimum 2 options required" : "Delete option"}
                        aria-label="Delete option"
                      >
                        <Trash2 size={13} />
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Bottom Option Bar */}
            <div className="options-footer-actions">
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                onClick={addOption}
                disabled={options.length >= 10}
                style={{ flex: 1, justifyContent: "center", minHeight: 38 }}
              >
                <Plus size={15} /> Add Option ({options.length}/10)
              </button>
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                onClick={() => {
                  setBulkPasteTab("options");
                  setShowBulkPasteModal(true);
                }}
                title="Paste multiple lines at once"
                style={{ minHeight: 38 }}
              >
                <FileText size={15} /> Bulk Add
              </button>
            </div>
          </div>

          {/* Explanation (Quiz Mode Only) */}
          {type === "quiz" && (
            <div className="card animate-fade-up animate-delay-4">
              <div className="input-wrapper">
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
                  <label className="input-label" style={{ margin: 0, display: "flex", alignItems: "center", gap: 6 }}>
                    <Lightbulb size={16} style={{ color: "#fbbf24" }} /> Explanation{" "}
                    <span style={{ color: "var(--clr-text-muted)", fontWeight: 400 }}>(optional)</span>
                  </label>
                  <div className={`char-count-pill ${explanation.length > 185 ? "count-danger" : ""}`}>
                    {explanation.length}/200
                  </div>
                </div>
                <textarea
                  dir="auto"
                  className="input custom-textarea"
                  placeholder="Shown to voters after answering to explain why this option is correct (max 200 characters)..."
                  value={explanation}
                  onChange={(e) => setExplanation(e.target.value.slice(0, 200))}
                  rows={2}
                  maxLength={200}
                />
                <p style={{ margin: 0, fontSize: "0.74rem", color: "var(--clr-text-muted)", marginTop: 4 }}>
                  Telegram displays this when voters tap the lightbulb or choose an incorrect answer.
                </p>
              </div>
            </div>
          )}
        </section>

        {/* ═══════════ RIGHT COLUMN: SETTINGS + LIVE PREVIEW ═══════════ */}
        <section
          className={`quiz-sidebar-col ${
            activeMobileTab === "settings" || activeMobileTab === "preview" ? "mobile-show" : "mobile-hide"
          }`}
          aria-label="Settings and Preview"
        >
          {/* Settings Box */}
          <div
            className={`card ${activeMobileTab === "preview" ? "mobile-hide-card" : ""}`}
            style={{ marginBottom: "var(--space-5)" }}
          >
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
              <h4 style={{ margin: 0, fontSize: "0.95rem", display: "flex", alignItems: "center", gap: 6 }}>
                <Settings size={16} /> Broadcast Settings
              </h4>
              <span style={{ fontSize: "0.72rem", color: "var(--clr-text-muted)", textTransform: "uppercase" }}>
                Configuration
              </span>
            </div>

            {/* Image / Media Attachment */}
            <div className="setting-group-box">
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
                <span className="setting-label-header" style={{ display: "flex", alignItems: "center", gap: 5 }}>
                  <ImageIcon size={13} /> Attached Photo
                </span>
                <div className="mode-pill-toggle">
                  <button
                    type="button"
                    className={`mode-pill-btn ${imageMode === "url" ? "active" : ""}`}
                    onClick={() => {
                      setImageMode("url");
                      clearImage();
                    }}
                  >
                    URL
                  </button>
                  <button
                    type="button"
                    className={`mode-pill-btn ${imageMode === "file" ? "active" : ""}`}
                    onClick={() => {
                      setImageMode("file");
                      clearImage();
                    }}
                  >
                    Upload
                  </button>
                </div>
              </div>

              {imageMode === "url" ? (
                <div style={{ display: "flex", gap: 6 }}>
                  <input
                    className="input"
                    type="url"
                    placeholder="https://example.com/diagram.jpg"
                    value={mediaUrl}
                    onChange={(e) => {
                      setMediaUrl(e.target.value);
                      setImagePreviewUrl(e.target.value);
                    }}
                    style={{ fontSize: "0.84rem" }}
                  />
                  {mediaUrl && (
                    <button
                      type="button"
                      className="btn btn-ghost btn-sm"
                      onClick={clearImage}
                      title="Clear image"
                      style={{ padding: "0 8px", color: "var(--clr-danger)" }}
                    >
                      <X size={14} />
                    </button>
                  )}
                </div>
              ) : (
                <div>
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept="image/png,image/jpeg,image/webp,image/gif"
                    style={{ display: "none" }}
                    onChange={handleFileChange}
                  />
                  <button
                    type="button"
                    className="btn btn-secondary"
                    style={{ width: "100%", justifyContent: "center", gap: 8, fontSize: "0.84rem", minHeight: 38 }}
                    onClick={() => fileInputRef.current?.click()}
                  >
                    <UploadCloud size={16} />
                    {imageFile ? "Change Image" : "Choose from Device"}
                  </button>
                  {imageFile && (
                    <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 6, fontSize: "0.78rem" }}>
                      <span
                        style={{
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                          whiteSpace: "nowrap",
                          flex: 1,
                          color: "var(--clr-text-secondary)",
                        }}
                      >
                        {imageFile.name} ({(imageFile.size / 1024).toFixed(0)} KB)
                      </span>
                      <button
                        type="button"
                        onClick={clearImage}
                        style={{
                          background: "none",
                          border: "none",
                          cursor: "pointer",
                          color: "var(--clr-danger)",
                          padding: 2,
                        }}
                        title="Remove"
                      >
                        <X size={14} />
                      </button>
                    </div>
                  )}
                </div>
              )}

              {/* Photo preview thumbnail */}
              {imagePreviewUrl && (
                <div className="image-preview-thumb">
                  <img
                    src={imagePreviewUrl}
                    alt="Media preview"
                    onError={() => {
                      if (imageMode === "url") setImagePreviewUrl("");
                    }}
                  />
                  <button
                    type="button"
                    className="thumb-remove-btn"
                    onClick={clearImage}
                    title="Remove Image"
                  >
                    <X size={12} />
                  </button>
                </div>
              )}
            </div>

            {/* Forum Topic Picker */}
            <div className="setting-group-box">
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 6 }}>
                <span className="setting-label-header" style={{ display: "flex", alignItems: "center", gap: 5 }}>
                  <MessageSquare size={13} /> Forum Topic
                </span>
                <button
                  type="button"
                  className="btn btn-ghost btn-sm"
                  onClick={loadTopics}
                  disabled={loadingTopics}
                  style={{ fontSize: "0.7rem", padding: "2px 6px" }}
                >
                  {loadingTopics ? "..." : "↻ Refresh"}
                </button>
              </div>

              {loadingTopics ? (
                <div className="skeleton" style={{ height: 38, borderRadius: 8 }} />
              ) : topics.length > 0 ? (
                <select
                  className="select"
                  value={selectedTopic?.message_thread_id || ""}
                  onChange={(e) => {
                    const tid = parseInt(e.target.value);
                    const t = topics.find((item) => item.message_thread_id === tid);
                    setSelectedTopic(t || null);
                  }}
                  style={{ fontSize: "0.84rem" }}
                >
                  <option value="">💬 General Chat (No topic)</option>
                  {topics.map((t) => (
                    <option key={t.message_thread_id} value={t.message_thread_id}>
                      {t.is_closed ? "🔒 " : "# "}
                      {t.name}
                    </option>
                  ))}
                </select>
              ) : (
                <div className="topic-notice-box">
                  {topicError ? "Bot requires Manage Topics permission" : "No forum topics detected"}
                </div>
              )}

              <button
                type="button"
                className="btn btn-ghost btn-sm"
                onClick={() => setShowManualTopic(!showManualTopic)}
                style={{ marginTop: 4, fontSize: "0.72rem", color: "var(--clr-text-muted)", padding: 0 }}
              >
                {showManualTopic ? "▲ Hide Manual ID" : "＋ Specify Topic ID Manually"}
              </button>

              {showManualTopic && (
                <div className="manual-topic-drawer animate-fade-in">
                  <input
                    className="input"
                    placeholder="Topic Thread ID (e.g. 1024)"
                    type="number"
                    value={manualTopicId}
                    onChange={(e) => setManualTopicId(e.target.value.replace(/\D/g, ""))}
                    style={{ fontSize: "0.82rem" }}
                  />
                  <input
                    className="input"
                    placeholder="Topic Name"
                    value={manualTopicName}
                    onChange={(e) => setManualTopicName(e.target.value)}
                    style={{ fontSize: "0.82rem" }}
                  />
                  <button
                    type="button"
                    className="btn btn-primary btn-sm"
                    onClick={handleAddManualTopic}
                    disabled={addingTopic || !manualTopicId || !manualTopicName.trim()}
                    style={{ justifyContent: "center" }}
                  >
                    {addingTopic ? "Saving..." : "Save Topic"}
                  </button>
                </div>
              )}
            </div>

            {/* Tags (Max 5) */}
            <div className="setting-group-box">
              <label className="setting-label-header" style={{ marginBottom: 6, display: "flex", alignItems: "center", gap: 5 }}>
                <Tag size={13} /> Tags <span style={{ color: "var(--clr-text-muted)", fontWeight: 400 }}>(Max 5)</span>
              </label>
              <div className="tags-input-container">
                {tags.map((tag) => (
                  <span key={tag} className="badge badge-accent tag-pill">
                    #{tag}
                    <button
                      type="button"
                      onClick={() => setTags((ts) => ts.filter((t) => t !== tag))}
                      className="tag-remove-x"
                      aria-label={`Remove tag ${tag}`}
                    >
                      <X size={10} />
                    </button>
                  </span>
                ))}
                {tags.length < 5 && (
                  <input
                    type="text"
                    className="tag-text-input"
                    placeholder={tags.length === 0 ? "Type tag + press Enter" : "Add..."}
                    value={tagInput}
                    onChange={(e) =>
                      setTagInput(e.target.value.replace(/[^a-zA-Z0-9_\u0600-\u06FF-]/g, "").slice(0, 18))
                    }
                    onKeyDown={(e) => {
                      if ((e.key === "Enter" || e.key === ",") && tagInput.trim()) {
                        e.preventDefault();
                        const newTag = tagInput.trim().toLowerCase();
                        if (newTag && !tags.includes(newTag)) {
                          setTags((ts) => [...ts, newTag]);
                        }
                        setTagInput("");
                      } else if (e.key === "Backspace" && !tagInput && tags.length > 0) {
                        setTags((ts) => ts.slice(0, -1));
                      }
                    }}
                  />
                )}
              </div>
            </div>

            {/* Schedule & Recurrence */}
            <div className="setting-group-box">
              <label className="setting-label-header" style={{ display: "flex", alignItems: "center", gap: 5 }}>
                <Calendar size={13} /> Scheduled Release
              </label>
              <input
                type="datetime-local"
                className="input"
                value={scheduledAt}
                onChange={(e) => {
                  setScheduledAt(e.target.value);
                  if (!e.target.value) setRecurrence("");
                }}
                min={getLocalDatetimeMin()}
                style={{ fontSize: "0.84rem" }}
              />

              {scheduledAt && (
                <div style={{ marginTop: 8 }}>
                  <label className="setting-label-header">🔁 Recurrence</label>
                  <select
                    className="select"
                    value={recurrence}
                    onChange={(e) => setRecurrence(e.target.value)}
                    style={{ fontSize: "0.84rem" }}
                  >
                    <option value="">Single Broadcast (No repeat)</option>
                    <option value="daily">Daily</option>
                    <option value="weekly">Weekly</option>
                    <option value="biweekly">Every 2 Weeks</option>
                    <option value="monthly">Monthly</option>
                  </select>
                </div>
              )}
            </div>

            {/* ── Poll & Quiz Behaviour Switches ── */}
            <div style={{ borderTop: "1px solid var(--clr-border)", paddingTop: 14 }}>
              <div
                style={{
                  fontSize: "0.72rem",
                  fontWeight: 700,
                  color: "var(--clr-text-muted)",
                  textTransform: "uppercase",
                  letterSpacing: "0.06em",
                  marginBottom: 8,
                }}
              >
                Telegram Poll Parameters
              </div>

              {/* Show Who Voted / Public vs Anonymous */}
              <label className="toggle-row">
                <div>
                  <div className="toggle-row-title">Public Voting (Show Names)</div>
                  <div className="toggle-row-sub">Voter names will be visible to everyone</div>
                </div>
                <div className="toggle-switch">
                  <input
                    type="checkbox"
                    checked={!isAnonymous}
                    onChange={(e) => setIsAnonymous(!e.target.checked)}
                  />
                  <span className="toggle-slider" />
                </div>
              </label>

              {/* Shuffle Options on Send */}
              <label className="toggle-row">
                <div>
                  <div className="toggle-row-title">Shuffle Options on Send</div>
                  <div className="toggle-row-sub">Randomizes order before sending to Telegram</div>
                </div>
                <div className="toggle-switch">
                  <input
                    type="checkbox"
                    checked={shuffleOptions}
                    onChange={(e) => setShuffleOptions(e.target.checked)}
                  />
                  <span className="toggle-slider" />
                </div>
              </label>

              {/* Poll-Only Options */}
              {type === "poll" ? (
                <>
                  <label className="toggle-row">
                    <div>
                      <div className="toggle-row-title">Multiple Answers</div>
                      <div className="toggle-row-sub">Voters can pick more than one option</div>
                    </div>
                    <div className="toggle-switch">
                      <input
                        type="checkbox"
                        checked={allowsMultiple}
                        onChange={(e) => {
                          setAllowsMultiple(e.target.checked);
                          setPreviewVotedIndices(new Set());
                        }}
                      />
                      <span className="toggle-slider" />
                    </div>
                  </label>

                  <label className="toggle-row">
                    <div>
                      <div className="toggle-row-title">Allow Adding Options</div>
                      <div className="toggle-row-sub">Voters can suggest new answers</div>
                    </div>
                    <div className="toggle-switch">
                      <input
                        type="checkbox"
                        checked={allowAddingOptions}
                        onChange={(e) => setAllowAddingOptions(e.target.checked)}
                      />
                      <span className="toggle-slider" />
                    </div>
                  </label>

                  <label className="toggle-row">
                    <div>
                      <div className="toggle-row-title">Allow Revoting</div>
                      <div className="toggle-row-sub">Voters can retract or alter their choice</div>
                    </div>
                    <div className="toggle-switch">
                      <input
                        type="checkbox"
                        checked={allowRevoting}
                        onChange={(e) => setAllowRevoting(e.target.checked)}
                      />
                      <span className="toggle-slider" />
                    </div>
                  </label>
                </>
              ) : (
                <div className="quiz-rules-note">
                  ℹ️ Quiz Mode enforces single-answer & final voting per Telegram Bot standards.
                </div>
              )}

              {/* Timer / open_period (Strictly 5-600s) */}
              <div style={{ marginTop: 8 }}>
                <label className="toggle-row" style={{ borderBottom: "none" }}>
                  <div>
                    <div className="toggle-row-title" style={{ display: "flex", alignItems: "center", gap: 5 }}>
                      <Clock size={14} /> Limit Duration (Timer)
                    </div>
                    <div className="toggle-row-sub">Closes automatically after timer expires</div>
                  </div>
                  <div className="toggle-switch">
                    <input
                      type="checkbox"
                      checked={showDuration}
                      onChange={(e) => setShowDuration(e.target.checked)}
                    />
                    <span className="toggle-slider" />
                  </div>
                </label>

                {showDuration && (
                  <div className="timer-config-drawer animate-fade-in">
                    <div
                      style={{
                        display: "flex",
                        justifyContent: "space-between",
                        alignItems: "center",
                        marginBottom: 6,
                      }}
                    >
                      <span style={{ fontSize: "0.78rem", color: "var(--clr-text-secondary)" }}>
                        Timer: <strong style={{ color: "var(--clr-brand)" }}>{openPeriod} seconds</strong>
                        {openPeriod >= 60
                          ? ` (${Math.floor(openPeriod / 60)}m ${openPeriod % 60 ? `${openPeriod % 60}s` : ""})`
                          : ""}
                      </span>
                      <span style={{ fontSize: "0.7rem", color: "var(--clr-text-muted)" }}>5s - 600s</span>
                    </div>

                    {/* Presets */}
                    <div className="timer-chip-grid">
                      {OPEN_PERIOD_PRESETS.map((p) => (
                        <button
                          key={p.value}
                          type="button"
                          className={`timer-chip ${openPeriod === p.value ? "active" : ""}`}
                          onClick={() => setOpenPeriod(p.value)}
                        >
                          {p.label}
                        </button>
                      ))}
                    </div>

                    {/* Custom range slider */}
                    <div style={{ marginTop: 8 }}>
                      <input
                        type="range"
                        min={5}
                        max={600}
                        step={5}
                        value={openPeriod}
                        onChange={(e) => setOpenPeriod(parseInt(e.target.value) || 60)}
                        style={{ width: "100%", accentColor: "var(--clr-brand)", cursor: "pointer" }}
                      />
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* ═══════════ REAL-TIME TELEGRAM MOCKUP PREVIEW ═══════════ */}
          <div className={`card preview-card-wrapper ${activeMobileTab === "settings" ? "mobile-hide-card" : ""}`}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                <Eye size={15} style={{ color: "var(--clr-brand)" }} />
                <h4
                  style={{
                    margin: 0,
                    fontSize: "0.88rem",
                    textTransform: "uppercase",
                    letterSpacing: "0.06em",
                    color: "var(--clr-text-muted)",
                  }}
                >
                  Telegram Live Preview
                </h4>
              </div>
              <span style={{ fontSize: "0.72rem", color: "var(--clr-success)", fontWeight: 600 }}>
                ● Real-time
              </span>
            </div>

            {selectedTopic && (
              <div className="preview-topic-pill">
                <span
                  style={{
                    width: 8,
                    height: 8,
                    borderRadius: "50%",
                    background: topicColor(selectedTopic.icon_color || 7322096),
                    display: "inline-block",
                  }}
                />
                <span>#{selectedTopic.name}</span>
              </div>
            )}

            {/* Simulated Telegram Message Bubble */}
            <div className="tg-mockup-phone">
              {/* Bot Header */}
              <div className="tg-bubble-header">
                <div className="tg-avatar-circle">🤖</div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                    <span className="tg-bot-name">QuizForge Bot</span>
                    <span className="tg-bot-badge">bot</span>
                  </div>
                  <div className="tg-bot-handle">@agridmu_bot</div>
                </div>
                <span className="tg-timestamp">now</span>
              </div>

              {/* Photo inside bubble */}
              {imagePreviewUrl && (
                <div className="tg-bubble-media">
                  <img src={imagePreviewUrl} alt="Poll Media" />
                </div>
              )}

              {/* Main Poll Bubble Box */}
              <div className="tg-bubble-body">
                <div className="tg-bubble-type-tag">
                  {type === "quiz"
                    ? isAnonymous
                      ? "🎯 Anonymous Quiz"
                      : "🎯 Public Quiz"
                    : isAnonymous
                    ? "📊 Anonymous Poll"
                    : "📊 Public Poll"}
                  {allowsMultiple && type === "poll" && " · Multiple answers"}
                </div>

                <div dir="auto" className="tg-bubble-question">
                  {question || "Type your question above to preview..."}
                </div>

                {/* Option items inside bubble */}
                <div className="tg-options-group">
                  {options.map((opt, idx) => {
                    const isSelected = previewVotedIndices.has(idx);
                    const isAnswerCorrect = type === "quiz" && correctOptionId === idx;
                    const isIncorrectVote =
                      type === "quiz" &&
                      isSelected &&
                      correctOptionId !== null &&
                      correctOptionId !== idx;
                    const hasVoted = previewVotedIndices.size > 0;

                    // Simulated percentage for polls
                    let simulatedPercent = 0;
                    if (hasVoted) {
                      if (type === "quiz") {
                        simulatedPercent = isAnswerCorrect ? 100 : isSelected ? 100 : 0;
                      } else {
                        simulatedPercent = isSelected ? Math.round(100 / Math.max(1, previewVotedIndices.size)) : 0;
                      }
                    }

                    return (
                      <button
                        key={idx}
                        type="button"
                        className={`tg-bubble-option ${isSelected ? "voted" : ""} ${
                          isAnswerCorrect && hasVoted ? "reveal-correct" : ""
                        } ${isIncorrectVote ? "reveal-wrong" : ""}`}
                        onClick={() => handlePreviewVote(idx)}
                        title="Click to simulate voting"
                      >
                        {/* Vote percentage bar background */}
                        {hasVoted && (
                          <div
                            className={`tg-vote-bar ${
                              isAnswerCorrect ? "bar-correct" : isIncorrectVote ? "bar-wrong" : ""
                            }`}
                            style={{ width: `${simulatedPercent}%` }}
                          />
                        )}

                        <div className="tg-opt-radio">
                          {type === "poll" && allowsMultiple ? (
                            <span className={`tg-checkbox-box ${isSelected ? "checked" : ""}`}>
                              {isSelected ? "✓" : ""}
                            </span>
                          ) : (
                            <span className={`tg-radio-circle ${isSelected ? "checked" : ""}`} />
                          )}
                        </div>

                        <span dir="auto" className="tg-opt-text">
                          {opt || `Option ${String.fromCharCode(65 + idx)}`}
                        </span>

                        {/* Status icon inside option */}
                        {hasVoted && (
                          <span style={{ marginLeft: "auto", fontSize: "0.85rem", zIndex: 2 }}>
                            {type === "quiz" ? (
                              isAnswerCorrect ? "✅" : isSelected ? "❌" : ""
                            ) : isSelected ? (
                              `${simulatedPercent}%`
                            ) : (
                              "0%"
                            )}
                          </span>
                        )}
                      </button>
                    );
                  })}
                </div>

                {/* Explanation block */}
                {explanation && (
                  <div className="tg-explanation-wrapper">
                    <button
                      type="button"
                      className="tg-bulb-btn"
                      onClick={() => setShowPreviewExplanation(!showPreviewExplanation)}
                      title="Toggle explanation"
                    >
                      💡 {showPreviewExplanation ? "Hide Explanation" : "Show Explanation"}
                    </button>
                    {showPreviewExplanation && (
                      <div dir="auto" className="tg-bubble-explanation animate-fade-in">
                        <span style={{ fontSize: "0.95rem" }}>💡</span>
                        <div style={{ flex: 1 }}>{explanation}</div>
                      </div>
                    )}
                  </div>
                )}

                {/* Bubble Footer Metadata */}
                <div className="tg-bubble-footer">
                  <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
                    {showDuration && (
                      <span className="tg-footer-pill">⏱️ {openPeriod}s left</span>
                    )}
                    {shuffleOptions && (
                      <span className="tg-footer-pill">🔀 Shuffled</span>
                    )}
                    {scheduledAt && (
                      <span className="tg-footer-pill" style={{ color: "#fbbf24" }}>
                        ⏰ Scheduled
                      </span>
                    )}
                  </div>
                  <span style={{ fontSize: "0.65rem", opacity: 0.7 }}>
                    {previewVotedIndices.size > 0 ? `${previewVotedIndices.size} vote(s)` : "0 votes"}
                  </span>
                </div>
              </div>
            </div>

            {previewVotedIndices.size > 0 && (
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                onClick={() => {
                  setPreviewVotedIndices(new Set());
                  setShowPreviewExplanation(false);
                }}
                style={{ width: "100%", marginTop: 8, fontSize: "0.72rem", color: "var(--clr-text-muted)" }}
              >
                <RotateCcw size={12} /> Reset Preview Vote Simulation
              </button>
            )}
          </div>
        </section>
      </div>

      {/* ── Fixed Mobile Bottom Action Bar (< 1024px) ───────────────────────── */}
      <div className="mobile-action-bar">
        <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0, flex: 1 }}>
          <span style={{ fontSize: "1.1rem" }}>{isValid ? "✅" : "⚠️"}</span>
          <div
            style={{
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
              fontSize: "0.78rem",
            }}
          >
            {isValid ? (
              <span style={{ color: "var(--clr-success)", fontWeight: 600 }}>Ready to send</span>
            ) : (
              <span style={{ color: "var(--clr-warning)" }}>{validationErrors[0]}</span>
            )}
          </div>
        </div>

        <button
          type="button"
          className="btn btn-primary btn-sm mobile-send-btn"
          onClick={handleSend}
          disabled={sending || !isValid}
        >
          {sending ? (
            <>
              <span className="spinner-icon" />
              Sending...
            </>
          ) : (
            <>
              <Send size={14} />
              {scheduledAt ? "Schedule" : "Send Now"}
            </>
          )}
        </button>
      </div>

      {/* ── Bulk Paste & Smart Quiz Import Modal ────────────────────────────── */}
      {showBulkPasteModal && (
        <div className="modal-backdrop" onClick={() => setShowBulkPasteModal(false)}>
          <div className="modal-card modal-card-lg animate-fade-up" onClick={(e) => e.stopPropagation()}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <div className="modal-icon-badge">
                  <Sparkles size={20} style={{ color: "var(--clr-brand)" }} />
                </div>
                <div>
                  <h3 style={{ margin: 0, fontSize: "1.1rem" }}>
                    {bulkPasteTab === "smart" ? "Smart Quiz Text Parser" : "Bulk Paste Options"}
                  </h3>
                  <p style={{ margin: 0, fontSize: "0.78rem", color: "var(--clr-text-muted)" }}>
                    Paste text from Word, Telegram, or exams with automatic formatting
                  </p>
                </div>
              </div>
              <button
                className="btn btn-ghost btn-sm"
                onClick={() => setShowBulkPasteModal(false)}
                aria-label="Close modal"
              >
                <X size={16} />
              </button>
            </div>

            {/* Mode Tabs */}
            <div className="modal-sub-tabs">
              <button
                type="button"
                className={`modal-sub-tab ${bulkPasteTab === "options" ? "active" : ""}`}
                onClick={() => setBulkPasteTab("options")}
              >
                <FileText size={14} /> Options Only
              </button>
              <button
                type="button"
                className={`modal-sub-tab ${bulkPasteTab === "smart" ? "active" : ""}`}
                onClick={() => setBulkPasteTab("smart")}
              >
                <Sparkles size={14} /> Smart Full Quiz (Question + Options + Answer)
              </button>
            </div>

            <textarea
              dir="auto"
              className="input custom-textarea"
              placeholder={
                bulkPasteTab === "smart"
                  ? `ما هي عاصمة فرنسا؟\nأ) باريس\nب) لندن\nج) روما\nد) مدريد\nالإجابة: أ\nالشرح: باريس هي عاصمة فرنسا وأكبر مدنها`
                  : `1. Apple\n2. Banana\n3. Orange\n4. Mango`
              }
              value={bulkPasteText}
              onChange={(e) => setBulkPasteText(e.target.value)}
              rows={8}
              style={{ fontSize: "0.88rem", fontFamily: "var(--font-body)", lineHeight: 1.5 }}
            />

            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 10 }}>
              <span style={{ fontSize: "0.78rem", color: "var(--clr-text-muted)" }}>
                Detected lines:{" "}
                <strong>
                  {bulkPasteText.split("\n").filter((l) => l.trim().length > 0).length}
                </strong>
              </span>

              <div style={{ display: "flex", gap: 8 }}>
                <button
                  className="btn btn-ghost btn-sm"
                  onClick={() => setShowBulkPasteModal(false)}
                >
                  Cancel
                </button>
                <button
                  className="btn btn-primary btn-sm"
                  onClick={handleBulkPasteApply}
                  disabled={!bulkPasteText.trim()}
                >
                  <Check size={14} /> {bulkPasteTab === "smart" ? "Parse & Populate Quiz" : "Apply to Options"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── Import From Library Modal ───────────────────────────────────────── */}
      {showImport && (
        <div className="modal-backdrop" onClick={() => setShowImport(false)}>
          <div className="modal-card modal-card-lg animate-fade-up" onClick={(e) => e.stopPropagation()}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <div className="modal-icon-badge">
                  <BookOpen size={20} style={{ color: "var(--clr-brand)" }} />
                </div>
                <h3 style={{ margin: 0, fontSize: "1.1rem" }}>Import from Quiz Library</h3>
              </div>
              <button
                className="btn btn-ghost btn-sm"
                onClick={() => setShowImport(false)}
                aria-label="Close modal"
              >
                <X size={16} />
              </button>
            </div>

            <input
              className="input"
              placeholder="Search library questions, tags, or options..."
              value={importSearch}
              onChange={(e) => setImportSearch(e.target.value)}
              style={{ fontSize: "0.86rem" }}
            />

            {importLoading ? (
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {[1, 2, 3].map((i) => (
                  <div key={i} className="skeleton" style={{ height: 64, borderRadius: 10 }} />
                ))}
              </div>
            ) : filteredTemplates.length === 0 ? (
              <div style={{ textAlign: "center", padding: "36px 0", color: "var(--clr-text-muted)" }}>
                <div style={{ fontSize: "2.4rem", marginBottom: 8 }}>📭</div>
                <div>{importSearch ? "No matches found." : "Your library is empty. Save some quizzes first."}</div>
              </div>
            ) : (
              <div className="import-list-stack">
                {filteredTemplates.map((tmpl) => (
                  <button
                    key={tmpl.id}
                    onClick={() => handleImportPick(tmpl)}
                    className="import-item-btn"
                  >
                    <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
                      <span
                        className={`badge ${tmpl.type === "QUIZ" ? "badge-brand" : "badge-accent"}`}
                        style={{ fontSize: "0.68rem" }}
                      >
                        {tmpl.type}
                      </span>
                      {tmpl.tags?.map((t) => (
                        <span key={t} className="badge badge-muted" style={{ fontSize: "0.64rem" }}>
                          #{t}
                        </span>
                      ))}
                    </div>
                    <div
                      dir="auto"
                      style={{
                        fontSize: "0.88rem",
                        fontWeight: 600,
                        color: "var(--clr-text-primary)",
                        textAlign: "left",
                      }}
                    >
                      {tmpl.question.slice(0, 120)}
                      {tmpl.question.length > 120 ? "…" : ""}
                    </div>
                    <div
                      style={{
                        marginTop: 4,
                        fontSize: "0.74rem",
                        color: "var(--clr-text-muted)",
                        display: "flex",
                        gap: 8,
                      }}
                    >
                      <span>{tmpl.options.length} options</span>
                      {tmpl.openPeriod && <span>· ⏱️ {tmpl.openPeriod}s</span>}
                      {tmpl.explanation && <span>· 💡 Explanation</span>}
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── Save to Library Modal ──────────────────────────────────────────── */}
      {showSaveModal && (
        <div className="modal-backdrop" onClick={() => setShowSaveModal(false)}>
          <div className="modal-card animate-fade-up" onClick={(e) => e.stopPropagation()}>
            <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
              <div className="modal-icon-badge">
                <Save size={20} style={{ color: "var(--clr-brand)" }} />
              </div>
              <div>
                <h3 style={{ margin: 0, fontSize: "1.08rem" }}>Save to Library</h3>
                <p dir="auto" style={{ margin: 0, fontSize: "0.8rem", color: "var(--clr-text-muted)", marginTop: 2 }}>
                  {question.slice(0, 60)}
                  {question.length > 60 ? "…" : ""}
                </p>
              </div>
            </div>

            <div>
              <label className="input-label" style={{ marginBottom: 8, display: "block" }}>
                📁 Add to Collection <span style={{ color: "var(--clr-text-muted)", fontWeight: 400 }}>(optional)</span>
              </label>

              {saveCollections.length === 0 ? (
                <div className="collection-empty-box">
                  No collections created yet. You can create collections in the Library tab.
                </div>
              ) : (
                <div className="collection-select-stack">
                  <button
                    type="button"
                    onClick={() => setSaveCollId("")}
                    className={`collection-choice-btn ${saveCollId === "" ? "active" : ""}`}
                  >
                    <span className="coll-emoji-slot">🚫</span>
                    <span style={{ fontSize: "0.86rem", fontWeight: saveCollId === "" ? 600 : 400 }}>
                      No Collection (Library Root)
                    </span>
                    {saveCollId === "" && <Check size={16} style={{ marginLeft: "auto", color: "var(--clr-brand)" }} />}
                  </button>

                  {saveCollections.map((c) => (
                    <button
                      key={c.id}
                      type="button"
                      onClick={() => setSaveCollId(c.id)}
                      className={`collection-choice-btn ${saveCollId === c.id ? "active" : ""}`}
                      style={{
                        borderColor: saveCollId === c.id ? c.color : undefined,
                        background: saveCollId === c.id ? `${c.color}15` : undefined,
                      }}
                    >
                      <span className="coll-emoji-slot" style={{ background: `${c.color}30` }}>
                        {c.emoji || "📁"}
                      </span>
                      <span style={{ fontSize: "0.86rem", fontWeight: saveCollId === c.id ? 600 : 400 }}>
                        {c.name}
                      </span>
                      {saveCollId === c.id && <Check size={16} style={{ marginLeft: "auto", color: c.color }} />}
                    </button>
                  ))}
                </div>
              )}
            </div>

            <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
              <button
                className="btn btn-ghost"
                onClick={() => {
                  setShowSaveModal(false);
                  setSaveCollId("");
                }}
              >
                Cancel
              </button>
              <button
                className="btn btn-primary"
                onClick={doSaveTemplate}
                disabled={savingTemplate}
              >
                {savingTemplate ? "Saving…" : saveCollId ? "💾 Save to Collection" : "💾 Save to Library"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Embedded Scoped CSS Styles ──────────────────────────────────────── */}
      <style jsx>{`
        .quiz-new-container {
          width: 100%;
          max-width: 1280px;
          margin: 0 auto;
          padding-bottom: 90px;
        }

        .toast-dismiss-btn {
          background: none;
          border: none;
          color: inherit;
          cursor: pointer;
          padding: 2px 6px;
          opacity: 0.7;
          display: flex;
          align-items: center;
          justify-content: center;
        }

        .toast-dismiss-btn:hover {
          opacity: 1;
        }

        .header-action-group {
          display: flex;
          gap: 8px;
          flex-wrap: wrap;
          align-items: center;
        }

        .header-btn {
          border: 1px solid var(--clr-border);
          font-size: 0.82rem;
          min-height: 38px;
          padding: 6px 14px;
          display: inline-flex;
          align-items: center;
          gap: 6px;
        }

        .send-btn-desktop {
          font-size: 0.88rem;
          min-height: 40px;
          padding: 8px 18px;
          font-weight: 600;
          box-shadow: 0 4px 16px rgba(99, 102, 241, 0.35);
          display: inline-flex;
          align-items: center;
          gap: 6px;
        }

        .btn-dimmed {
          opacity: 0.85;
        }

        /* Draft banner */
        .draft-banner {
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 12px 18px;
          margin-bottom: 20px;
          background: rgba(99, 102, 241, 0.12);
          border: 1px solid rgba(99, 102, 241, 0.35);
          border-radius: var(--radius-md);
          backdrop-filter: blur(10px);
          gap: 12px;
        }

        /* Validation status bar */
        .validation-bar {
          display: flex;
          align-items: center;
          gap: 10px;
          padding: 10px 16px;
          margin-bottom: 20px;
          background: rgba(245, 158, 11, 0.12);
          border: 1px solid rgba(245, 158, 11, 0.3);
          border-radius: var(--radius-md);
          color: var(--clr-text-primary);
        }

        /* Mobile View Tabs */
        .mobile-view-tabs {
          display: none;
          grid-template-columns: 1fr 1fr 1fr;
          gap: 4px;
          margin-bottom: 16px;
          background: var(--clr-bg-surface);
          padding: 4px;
          border-radius: var(--radius-md);
          border: 1px solid var(--clr-border);
        }

        .mobile-tab-btn {
          position: relative;
          background: transparent;
          border: none;
          color: var(--clr-text-muted);
          padding: 10px;
          border-radius: 8px;
          font-size: 0.84rem;
          font-weight: 600;
          cursor: pointer;
          transition: all 0.15s ease;
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 6px;
        }

        .mobile-tab-btn.active {
          background: var(--clr-brand);
          color: #ffffff;
          box-shadow: 0 2px 8px rgba(99, 102, 241, 0.35);
        }

        .tab-error-dot {
          width: 7px;
          height: 7px;
          border-radius: 50%;
          background: var(--clr-warning);
        }

        .tab-active-dot {
          width: 7px;
          height: 7px;
          border-radius: 50%;
          background: var(--clr-success);
        }

        /* Studio 2-Column Grid */
        .quiz-studio-layout {
          display: grid;
          grid-template-columns: 1fr 390px;
          gap: 24px;
          align-items: start;
        }

        .quiz-builder-col {
          display: flex;
          flex-direction: column;
          gap: 20px;
        }

        .quiz-sidebar-col {
          display: flex;
          flex-direction: column;
          gap: 20px;
          position: sticky;
          top: calc(var(--header-height) + 16px);
        }

        /* Type cards */
        .type-toggle-grid {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 12px;
        }

        .type-card-btn {
          display: flex;
          align-items: center;
          gap: 12px;
          padding: 14px;
          background: var(--clr-bg-elevated);
          border: 1px solid var(--clr-border);
          border-radius: var(--radius-md);
          cursor: pointer;
          transition: all 0.2s ease;
          text-align: left;
        }

        .type-card-btn:hover {
          border-color: var(--clr-brand);
          background: var(--clr-bg-hover);
        }

        .type-card-btn.selected {
          border-color: var(--clr-brand);
          background: rgba(99, 102, 241, 0.12);
          box-shadow: inset 0 0 0 1px var(--clr-brand);
        }

        .type-card-icon {
          font-size: 1.5rem;
          width: 40px;
          height: 40px;
          border-radius: 10px;
          background: rgba(255, 255, 255, 0.05);
          display: flex;
          align-items: center;
          justify-content: center;
          flex-shrink: 0;
        }

        .type-card-title {
          font-size: 0.92rem;
          font-weight: 700;
          color: var(--clr-text-primary);
        }

        .type-card-desc {
          font-size: 0.74rem;
          color: var(--clr-text-muted);
          line-height: 1.3;
        }

        .type-card-check {
          color: var(--clr-brand);
          flex-shrink: 0;
        }

        /* Quick presets */
        .presets-pill-list {
          display: flex;
          flex-wrap: wrap;
          gap: 8px;
        }

        .preset-chip {
          background: var(--clr-bg-elevated);
          border: 1px solid var(--clr-border);
          border-radius: var(--radius-full);
          padding: 5px 12px;
          font-size: 0.78rem;
          color: var(--clr-text-secondary);
          cursor: pointer;
          transition: all 0.15s ease;
          display: inline-flex;
          align-items: center;
          gap: 5px;
        }

        .preset-chip:hover {
          border-color: var(--clr-brand);
          color: var(--clr-text-primary);
          background: rgba(99, 102, 241, 0.1);
        }

        .preset-chip-sub {
          color: var(--clr-text-muted);
          font-size: 0.7rem;
        }

        /* Char counters */
        .char-count-pill {
          font-size: 0.72rem;
          font-weight: 600;
          color: var(--clr-text-muted);
          padding: 2px 8px;
          background: var(--clr-bg-elevated);
          border-radius: var(--radius-full);
          border: 1px solid var(--clr-border);
        }

        .count-warn {
          color: var(--clr-warning) !important;
          border-color: rgba(245, 158, 11, 0.4);
        }

        .count-danger {
          color: var(--clr-danger) !important;
          border-color: rgba(244, 63, 94, 0.4);
        }

        .char-progress-bar {
          height: 3px;
          background: rgba(255, 255, 255, 0.06);
          border-radius: 2px;
          margin-top: 6px;
          overflow: hidden;
        }

        .char-progress-fill {
          height: 100%;
          background: var(--clr-brand);
          transition: width 0.15s ease;
        }

        .fill-warn {
          background: var(--clr-warning) !important;
        }

        .fill-danger {
          background: var(--clr-danger) !important;
        }

        /* Options list */
        .step-count-pill {
          font-size: 0.78rem;
          font-weight: 700;
          padding: 4px 10px;
          background: var(--clr-bg-elevated);
          border: 1px solid var(--clr-border);
          border-radius: var(--radius-full);
          color: var(--clr-text-secondary);
        }

        .quiz-hint-banner {
          display: flex;
          align-items: center;
          gap: 8px;
          font-size: 0.78rem;
          color: var(--clr-text-muted);
          background: var(--clr-bg-elevated);
          padding: 8px 12px;
          border-radius: var(--radius-md);
          margin-bottom: 12px;
          border: 1px solid var(--clr-border);
        }

        .options-stack {
          display: flex;
          flex-direction: column;
          gap: 10px;
        }

        .option-editor-row {
          display: flex;
          align-items: center;
          gap: 10px;
          padding: 4px;
          border-radius: var(--radius-md);
          transition: all 0.15s ease;
        }

        .option-editor-row.row-correct {
          background: rgba(16, 185, 129, 0.05);
        }

        .option-editor-row.row-duplicate {
          background: rgba(244, 63, 94, 0.05);
        }

        .option-check-btn {
          width: 32px;
          height: 32px;
          border-radius: 50%;
          border: 2px solid var(--clr-border);
          background: transparent;
          cursor: pointer;
          display: flex;
          align-items: center;
          justify-content: center;
          flex-shrink: 0;
          transition: all 0.15s ease;
        }

        .option-check-btn:hover {
          border-color: var(--clr-success);
          background: rgba(16, 185, 129, 0.1);
        }

        .option-check-btn.selected {
          border-color: var(--clr-success);
          background: var(--clr-success);
          color: #ffffff;
          box-shadow: 0 0 10px rgba(16, 185, 129, 0.5);
        }

        .option-letter-badge {
          width: 32px;
          height: 32px;
          border-radius: 50%;
          background: var(--clr-bg-elevated);
          border: 1px solid var(--clr-border);
          display: flex;
          align-items: center;
          justify-content: center;
          font-size: 0.8rem;
          font-weight: 700;
          color: var(--clr-text-muted);
          flex-shrink: 0;
        }

        .option-input-field {
          font-size: 0.92rem;
          padding-right: 70px;
        }

        .border-success {
          border-color: var(--clr-success) !important;
          background: rgba(16, 185, 129, 0.03);
        }

        .border-danger {
          border-color: var(--clr-danger) !important;
          background: rgba(244, 63, 94, 0.04);
        }

        .option-badge-warning {
          position: absolute;
          right: 8px;
          top: 50%;
          transform: translateY(-50%);
          font-size: 0.72rem;
          font-weight: 600;
          color: var(--clr-danger);
          background: rgba(244, 63, 94, 0.1);
          padding: 2px 6px;
          border-radius: 4px;
        }

        .option-len-tag {
          position: absolute;
          right: 8px;
          top: 50%;
          transform: translateY(-50%);
          font-size: 0.7rem;
          font-weight: 600;
          padding: 1px 5px;
          border-radius: 4px;
          background: var(--clr-bg-surface);
        }

        .len-warn {
          color: var(--clr-warning);
        }

        .len-danger {
          color: var(--clr-danger);
        }

        .option-row-actions {
          display: flex;
          align-items: center;
          gap: 4px;
          flex-shrink: 0;
        }

        .option-action-btn {
          width: 30px;
          height: 30px;
          display: flex;
          align-items: center;
          justify-content: center;
          background: var(--clr-bg-elevated);
          border: 1px solid var(--clr-border);
          border-radius: 6px;
          color: var(--clr-text-muted);
          cursor: pointer;
          transition: all 0.15s ease;
        }

        .option-action-btn:hover:not(:disabled) {
          border-color: var(--clr-text-secondary);
          color: var(--clr-text-primary);
        }

        .option-action-btn:disabled {
          opacity: 0.3;
          cursor: not-allowed;
        }

        .option-action-btn.delete-btn:hover:not(:disabled) {
          border-color: var(--clr-danger);
          color: var(--clr-danger);
          background: rgba(244, 63, 94, 0.1);
        }

        .options-footer-actions {
          display: flex;
          gap: 8px;
          margin-top: 14px;
        }

        /* Settings side box */
        .setting-group-box {
          margin-bottom: 16px;
        }

        .setting-label-header {
          display: block;
          font-size: 0.76rem;
          font-weight: 700;
          color: var(--clr-text-muted);
          text-transform: uppercase;
          letter-spacing: 0.05em;
          margin-bottom: 6px;
        }

        .mode-pill-toggle {
          display: flex;
          background: rgba(255, 255, 255, 0.06);
          border-radius: 6px;
          padding: 2px;
          gap: 2px;
        }

        .mode-pill-btn {
          border: none;
          background: transparent;
          color: var(--clr-text-muted);
          padding: 2px 8px;
          border-radius: 5px;
          font-size: 0.72rem;
          font-weight: 600;
          cursor: pointer;
          transition: all 0.15s ease;
        }

        .mode-pill-btn.active {
          background: var(--clr-brand);
          color: #ffffff;
        }

        .image-preview-thumb {
          position: relative;
          margin-top: 8px;
          height: 100px;
          border-radius: 8px;
          overflow: hidden;
          background: rgba(0, 0, 0, 0.3);
          border: 1px solid var(--clr-border);
        }

        .image-preview-thumb img {
          width: 100%;
          height: 100%;
          object-fit: cover;
          display: block;
        }

        .thumb-remove-btn {
          position: absolute;
          top: 6px;
          right: 6px;
          background: rgba(0, 0, 0, 0.7);
          border: none;
          color: #ffffff;
          width: 22px;
          height: 22px;
          border-radius: 50%;
          display: flex;
          align-items: center;
          justify-content: center;
          cursor: pointer;
        }

        .topic-notice-box {
          padding: 8px 12px;
          background: rgba(245, 158, 11, 0.08);
          border: 1px solid rgba(245, 158, 11, 0.25);
          border-radius: 8px;
          font-size: 0.78rem;
          color: var(--clr-text-muted);
        }

        .manual-topic-drawer {
          display: flex;
          flex-direction: column;
          gap: 8px;
          padding: 10px;
          background: var(--clr-bg-elevated);
          border-radius: 8px;
          border: 1px solid var(--clr-border);
          margin-top: 8px;
        }

        .tags-input-container {
          display: flex;
          flex-wrap: wrap;
          gap: 6px;
          padding: 6px 8px;
          border: 1px solid var(--clr-border);
          border-radius: var(--radius-md);
          background: var(--clr-bg-base);
          min-height: 38px;
          align-items: center;
        }

        .tag-pill {
          display: flex;
          align-items: center;
          gap: 4px;
          padding: 2px 8px;
          font-size: 0.74rem;
        }

        .tag-remove-x {
          background: none;
          border: none;
          color: inherit;
          cursor: pointer;
          font-size: 0.7rem;
          padding: 0;
          display: flex;
          align-items: center;
          opacity: 0.8;
        }

        .tag-remove-x:hover {
          opacity: 1;
        }

        .tag-text-input {
          border: none;
          background: transparent;
          outline: none;
          flex: 1;
          min-width: 80px;
          font-size: 0.82rem;
          color: var(--clr-text-primary);
        }

        /* Toggle rows */
        .toggle-row {
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 10px 0;
          cursor: pointer;
          border-bottom: 1px solid rgba(255, 255, 255, 0.04);
        }

        .toggle-row-title {
          font-size: 0.85rem;
          font-weight: 500;
          color: var(--clr-text-primary);
        }

        .toggle-row-sub {
          font-size: 0.72rem;
          color: var(--clr-text-muted);
        }

        .quiz-rules-note {
          padding: 8px 10px;
          background: rgba(99, 102, 241, 0.08);
          border-radius: 6px;
          font-size: 0.74rem;
          color: var(--clr-text-muted);
          margin: 6px 0;
        }

        .timer-config-drawer {
          background: var(--clr-bg-elevated);
          padding: 10px;
          border-radius: 8px;
          border: 1px solid var(--clr-border);
          margin-top: 6px;
        }

        .timer-chip-grid {
          display: grid;
          grid-template-columns: repeat(4, 1fr);
          gap: 4px;
        }

        .timer-chip {
          padding: 4px 6px;
          border-radius: 6px;
          border: 1px solid var(--clr-border);
          background: var(--clr-bg-surface);
          color: var(--clr-text-secondary);
          font-size: 0.72rem;
          cursor: pointer;
          text-align: center;
          transition: all 0.15s ease;
        }

        .timer-chip.active {
          border-color: var(--clr-brand);
          background: rgba(99, 102, 241, 0.2);
          color: #ffffff;
          font-weight: 600;
        }

        /* ── Simulated Telegram Mockup ── */
        .preview-card-wrapper {
          background: var(--clr-bg-surface);
          border-radius: var(--radius-lg);
          border: 1px solid var(--clr-border);
          padding: 18px;
        }

        .preview-topic-pill {
          display: inline-flex;
          align-items: center;
          gap: 6px;
          padding: 3px 8px;
          background: var(--clr-bg-elevated);
          border-radius: var(--radius-full);
          font-size: 0.74rem;
          color: var(--clr-text-secondary);
          margin-bottom: 10px;
          border: 1px solid var(--clr-border);
        }

        .tg-mockup-phone {
          background: #182232;
          border-radius: 14px;
          padding: 14px;
          border: 1px solid rgba(255, 255, 255, 0.08);
          box-shadow: 0 10px 30px rgba(0, 0, 0, 0.4);
        }

        .tg-bubble-header {
          display: flex;
          align-items: center;
          gap: 8px;
          margin-bottom: 10px;
        }

        .tg-avatar-circle {
          width: 32px;
          height: 32px;
          border-radius: 50%;
          background: linear-gradient(135deg, #2aabee 0%, #229ed9 100%);
          display: flex;
          align-items: center;
          justify-content: center;
          font-size: 1rem;
          flex-shrink: 0;
        }

        .tg-bot-name {
          font-size: 0.82rem;
          font-weight: 700;
          color: #e5edf8;
        }

        .tg-bot-badge {
          font-size: 0.62rem;
          background: rgba(42, 171, 238, 0.25);
          color: #64bdf3;
          padding: 1px 4px;
          border-radius: 3px;
          font-weight: 600;
        }

        .tg-bot-handle {
          font-size: 0.68rem;
          color: #7286a0;
        }

        .tg-timestamp {
          margin-left: auto;
          font-size: 0.68rem;
          color: #5c6e86;
        }

        .tg-bubble-media {
          border-radius: 10px;
          overflow: hidden;
          margin-bottom: 10px;
          max-height: 140px;
          width: 100%;
          background: #0f1622;
        }

        .tg-bubble-media img {
          width: 100%;
          height: 100%;
          object-fit: cover;
          display: block;
        }

        .tg-bubble-body {
          background: #232e42;
          border-radius: 12px;
          padding: 14px;
          border: 1px solid rgba(255, 255, 255, 0.05);
        }

        .tg-bubble-type-tag {
          font-size: 0.68rem;
          font-weight: 700;
          color: #64bdf3;
          margin-bottom: 6px;
          text-transform: uppercase;
          letter-spacing: 0.04em;
        }

        .tg-bubble-question {
          font-size: 0.94rem;
          font-weight: 600;
          color: #f0f5fc;
          margin-bottom: 12px;
          line-height: 1.4;
          word-break: break-word;
        }

        .tg-options-group {
          display: flex;
          flex-direction: column;
          gap: 6px;
        }

        .tg-bubble-option {
          position: relative;
          display: flex;
          align-items: center;
          gap: 10px;
          padding: 9px 12px;
          border-radius: 8px;
          background: rgba(255, 255, 255, 0.06);
          border: 1px solid rgba(255, 255, 255, 0.04);
          cursor: pointer;
          color: #dbe4f0;
          font-size: 0.86rem;
          transition: all 0.15s ease;
          text-align: left;
          width: 100%;
          overflow: hidden;
        }

        .tg-bubble-option:hover {
          background: rgba(255, 255, 255, 0.1);
        }

        .tg-bubble-option.reveal-correct {
          background: rgba(16, 185, 129, 0.2) !important;
          border-color: rgba(16, 185, 129, 0.5) !important;
          color: #34d399 !important;
        }

        .tg-bubble-option.reveal-wrong {
          background: rgba(244, 63, 94, 0.2) !important;
          border-color: rgba(244, 63, 94, 0.5) !important;
          color: #f87171 !important;
        }

        .tg-vote-bar {
          position: absolute;
          left: 0;
          top: 0;
          bottom: 0;
          background: rgba(42, 171, 238, 0.18);
          border-radius: 7px;
          transition: width 0.3s cubic-bezier(0.16, 1, 0.3, 1);
          pointer-events: none;
        }

        .tg-vote-bar.bar-correct {
          background: rgba(16, 185, 129, 0.25);
        }

        .tg-vote-bar.bar-wrong {
          background: rgba(244, 63, 94, 0.25);
        }

        .tg-opt-radio {
          display: flex;
          align-items: center;
          justify-content: center;
          flex-shrink: 0;
          z-index: 2;
        }

        .tg-radio-circle {
          width: 16px;
          height: 16px;
          border-radius: 50%;
          border: 2px solid #5a7090;
          display: inline-block;
          transition: all 0.15s ease;
        }

        .tg-radio-circle.checked {
          border-color: #2aabee;
          background: #2aabee;
          box-shadow: inset 0 0 0 3px #232e42;
        }

        .tg-checkbox-box {
          width: 16px;
          height: 16px;
          border-radius: 4px;
          border: 2px solid #5a7090;
          display: flex;
          align-items: center;
          justify-content: center;
          font-size: 0.7rem;
          color: transparent;
        }

        .tg-checkbox-box.checked {
          border-color: #2aabee;
          background: #2aabee;
          color: #ffffff;
        }

        .tg-opt-text {
          flex: 1;
          word-break: break-word;
          z-index: 2;
        }

        .tg-explanation-wrapper {
          margin-top: 10px;
        }

        .tg-bulb-btn {
          background: none;
          border: none;
          color: #64bdf3;
          font-size: 0.76rem;
          cursor: pointer;
          padding: 2px 0;
          display: flex;
          align-items: center;
          gap: 4px;
        }

        .tg-bubble-explanation {
          margin-top: 6px;
          padding: 10px;
          background: rgba(255, 255, 255, 0.04);
          border-radius: 8px;
          font-size: 0.78rem;
          color: #9ab0ce;
          display: flex;
          align-items: flex-start;
          gap: 8px;
          line-height: 1.4;
          border: 1px solid rgba(255, 255, 255, 0.06);
        }

        .tg-bubble-footer {
          margin-top: 10px;
          display: flex;
          justify-content: space-between;
          align-items: center;
          color: #647a96;
        }

        .tg-footer-pill {
          font-size: 0.66rem;
          background: rgba(255, 255, 255, 0.05);
          padding: 2px 6px;
          border-radius: 4px;
        }

        /* Fixed Mobile Bar */
        .mobile-action-bar {
          display: none;
          position: fixed;
          bottom: 0;
          left: 0;
          right: 0;
          background: rgba(14, 19, 31, 0.95);
          backdrop-filter: blur(16px);
          border-top: 1px solid var(--clr-border);
          padding: 10px 16px;
          padding-bottom: max(10px, env(safe-area-inset-bottom));
          z-index: 900;
          align-items: center;
          gap: 12px;
        }

        .mobile-send-btn {
          min-height: 44px;
          padding: 0 18px;
          font-weight: 700;
          white-space: nowrap;
          display: inline-flex;
          align-items: center;
          gap: 6px;
        }

        /* Modal Styles */
        .modal-backdrop {
          position: fixed;
          inset: 0;
          z-index: 1100;
          background: rgba(0, 0, 0, 0.7);
          backdrop-filter: blur(8px);
          display: flex;
          align-items: center;
          justify-content: center;
          padding: 16px;
        }

        .modal-card {
          background: var(--clr-bg-surface);
          border: 1px solid var(--clr-border);
          border-radius: var(--radius-lg);
          padding: 24px;
          width: 100%;
          max-width: 500px;
          box-shadow: 0 24px 64px rgba(0, 0, 0, 0.6);
          display: flex;
          flex-direction: column;
          gap: 16px;
        }

        .modal-card-lg {
          max-width: 640px;
          max-height: 85vh;
        }

        .modal-icon-badge {
          width: 44px;
          height: 44px;
          border-radius: 12px;
          background: var(--clr-brand-muted);
          display: flex;
          align-items: center;
          justify-content: center;
          font-size: 1.4rem;
          flex-shrink: 0;
        }

        .modal-sub-tabs {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 4px;
          background: var(--clr-bg-elevated);
          padding: 3px;
          border-radius: 8px;
          border: 1px solid var(--clr-border);
        }

        .modal-sub-tab {
          border: none;
          background: transparent;
          color: var(--clr-text-muted);
          padding: 8px;
          border-radius: 6px;
          font-size: 0.78rem;
          font-weight: 600;
          cursor: pointer;
          transition: all 0.15s ease;
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 6px;
        }

        .modal-sub-tab.active {
          background: var(--clr-brand);
          color: #ffffff;
        }

        .import-list-stack {
          overflow-y: auto;
          display: flex;
          flex-direction: column;
          gap: 8px;
          max-height: 380px;
        }

        .import-item-btn {
          background: var(--clr-bg-elevated);
          border: 1px solid var(--clr-border);
          border-radius: 10px;
          padding: 12px;
          cursor: pointer;
          transition: border-color 0.15s ease;
          width: 100%;
        }

        .import-item-btn:hover {
          border-color: var(--clr-brand);
        }

        .collection-select-stack {
          display: flex;
          flex-direction: column;
          gap: 6px;
          max-height: 240px;
          overflow-y: auto;
        }

        .collection-choice-btn {
          display: flex;
          align-items: center;
          gap: 10px;
          padding: 8px 12px;
          background: var(--clr-bg-elevated);
          border: 1px solid var(--clr-border);
          border-radius: 8px;
          cursor: pointer;
          color: var(--clr-text-secondary);
          transition: all 0.15s ease;
          width: 100%;
        }

        .collection-choice-btn.active {
          border-color: var(--clr-brand);
          color: var(--clr-text-primary);
        }

        .coll-emoji-slot {
          width: 28px;
          height: 28px;
          border-radius: 6px;
          display: flex;
          align-items: center;
          justify-content: center;
          font-size: 0.95rem;
        }

        .collection-empty-box {
          padding: 10px 14px;
          background: var(--clr-bg-elevated);
          border-radius: 8px;
          font-size: 0.82rem;
          color: var(--clr-text-muted);
        }

        /* Spinner icon */
        .spinner-icon {
          display: inline-block;
          width: 14px;
          height: 14px;
          border: 2px solid rgba(255, 255, 255, 0.3);
          border-top-color: #ffffff;
          border-radius: 50%;
          animation: spin 0.6s linear infinite;
        }

        @keyframes spin {
          to {
            transform: rotate(360deg);
          }
        }

        /* ── Responsive Queries ────────────────────────────────────────────── */
        @media (max-width: 1024px) {
          .quiz-studio-layout {
            grid-template-columns: 1fr;
          }

          .mobile-view-tabs {
            display: grid;
          }

          .quiz-sidebar-col {
            position: static;
          }

          .mobile-hide {
            display: none !important;
          }

          .mobile-show {
            display: flex !important;
          }

          .mobile-hide-card {
            display: none !important;
          }

          .mobile-action-bar {
            display: flex;
          }

          .header-btn {
            font-size: 0.78rem;
            padding: 5px 10px;
          }

          .send-btn-desktop {
            display: none;
          }
        }

        @media (max-width: 640px) {
          .type-toggle-grid {
            grid-template-columns: 1fr;
          }

          .timer-chip-grid {
            grid-template-columns: repeat(2, 1fr);
          }

          .option-input-field {
            font-size: 0.88rem;
          }

          .modal-sub-tabs {
            grid-template-columns: 1fr;
          }
        }
      `}</style>
    </div>
  );
}
