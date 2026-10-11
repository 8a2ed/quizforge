"use client";

import { useState, useEffect, useMemo, useRef } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { useDirection } from "@/lib/useDirection";
import {
  Sparkles,
  BookOpen,
  BarChart3,
  Settings,
  Upload,
  FileText,
  CheckCircle2,
  AlertTriangle,
  Send,
  Save,
  GraduationCap,
  Plus,
  Trash2,
  RefreshCw,
  Eye,
  Copy,
  Clock,
  ShieldCheck,
  Check,
  ChevronRight,
  ChevronLeft,
  X,
  FileCheck,
  Key,
  Users,
  Layers,
  HelpCircle,
  TrendingUp,
  Pencil,
  Edit3,
} from "lucide-react";
import { isBrowserExtractable, extractMaterialInBrowser, getPdfPageCount, parsePageRange, splitIntoSections } from "@/lib/browserTextExtractor";

interface CurriculumMaterial {
  id: string;
  groupId: string;
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
  topics: string[];
  sections: Array<{ id: string; title: string; content: string; wordCount: number }>;
  uploadedBy: {
    id: string;
    name: string;
    username?: string;
    photoUrl?: string;
  };
  ocrUsed?: boolean;
  digitalFallback?: boolean;
  createdAt: string;
  updatedAt?: string;
}

interface ValidatedQuestion {
  id: string;
  question: string;
  options: string[];
  correctOptionId: number;
  explanation: string;
  difficulty: "EASY" | "MEDIUM" | "HARD";
  topic: string;
  bloomTaxonomy: string;
  groundingQuote: string;
  isValid: boolean;
  errors: string[];
}

interface AnalyticsData {
  totalGenerations: number;
  totalQuestions: number;
  totalTokens: number;
  activeUsersCount: number;
  studentParticipants?: number;
  averageScore?: number;
  passRate?: number;
  broadcastedQuizzesCount?: number;
  examsCreatedCount?: number;
  userLeaderboard: Array<{
    userId: string;
    userName: string;
    userUsername?: string;
    userPhoto?: string;
    generationsCount: number;
    questionsCount: number;
    lastActive: string;
  }>;
  materialsUsage: Array<{
    materialTitle: string;
    generationsCount: number;
    questionsCount: number;
  }>;
  difficultyBreakdown: {
    EASY: number;
    MEDIUM: number;
    HARD: number;
  };
  recentLogs: Array<{
    id: string;
    userName: string;
    materialTitle: string;
    questionCount: number;
    modelUsed: string;
    difficulty: string;
    timestamp: string;
    estimatedTokens: number;
  }>;
}

interface AISettings {
  geminiApiKey?: string;
  maskedApiKey?: string;
  hasApiKey: boolean;
  defaultModel: string;
  defaultDifficulty: "mixed" | "easy" | "medium" | "hard";
  defaultCount: number;
  strictGrounding: boolean;
  systemInstruction?: string;
}

interface TelegramTopic {
  message_thread_id: number;
  name: string;
  icon_color?: number;
}

function isValidApiKey(k?: string | null): boolean {
  if (!k) return false;
  const trimmed = String(k).trim();
  if (trimmed.length < 20) return false;
  if (trimmed.includes("••••") || trimmed.includes("•")) return false;
  if (trimmed.includes("...") || trimmed.includes("…")) return false;
  if (trimmed.includes("***") || trimmed.includes("*")) return false;
  if (trimmed === "undefined" || trimmed === "null") return false;
  return true;
}

function getUserMaterialsFromStorage(gid: string): CurriculumMaterial[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(`qf_user_materials_${gid}`);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) return parsed;
    }
  } catch {}
  return [];
}

function saveUserMaterialsToStorage(gid: string, mats: CurriculumMaterial[]) {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(`qf_user_materials_${gid}`, JSON.stringify(mats));
  } catch (err) {
    console.warn("Could not write user materials to localStorage", err);
  }
}

export default function CurriculumPage() {
  const { groupId } = useParams<{ groupId: string }>();
  const router = useRouter();
  const { isRtl } = useDirection();

  // Active Tab: "generate" | "materials" | "analytics" | "settings"
  const [activeTab, setActiveTab] = useState<"generate" | "materials" | "analytics" | "settings">("generate");

  // Global State
  const [materials, setMaterials] = useState<CurriculumMaterial[]>([]);
  const [topics, setTopics] = useState<TelegramTopic[]>([]);
  const [analytics, setAnalytics] = useState<AnalyticsData | null>(null);
  const [settings, setSettings] = useState<AISettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [toast, setToast] = useState<{ type: "success" | "error" | "info"; msg: string } | null>(null);

  // ── Generation Tab State ──
  const [sourceMode, setSourceMode] = useState<"material" | "direct">("material");
  const [selectedMaterialId, setSelectedMaterialId] = useState<string>("");
  const [selectedSectionId, setSelectedSectionId] = useState<string>("");
  const [directText, setDirectText] = useState<string>("");
  const [directTitle, setDirectTitle] = useState<string>("");
  const [genCount, setGenCount] = useState<number>(5);
  const [genDifficulty, setGenDifficulty] = useState<"mixed" | "easy" | "medium" | "hard">("mixed");
  const [customInstructions, setCustomInstructions] = useState<string>("");
  const [generating, setGenerating] = useState(false);

  // Generated Questions & Workflow
  const [generatedQuestions, setGeneratedQuestions] = useState<ValidatedQuestion[]>([]);
  const [selectedQuestionIds, setSelectedQuestionIds] = useState<Set<string>>(new Set());
  const [generationMeta, setGenerationMeta] = useState<{
    modelUsed: string;
    tokens: number;
    durationMs: number;
    materialTitle: string;
  } | null>(null);

  // ── Upload Material State ──
  const [uploadMode, setUploadMode] = useState<"file" | "paste">("file");
  const [pastedText, setPastedText] = useState("");
  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const [uploadTitle, setUploadTitle] = useState("");
  const [uploadSubject, setUploadSubject] = useState("");
  const [uploadGrade, setUploadGrade] = useState("");
  const [uploadTopics, setUploadTopics] = useState("");
  const [forceOcr, setForceOcr] = useState(false);
  const [pdfPageCount, setPdfPageCount] = useState<number | null>(null);
  const [pageRange, setPageRange] = useState<string>("");
  const [readingPdfInfo, setReadingPdfInfo] = useState<boolean>(false);
  const [isDragging, setIsDragging] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadProgressStep, setUploadProgressStep] = useState<string>("");
  const [uploadProgressPercent, setUploadProgressPercent] = useState<number>(0);
  const [previewMaterial, setPreviewMaterial] = useState<CurriculumMaterial | null>(null);

  // Edit Material Modal State
  const [showEditModal, setShowEditModal] = useState(false);
  const [editingMaterial, setEditingMaterial] = useState<CurriculumMaterial | null>(null);
  const [editTitle, setEditTitle] = useState("");
  const [editSubject, setEditSubject] = useState("");
  const [editGrade, setEditGrade] = useState("");
  const [editTopics, setEditTopics] = useState("");
  const [editText, setEditText] = useState("");
  const [editSections, setEditSections] = useState<Array<{ id: string; title: string; content: string; wordCount: number }>>([]);
  const [activeEditTab, setActiveEditTab] = useState<"info" | "text" | "sections">("info");
  const [savingEdit, setSavingEdit] = useState(false);

  // ── Modals State ──
  // Exam Modal
  const [showExamModal, setShowExamModal] = useState(false);
  const [examTitle, setExamTitle] = useState("");
  const [examTimeLimit, setExamTimeLimit] = useState(15); // mins
  const [examPassingScore, setExamPassingScore] = useState(60);
  const [creatingExam, setCreatingExam] = useState(false);

  // Broadcast Modal
  const [showBroadcastModal, setShowBroadcastModal] = useState(false);
  const [broadcastTopicId, setBroadcastTopicId] = useState<number | undefined>(undefined);
  const [broadcastOpenPeriod, setBroadcastOpenPeriod] = useState<number>(0);
  const [broadcastAnonymous, setBroadcastAnonymous] = useState<boolean>(true);
  const [broadcastScheduledAt, setBroadcastScheduledAt] = useState<string>("");
  const [broadcasting, setBroadcasting] = useState(false);

  // Settings Tab State
  const [apiKeyInput, setApiKeyInput] = useState("");
  const [showApiKey, setShowApiKey] = useState(false);
  const [testingKey, setTestingKey] = useState(false);
  const [testResult, setTestResult] = useState<{
    success: boolean;
    message: string;
    activeModel?: string;
    fallbackUsed?: boolean;
  } | null>(null);
  const [savingSettings, setSavingSettings] = useState(false);
  const [availableModels, setAvailableModels] = useState<Array<{ id: string; name: string; displayName?: string }>>([]);
  const [isCustomModel, setIsCustomModel] = useState<boolean>(false);
  const [detectingModels, setDetectingModels] = useState<boolean>(false);

  // Helper Toast
  const showToast = (type: "success" | "error" | "info", msg: string) => {
    setToast({ type, msg });
    setTimeout(() => setToast(null), 4500);
  };

  // ── Fetch Initial Data ──
  const loadMaterials = async () => {
    try {
      const res = await fetch(`/api/groups/${groupId}/curriculum/materials`);
      const resText = await res.text();
      let d: any = null;
      try {
        d = resText ? JSON.parse(resText) : null;
      } catch {}

      const localUserMats = getUserMaterialsFromStorage(groupId);

      if (res.ok && d) {
        const loaded: CurriculumMaterial[] = d.materials || [];
        // Merge user materials with server materials so custom uploads are never wiped on serverless resets
        const mergedMap = new Map<string, CurriculumMaterial>();
        for (const m of localUserMats) {
          mergedMap.set(m.id, m);
        }
        for (const m of loaded) {
          if (!mergedMap.has(m.id)) {
            mergedMap.set(m.id, m);
          }
        }
        const merged = Array.from(mergedMap.values());
        setMaterials(merged);

        // Auto-sync any client-side materials that the server/database is missing
        const serverIds = new Set(loaded.map((m: any) => m.id));
        const missingOnServer = localUserMats.filter((m: any) => !serverIds.has(m.id));
        if (missingOnServer.length > 0) {
          for (const mat of missingOnServer) {
            fetch(`/api/groups/${groupId}/curriculum/materials`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(mat),
            }).catch((e) => console.warn("[curriculum] auto-sync failed:", e));
          }
        }
        try {
          const lightweight = merged.map((m: any) => ({
            id: m.id,
            groupId: m.groupId,
            title: m.title,
            subject: m.subject,
            grade: m.grade,
            fileName: m.fileName,
            fileType: m.fileType,
            fileSize: m.fileSize,
            wordCount: m.wordCount,
            charCount: m.charCount,
            topics: m.topics || [],
            sections: (m.sections || []).map((s: any) => ({ id: s.id, title: s.title, wordCount: s.wordCount })),
            uploadedBy: m.uploadedBy,
            ocrUsed: m.ocrUsed,
            createdAt: m.createdAt,
          }));
          localStorage.setItem(`qf_materials_${groupId}`, JSON.stringify(lightweight));
        } catch {}
        if (merged.length > 0) {
          setSelectedMaterialId((prev) => {
            if (prev && merged.some((m: any) => m.id === prev)) return prev;
            return merged[0].id;
          });
        }
      } else {
        // Fallback to local user materials + cached
        const mergedMap = new Map<string, CurriculumMaterial>();
        for (const m of localUserMats) mergedMap.set(m.id, m);
        try {
          const cached = localStorage.getItem(`qf_materials_${groupId}`);
          if (cached) {
            const parsed = JSON.parse(cached);
            if (Array.isArray(parsed)) {
              for (const m of parsed) {
                if (!mergedMap.has(m.id)) mergedMap.set(m.id, m);
              }
            }
          }
        } catch {}
        const fallbackList = Array.from(mergedMap.values());
        if (fallbackList.length > 0) {
          setMaterials(fallbackList);
          setSelectedMaterialId((prev) => {
            if (prev && fallbackList.some((m: any) => m.id === prev)) return prev;
            return fallbackList[0].id;
          });
        }
      }
    } catch (e) {
      console.error(e);
      const localUserMats = getUserMaterialsFromStorage(groupId);
      if (localUserMats.length > 0) {
        setMaterials(localUserMats);
      }
    }
  };

  const loadAnalytics = async () => {
    try {
      const res = await fetch(`/api/groups/${groupId}/curriculum/analytics`);
      const resText = await res.text();
      let d: any = null;
      try {
        d = resText ? JSON.parse(resText) : null;
      } catch {}

      if (res.ok && d) {
        setAnalytics(d.analytics);
      }
    } catch (e) {
      console.error(e);
    }
  };

  const loadSettings = async () => {
    try {
      const res = await fetch(`/api/groups/${groupId}/curriculum/settings`);
      const resText = await res.text();
      let d: any = null;
      try {
        d = resText ? JSON.parse(resText) : null;
      } catch {}

      if (res.ok && d) {
        setSettings(d.settings);
        if (d.settings?.defaultCount) setGenCount(d.settings.defaultCount);
        if (d.settings?.defaultDifficulty) setGenDifficulty(d.settings.defaultDifficulty);

        const localKey = typeof window !== "undefined" ? localStorage.getItem("gemini_api_key") : null;
        const serverKey = d.settings?.geminiApiKey;

        const validServerKey = isValidApiKey(serverKey) ? serverKey!.trim() : null;
        const validLocalKey = isValidApiKey(localKey) ? localKey!.trim() : null;
        const activeKey = validServerKey || validLocalKey;

        if (activeKey) {
          setApiKeyInput(activeKey);
          try { localStorage.setItem("gemini_api_key", activeKey); } catch {}
          if (!d.settings?.hasApiKey && validLocalKey) {
            fetch(`/api/groups/${groupId}/curriculum/settings`, {
              method: "PATCH",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ geminiApiKey: validLocalKey }),
            })
              .then(async (r) => {
                const txt = await r.text();
                try { return JSON.parse(txt); } catch { return null; }
              })
              .then((patchData) => {
                if (patchData?.settings) {
                  setSettings(patchData.settings);
                }
              })
              .catch(() => {});
          }
        }
      }

      // Also fetch group quiz settings to initialize default anonymous and timer
      try {
        const groupSettingsRes = await fetch(`/api/groups/${groupId}/settings`);
        const groupSettingsData = await groupSettingsRes.json();
        if (groupSettingsData?.config) {
          if (typeof groupSettingsData.config.defaultAnonymous === "boolean") {
            setBroadcastAnonymous(groupSettingsData.config.defaultAnonymous);
          }
          if (typeof groupSettingsData.config.defaultOpenPeriod === "number") {
            setBroadcastOpenPeriod(groupSettingsData.config.defaultOpenPeriod);
          }
        }
      } catch {}
    } catch (e) {
      console.error(e);
    }
  };

  const loadTopics = async () => {
    try {
      const res = await fetch(`/api/groups/${groupId}/topics`);
      const resText = await res.text();
      let d: any = null;
      try {
        d = resText ? JSON.parse(resText) : null;
      } catch {}

      if (res.ok && d) {
        setTopics(d.topics || []);
      }
    } catch (e) {
      console.error(e);
    }
  };

  useEffect(() => {
    setLoading(true);
    // Optimistically load persistent user materials + cached materials from localStorage for instant render
    try {
      const localUserMats = getUserMaterialsFromStorage(groupId);
      const cached = localStorage.getItem(`qf_materials_${groupId}`);
      const mergedMap = new Map<string, CurriculumMaterial>();
      for (const m of localUserMats) mergedMap.set(m.id, m);
      if (cached) {
        const parsed = JSON.parse(cached);
        if (Array.isArray(parsed)) {
          for (const m of parsed) {
            if (!mergedMap.has(m.id)) mergedMap.set(m.id, m);
          }
        }
      }
      const initialList = Array.from(mergedMap.values());
      if (initialList.length > 0) {
        setMaterials(initialList);
        setSelectedMaterialId(initialList[0].id);
      }
    } catch {}

    Promise.all([loadMaterials(), loadAnalytics(), loadSettings(), loadTopics()]).finally(() => {
      setLoading(false);
    });
  }, [groupId]);

  // Current selected material object
  const currentMaterial = useMemo(() => {
    return materials.find((m) => m.id === selectedMaterialId) || null;
  }, [materials, selectedMaterialId]);

  // ── Action: Generate Questions ──
  const handleGenerate = async () => {
    if (sourceMode === "material" && !selectedMaterialId) {
      showToast("error", isRtl ? "يرجى اختيار مادة دراسية أولاً" : "Please select a study material");
      return;
    }
    if (sourceMode === "direct" && !directText.trim()) {
      showToast("error", isRtl ? "يرجى كتابة أو لصق نص المنهج" : "Please enter curriculum text");
      return;
    }

    setGenerating(true);
    try {
      const payload: any = {
        questionCount: genCount,
        difficulty: genDifficulty,
        customInstructions: customInstructions.trim(),
        model: settings?.defaultModel || "gemini-3.8-flash",
      };

      const localKey = typeof window !== "undefined" ? localStorage.getItem("gemini_api_key") : null;
      const keyToSend = (isValidApiKey(apiKeyInput) ? apiKeyInput.trim() : null) || (isValidApiKey(localKey) ? localKey!.trim() : null);
      if (keyToSend) {
        payload.apiKey = keyToSend;
      }

      if (sourceMode === "material") {
        payload.materialId = selectedMaterialId;
        if (selectedSectionId) payload.sectionId = selectedSectionId;
        if (currentMaterial) {
          payload.fallbackMaterial = {
            id: currentMaterial.id,
            groupId: currentMaterial.groupId,
            title: currentMaterial.title,
            cleanedText: currentMaterial.cleanedText,
            rawText: currentMaterial.rawText,
            sections: currentMaterial.sections,
            subject: currentMaterial.subject,
            grade: currentMaterial.grade,
            topics: currentMaterial.topics,
            fileName: currentMaterial.fileName,
            fileType: currentMaterial.fileType,
            fileSize: currentMaterial.fileSize,
            wordCount: currentMaterial.wordCount,
            charCount: currentMaterial.charCount,
            uploadedBy: currentMaterial.uploadedBy,
            createdAt: currentMaterial.createdAt,
            updatedAt: currentMaterial.updatedAt,
          };
        }
      } else {
        payload.customText = directText.trim();
        payload.materialTitle = directTitle.trim() || (isRtl ? "نص دراسي مباشر" : "Direct Curriculum Text");
      }

      const res = await fetch(`/api/groups/${groupId}/curriculum/generate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      const resText = await res.text();
      let data: any = null;
      try {
        data = resText ? JSON.parse(resText) : {};
      } catch {
        data = null;
      }

      if (!res.ok) {
        if (res.status === 413 || (resText && resText.toLowerCase().includes("request entity too large"))) {
          throw new Error(
            isRtl
              ? "حجم المنهج أو النص المرسل كبير جداً (Request Entity Too Large). يرجى اختيار فصل أو قسم أصغر لتوليد الأسئلة."
              : "Payload too large. Please select a smaller section."
          );
        }
        if (res.status === 504 || res.status === 408 || (resText && resText.toLowerCase().includes("timeout"))) {
          throw new Error(
            isRtl
              ? "استغرقت عملية التوليد وقتاً طويلاً وتجاوزت مهلة الخادم (Timeout). يرجى المحاولة مع عدد أسئلة أقل."
              : "Generation timed out. Please try fewer questions."
          );
        }
        if (data?.missingKey) {
          showToast("error", data.error);
          setActiveTab("settings");
          return;
        }
        const errorMsg =
          data?.error ||
          (resText && resText.length < 200 && !resText.includes("<html")
            ? resText
            : isRtl
            ? `فشل توليد الأسئلة (رمز الخطأ: ${res.status})`
            : `Failed to generate questions (${res.status})`);
        throw new Error(errorMsg);
      }

      const questions: ValidatedQuestion[] = data.questions || [];
      setGeneratedQuestions(questions);
      // Select all by default
      setSelectedQuestionIds(new Set(questions.map((q) => q.id)));
      setGenerationMeta({
        modelUsed: data.modelUsed,
        tokens: data.estimatedTokens,
        durationMs: data.durationMs,
        materialTitle: data.materialTitle,
      });

      // If backend auto-upgraded the model due to deprecation fallback, sync local UI state
      if (data.modelUsed && settings && data.modelUsed !== settings.defaultModel) {
        setSettings((prev) => (prev ? { ...prev, defaultModel: data.modelUsed } : null));
        if (data.fallbackUsed) {
          showToast(
            "info",
            isRtl
              ? `تم ترقية النموذج تلقائياً إلى (${data.modelUsed}) لأن النموذج القديم لم يعد مدعوماً`
              : `Model auto-upgraded to (${data.modelUsed})`
          );
        }
      }

      // Refresh analytics in background
      loadAnalytics();

      showToast(
        "success",
        isRtl
          ? `تم توليد ${questions.length} سؤال بنجاح بدون هلوسة ومعتمدة على المنهج!`
          : `Generated ${questions.length} zero-hallucination questions successfully!`
      );
    } catch (e: any) {
      showToast("error", e.message || "Error generating questions");
    } finally {
      setGenerating(false);
    }
  };

  // ── Inline Edit Question Handlers ──
  const updateQuestionField = (qId: string, field: keyof ValidatedQuestion, val: any) => {
    setGeneratedQuestions((prev) =>
      prev.map((q) => (q.id === qId ? { ...q, [field]: val } : q))
    );
  };

  const updateOptionText = (qId: string, optIndex: number, text: string) => {
    setGeneratedQuestions((prev) =>
      prev.map((q) => {
        if (q.id !== qId) return q;
        const newOpts = [...q.options];
        newOpts[optIndex] = text;
        return { ...q, options: newOpts };
      })
    );
  };

  const addOption = (qId: string) => {
    setGeneratedQuestions((prev) =>
      prev.map((q) => {
        if (q.id !== qId || q.options.length >= 10) return q;
        return { ...q, options: [...q.options, isRtl ? `خيار إضافي ${q.options.length + 1}` : `Option ${q.options.length + 1}`] };
      })
    );
  };

  const removeOption = (qId: string, optIndex: number) => {
    setGeneratedQuestions((prev) =>
      prev.map((q) => {
        if (q.id !== qId || q.options.length <= 2) return q;
        const newOpts = q.options.filter((_, idx) => idx !== optIndex);
        let newCorrect = q.correctOptionId;
        if (newCorrect === optIndex) newCorrect = 0;
        else if (newCorrect > optIndex) newCorrect -= 1;
        return { ...q, options: newOpts, correctOptionId: newCorrect };
      })
    );
  };

  const deleteQuestion = (qId: string) => {
    setGeneratedQuestions((prev) => prev.filter((q) => q.id !== qId));
    setSelectedQuestionIds((prev) => {
      const next = new Set(prev);
      next.delete(qId);
      return next;
    });
  };

  // Selection toggles
  const toggleSelectQuestion = (qId: string) => {
    setSelectedQuestionIds((prev) => {
      const next = new Set(prev);
      if (next.has(qId)) next.delete(qId);
      else next.add(qId);
      return next;
    });
  };

  const toggleSelectAll = () => {
    if (selectedQuestionIds.size === generatedQuestions.length) {
      setSelectedQuestionIds(new Set());
    } else {
      setSelectedQuestionIds(new Set(generatedQuestions.map((q) => q.id)));
    }
  };

  const selectedQuestions = useMemo(() => {
    return generatedQuestions.filter((q) => selectedQuestionIds.has(q.id));
  }, [generatedQuestions, selectedQuestionIds]);

  // ── Action: Save to Library ──
  const handleSaveToLibrary = async () => {
    if (selectedQuestions.length === 0) {
      showToast("error", isRtl ? "يرجى تحديد سؤال واحد على الأقل" : "Please select at least one question");
      return;
    }

    try {
      const res = await fetch(`/api/groups/${groupId}/curriculum/save-library`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ questions: selectedQuestions }),
      });
      const resText = await res.text();
      let data: any = null;
      try { data = JSON.parse(resText); } catch {}
      if (!res.ok) throw new Error(data?.error || "Failed to save");

      showToast("success", isRtl ? `تم حفظ ${data?.count || selectedQuestions.length} سؤال في بنك الأسئلة والمكتبة!` : `Saved ${data?.count || selectedQuestions.length} questions to library!`);
    } catch (e: any) {
      showToast("error", e.message || "Failed to save");
    }
  };

  // ── Action: Create Full Exam ──
  const handleOpenExamModal = () => {
    if (selectedQuestions.length === 0) {
      showToast("error", isRtl ? "يرجى تحديد سؤال واحد على الأقل" : "Select questions first");
      return;
    }
    const defaultName = generationMeta?.materialTitle
      ? `${isRtl ? "اختبار: " : "Exam: "}${generationMeta.materialTitle}`
      : `${isRtl ? "اختبار منهج دراسي" : "Curriculum Exam"} - ${new Date().toLocaleDateString()}`;
    setExamTitle(defaultName);
    setShowExamModal(true);
  };

  const handleCreateExam = async () => {
    if (!examTitle.trim()) {
      showToast("error", isRtl ? "يرجى إدخال عنوان الاختبار" : "Enter exam title");
      return;
    }
    setCreatingExam(true);
    try {
      const res = await fetch(`/api/groups/${groupId}/curriculum/create-exam`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: examTitle.trim(),
          description: isRtl ? "تم توليد هذا الاختبار بواسطة QuizForge AI من المنهج الدراسي بدقة متناهية." : "Generated via QuizForge AI.",
          questions: selectedQuestions,
          timeLimit: examTimeLimit * 60,
          passingScore: examPassingScore,
        }),
      });
      const resText = await res.text();
      let data: any = null;
      try { data = JSON.parse(resText); } catch {}
      if (!res.ok) throw new Error(data?.error || "Failed to create exam");

      setShowExamModal(false);
      showToast("success", isRtl ? "تم إنشاء الاختبار الإلكتروني بنجاح! يمكنك فتحه الآن من قسم الاختبارات." : "Exam created successfully!");
    } catch (e: any) {
      showToast("error", e.message || "Failed to create exam");
    } finally {
      setCreatingExam(false);
    }
  };

  // ── Action: Broadcast to Telegram ──
  const handleBroadcast = async () => {
    if (selectedQuestions.length === 0) return;
    setBroadcasting(true);
    try {
      const res = await fetch(`/api/groups/${groupId}/curriculum/broadcast`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          questions: selectedQuestions,
          topicId: broadcastTopicId,
          isAnonymous: broadcastAnonymous,
          openPeriod: broadcastOpenPeriod,
          scheduledAt: broadcastScheduledAt ? new Date(broadcastScheduledAt).toISOString() : undefined,
        }),
      });
      const resText = await res.text();
      let data: any = null;
      try { data = JSON.parse(resText); } catch {}
      if (!res.ok) throw new Error(data?.error || "Failed to broadcast");

      setShowBroadcastModal(false);
      showToast(
        "success",
        data?.message || (
          isRtl
            ? `تمت معالجة ${data?.successCount || selectedQuestions.length} سؤال بنجاح!`
            : `Processed ${data?.successCount || selectedQuestions.length} questions successfully!`
        )
      );
    } catch (e: any) {
      showToast("error", e.message || "Failed to broadcast");
    } finally {
      setBroadcasting(false);
    }
  };

  // ── Action: Copy Formatted Text ──
  const handleCopyText = () => {
    if (selectedQuestions.length === 0) return;
    const text = selectedQuestions
      .map((q, idx) => {
        const opts = q.options.map((o, oIdx) => `${String.fromCharCode(65 + oIdx)}. ${o}`).join("\n");
        return `سؤال ${idx + 1}: ${q.question}\n${opts}\nالإجابة الصحيحة: ${String.fromCharCode(65 + q.correctOptionId)}\nالشرح: ${q.explanation}\n`;
      })
      .join("\n---\n\n");

    navigator.clipboard.writeText(text);
    showToast("info", isRtl ? "تم نسخ الأسئلة المحددة إلى الحافظة!" : "Copied to clipboard!");
  };

  // ── Action: Upload Material ──
  const handleUploadMaterial = async (e: React.FormEvent) => {
    e.preventDefault();
    const activeFile =
      uploadMode === "paste"
        ? pastedText.trim()
          ? new File(
              [pastedText.trim()],
              `${(uploadTitle || "curriculum_notes").trim().replace(/[/\\?%*:|"<>]/g, "_")}.txt`,
              { type: "text/plain" }
            )
          : null
        : uploadFile;

    if (!activeFile) {
      showToast(
        "error",
        uploadMode === "paste"
          ? (isRtl ? "يرجى لصق نص المنهج أو الفصل (20 حرفاً على الأقل)" : "Please paste curriculum text")
          : (isRtl ? "يرجى اختيار ملف" : "Select a file")
      );
      return;
    }

    if (uploadMode === "paste" && pastedText.trim().length < 20) {
      showToast(
        "error",
        isRtl ? "نص المنهج قصير جداً. يرجى لصق نص كافٍ (20 حرفاً على الأقل)" : "Text is too short"
      );
      return;
    }

    // Client-side file size guard: college textbooks over 50MB should warn user early
    if (activeFile.size > 50 * 1024 * 1024) {
      showToast(
        "error",
        isRtl
          ? "حجم الملف كبير جداً (أكثر من 50 ميجابايت). يرجى تقليل حجم الكتاب أو ضغطه أو تقسيمه لضمان المعالجة السليمة."
          : "File size exceeds 50MB. Please upload a smaller file."
      );
      return;
    }

    const sizeMb = (activeFile.size / (1024 * 1024)).toFixed(1);
    const localKey = typeof window !== "undefined" ? localStorage.getItem("gemini_api_key") : null;
    const keyToSend = (isValidApiKey(apiKeyInput) ? apiKeyInput.trim() : null) || (isValidApiKey(localKey) ? localKey!.trim() : null);

    // Architectural solution for Vercel 4.5MB Serverless Function payload limit:
    // Extract clean text & chapters directly in the browser using native Web APIs.
    // For scanned PDFs without text layers, automatically slices pages into offscreen canvas batches
    // and processes them sequentially with Gemini multimodal chunk OCR.
    const canExtractInBrowser = isBrowserExtractable(activeFile);
    const isLargeFile = activeFile.size >= 3.5 * 1024 * 1024;
    const shouldUseBrowserExtraction = canExtractInBrowser;

    if (shouldUseBrowserExtraction) {
      setUploading(true);
      setUploadProgressPercent(15);
      setUploadProgressStep(
        uploadMode === "paste"
          ? (isRtl ? "⚡ جاري تقسيم وفهرسة نصوص المنهج..." : "⚡ Indexing curriculum sections...")
          : (isRtl
              ? "⚡ جاري قراءة واستخراج فصول الكتاب في المتصفح..."
              : "⚡ Reading and extracting textbook chapters in browser...")
      );

      let extracted: any = null;
      try {
        const customTopicsList = uploadTopics
          .split(",")
          .map((t) => t.trim())
          .filter(Boolean);

        extracted = await extractMaterialInBrowser(activeFile, {
          groupId,
          apiKey: keyToSend || undefined,
          forceOcr: uploadMode === "paste" ? false : forceOcr,
          pageRange: uploadMode === "paste" ? undefined : pageRange.trim() || undefined,
          title: uploadTitle.trim(),
          subject: uploadSubject.trim() || (isRtl ? "عام" : "General"),
          grade: uploadGrade.trim(),
          customTopics: customTopicsList,
          onProgress: (step, pct) => {
            setUploadProgressStep(step);
            setUploadProgressPercent(pct);
          },
        });
      } catch (browserErr: any) {
        const errMsg = browserErr?.message || "";
        const isPasswordErr = /password|كلمة مرور|محمي/i.test(errMsg);
        const isMissingKeyErr = /Google Gemini API Key/i.test(errMsg);
        // If file is smaller than 3.5MB, not forced OCR, and not an unrecoverable password/key error, gracefully fall back to server multipart upload
        if (!isLargeFile && !forceOcr && !isPasswordErr && !isMissingKeyErr) {
          console.warn(
            "[ClientExtractor] Browser extraction error on file < 3.5MB, falling back to server multipart:",
            browserErr
          );
          extracted = null;
        } else {
          // Large file (or scanned/OCR PDF, or password protected) cannot bypass Vercel 4.5MB limit via multipart
          setUploading(false);
          setUploadProgressPercent(0);
          setUploadProgressStep("");
          showToast(
            "error",
            browserErr?.message || (isRtl ? "فشل استخراج ملف الكتاب" : "Failed to extract textbook")
          );
          return;
        }
      }

      if (extracted) {
        setUploadProgressPercent(70);
        setUploadProgressStep(
          isRtl
            ? "🚀 جاري حفظ وتجهيز المنهج..."
            : "🚀 Saving and indexing curriculum..."
        );

        try {
          const payload: any = {
            ...extracted,
          };
          if (keyToSend) {
            payload.apiKey = keyToSend;
          }

          const res = await fetch(`/api/groups/${groupId}/curriculum/materials`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload),
          });

          const resText = await res.text();
          let data: any = null;
          try {
            data = JSON.parse(resText);
          } catch {}

          if (!res.ok) {
            throw new Error(
              data?.error || (isRtl ? "فشل حفظ وتجهيز المنهج" : "Failed to save curriculum")
            );
          }

          setUploadProgressPercent(100);
          setUploadProgressStep(
            isRtl
              ? "✅ تم استخراج الكتاب بنجاح!"
              : "✅ Textbook extracted successfully!"
          );

          // Reset form
          setUploadFile(null);
          setPastedText("");
          setPdfPageCount(null);
          setPageRange("");
          setUploadTitle("");
          setUploadSubject("");
          setUploadGrade("");
          setUploadTopics("");
          setForceOcr(false);

          if (data?.material) {
            const newMat = data.material;
            const currentStored = getUserMaterialsFromStorage(groupId);
            saveUserMaterialsToStorage(groupId, [newMat, ...currentStored.filter((m) => m.id !== newMat.id)]);
            setMaterials((prev) => [newMat, ...prev.filter((m) => m.id !== newMat.id)]);
            setSelectedMaterialId(newMat.id);
          } else if (data?.material?.id) {
            setSelectedMaterialId(data.material.id);
          }

          await loadMaterials();

          const successMsg =
            data?.notice ||
            data?.message ||
            (isRtl
              ? "✅ تم استخراج الكتاب وحفظ المنهج بنجاح!"
              : "✅ Textbook extracted and saved successfully!");
          showToast("success", successMsg);
          return;
        } catch (serverErr: any) {
          showToast(
            "error",
            serverErr?.message || (isRtl ? "فشل حفظ المنهج على الخادم" : "Failed to save curriculum")
          );
          return;
        } finally {
          // ALWAYS reset uploading state regardless of file size!
          setUploading(false);
          setTimeout(() => {
            setUploadProgressPercent(0);
            setUploadProgressStep("");
          }, 2500);
        }
      }
    }

    setUploading(true);
    setUploadProgressPercent(10);
    setUploadProgressStep(
      isRtl
        ? `جاري رفع الكتاب (${sizeMb} ميجابايت)...`
        : `Uploading textbook (${sizeMb} MB)...`
    );

    let progressTimer: NodeJS.Timeout | null = null;

    try {
      const formData = new FormData();
      formData.append("file", activeFile);
      formData.append("title", uploadTitle.trim());
      formData.append("subject", uploadSubject.trim() || (isRtl ? "عام" : "General"));
      formData.append("grade", uploadGrade.trim());
      formData.append("topics", uploadTopics.trim());
      formData.append("forceOcr", String(forceOcr));
      if (pageRange.trim()) {
        formData.append("pageRange", pageRange.trim());
      }

      if (keyToSend) {
        formData.append("apiKey", keyToSend);
      }

      // Track live XHR upload progress
      const res = await new Promise<{ ok: boolean; status: number; text: string }>((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhr.open("POST", `/api/groups/${groupId}/curriculum/materials`);
        xhr.timeout = 300000; // 5 minutes

        xhr.upload.onprogress = (event) => {
          if (event.lengthComputable && event.total > 0) {
            const fraction = event.loaded / event.total;
            const pct = Math.min(65, Math.max(10, Math.round(fraction * 65)));
            const uploadedMb = (event.loaded / (1024 * 1024)).toFixed(1);
            setUploadProgressPercent(pct);
            setUploadProgressStep(
              isRtl
                ? `جاري رفع الكتاب (${uploadedMb} / ${sizeMb} ميجابايت)...`
                : `Uploading textbook (${uploadedMb} / ${sizeMb} MB)...`
            );
          }
        };

        xhr.upload.onload = () => {
          setUploadProgressPercent(75);
          setUploadProgressStep(
            isRtl
              ? "جاري قراءة واستخراج الفصول ونصوص الكتاب..."
              : "Reading and extracting textbook sections and chapters..."
          );

          // Incremental feedback while server parses sections
          let elapsedSec = 0;
          progressTimer = setInterval(() => {
            elapsedSec += 3;
            if (elapsedSec >= 6 && elapsedSec < 15) {
              setUploadProgressPercent(85);
              setUploadProgressStep(
                isRtl
                  ? "جاري تنظيم الفصول والتعرف على الموضوعات التعليمية..."
                  : "Structuring chapters and indexing topics..."
              );
            } else if (elapsedSec >= 15) {
              setUploadProgressPercent(92);
              setUploadProgressStep(
                isRtl
                  ? "جاري تدقيق النصوص وحفظ المنهج في المكتبة..."
                  : "Finalizing text parsing and indexing curriculum..."
              );
            }
          }, 3000);
        };

        xhr.onload = () => {
          if (progressTimer) clearInterval(progressTimer);
          resolve({
            ok: xhr.status >= 200 && xhr.status < 300,
            status: xhr.status,
            text: xhr.responseText,
          });
        };

        xhr.onerror = () => {
          if (progressTimer) clearInterval(progressTimer);
          reject(new Error(isRtl ? "فشل الاتصال بالخادم أثناء رفع الملف" : "Network connection failed during upload"));
        };

        xhr.ontimeout = () => {
          if (progressTimer) clearInterval(progressTimer);
          resolve({
            ok: false,
            status: 504,
            text: "Request timeout after 5 minutes",
          });
        };

        xhr.send(formData);
      });

      if (progressTimer) clearInterval(progressTimer);

      const resText = res.text;
      let data: any = null;
      try {
        data = resText ? JSON.parse(resText) : {};
      } catch {
        data = null;
      }

      if (!res.ok) {
        if (res.status === 413 || (resText && resText.toLowerCase().includes("request entity too large"))) {
          const isFileReallyOver50Mb = activeFile.size > 50 * 1024 * 1024;
          if (isFileReallyOver50Mb) {
            throw new Error(
              data?.error ||
              (isRtl
                ? `حجم الملف (${sizeMb} ميجابايت) تجاوز الحد الأقصى المسموح به للخادم (50 ميجابايت). يُرجى تقليل حجم الملف أو تقسيمه.`
                : `File size (${sizeMb} MB) exceeded server limits (413 Request Entity Too Large). Maximum supported size is 50MB.`)
            );
          } else {
            // File is <= 50MB (e.g. 22.1MB), so display actual server message or fallback
            throw new Error(
              data?.error ||
              (resText && resText.length < 300 && !resText.includes("<html")
                ? resText
                : isRtl
                ? `تعذر تحليل وقراءة الملف (${sizeMb} ميجابايت). يرجى التأكد من أن الملف سليم ويحتوي على نصوص واضحة.`
                : `Failed to process document (${sizeMb} MB).`)
            );
          }
        }
        if (res.status === 504 || res.status === 408 || (resText && resText.toLowerCase().includes("timeout"))) {
          throw new Error(
            isRtl
              ? "استغرقت معالجة واستخراج نصوص الكتاب وقتاً طويلاً وتجاوزت مهلة الخادم (5 دقائق). يرجى تقليل حجم الملف أو تقسيمه."
              : "Processing timed out after 5 minutes. Please try splitting the document."
          );
        }
        const errorMsg =
          data?.error ||
          (resText && resText.length < 200 && !resText.includes("<html")
            ? resText
            : isRtl
            ? `فشل رفع وتحليل الكتاب (رمز الخطأ: ${res.status})`
            : `Upload failed (${res.status})`);
        throw new Error(errorMsg);
      }

      setUploadProgressPercent(100);
      setUploadProgressStep(isRtl ? "تمت المعالجة بنجاح!" : "Processed successfully!");

      // Reset form
      setUploadFile(null);
      setPdfPageCount(null);
      setPageRange("");
      setUploadTitle("");
      setUploadSubject("");
      setUploadGrade("");
      setUploadTopics("");
      setForceOcr(false);

      if (data?.material) {
        const newMat = data.material;
        const currentStored = getUserMaterialsFromStorage(groupId);
        saveUserMaterialsToStorage(groupId, [newMat, ...currentStored.filter((m) => m.id !== newMat.id)]);
        setMaterials((prev) => [newMat, ...prev.filter((m) => m.id !== newMat.id)]);
        setSelectedMaterialId(newMat.id);
      } else if (data?.material?.id) {
        setSelectedMaterialId(data.material.id);
      }

      await loadMaterials();

      const successMsg =
        data?.notice ||
        data?.message ||
        (isRtl
          ? "تم رفع المنهج الدراسي واستخراج النصوص بنجاح وحفظه في المكتبة!"
          : "Uploaded and saved material successfully!");
      showToast("success", successMsg);
    } catch (e: any) {
      if (progressTimer) clearInterval(progressTimer);
      setUploadProgressPercent(0);
      setUploadProgressStep("");
      showToast("error", e.message || (isRtl ? "فشل رفع الملف" : "Upload failed"));
    } finally {
      if (progressTimer) clearInterval(progressTimer);
      setUploading(false);
      setTimeout(() => {
        setUploadProgressPercent(0);
        setUploadProgressStep("");
      }, 2500);
    }
  };

  const handleDeleteMaterial = async (id: string) => {
    if (!confirm(isRtl ? "هل أنت متأكد من حذف هذه المادة الدراسية؟" : "Delete this material?")) return;
    try {
      const currentStored = getUserMaterialsFromStorage(groupId);
      saveUserMaterialsToStorage(groupId, currentStored.filter((m) => m.id !== id));
      setMaterials((prev) => prev.filter((m) => m.id !== id));
      if (selectedMaterialId === id) {
        setSelectedMaterialId("");
      }

      const res = await fetch(`/api/groups/${groupId}/curriculum/materials/${id}`, {
        method: "DELETE",
      });
      if (res.ok) {
        await loadMaterials();
        showToast("info", isRtl ? "تم حذف المادة بنجاح" : "Material deleted");
      }
    } catch (e) {
      console.error(e);
    }
  };

  // ── Action: Open Edit Material Modal ──
  const handleOpenEditModal = (mat: CurriculumMaterial) => {
    setEditingMaterial(mat);
    setEditTitle(mat.title || "");
    setEditSubject(mat.subject || "");
    setEditGrade(mat.grade || "");
    setEditTopics(Array.isArray(mat.topics) ? mat.topics.join(", ") : "");
    setEditText(mat.cleanedText || mat.rawText || "");
    setEditSections(
      Array.isArray(mat.sections) && mat.sections.length > 0
        ? mat.sections.map((s, idx) => ({
            id: s.id || `sec-${idx + 1}`,
            title: s.title || `القسم ${idx + 1}`,
            content: s.content || "",
            wordCount: s.wordCount || 0,
          }))
        : []
    );
    setActiveEditTab("info");
    setShowEditModal(true);
  };

  const handleAddEditSection = () => {
    setEditSections((prev) => [
      ...prev,
      {
        id: `sec-${Date.now()}`,
        title: isRtl ? `فصل جديد ${prev.length + 1}` : `New Chapter ${prev.length + 1}`,
        content: "",
        wordCount: 0,
      },
    ]);
  };

  const handleUpdateEditSection = (index: number, field: "title" | "content", val: string) => {
    setEditSections((prev) => {
      const next = [...prev];
      if (!next[index]) return prev;
      const updated = { ...next[index], [field]: val };
      if (field === "content") {
        updated.wordCount = val ? val.split(/\s+/).filter(Boolean).length : 0;
      }
      next[index] = updated;
      return next;
    });
  };

  const handleRemoveEditSection = (index: number) => {
    setEditSections((prev) => prev.filter((_, idx) => idx !== index));
  };

  const handleAutoSplitEditSections = () => {
    if (!editText.trim()) {
      showToast("error", isRtl ? "نص المنهج فارغ، لا يمكن تقسيمه" : "Curriculum text is empty");
      return;
    }
    const generated = splitIntoSections(editText.trim());
    if (generated.length === 0) {
      showToast("info", isRtl ? "لم يتم العثور على عناوين فصول مميزة، تم الاحتفاظ بالتقسيم الحالي" : "No distinct chapter headers found");
      return;
    }
    setEditSections(generated);
    showToast("success", isRtl ? `تم تقسيم وتنسيق ${generated.length} فصول بنجاح من النص!` : `Auto-split into ${generated.length} sections!`);
  };

  const handleSaveEdit = async () => {
    if (!editingMaterial) return;
    if (!editTitle.trim()) {
      showToast("error", isRtl ? "عنوان المنهج أو الكتاب مطلوب" : "Title is required");
      return;
    }

    let cleanedContent = editText.trim();
    if (!cleanedContent && editSections.length > 0) {
      cleanedContent = editSections
        .map((s) => s.content.trim())
        .filter(Boolean)
        .join("\n\n");
      setEditText(cleanedContent);
    }

    if (!cleanedContent) {
      showToast("error", isRtl ? "نص المنهج الدراسي لا يمكن أن يكون فارغاً" : "Text cannot be empty");
      return;
    }

    setSavingEdit(true);
    try {
      const topicsList = editTopics
        .split(",")
        .map((t) => t.trim())
        .filter(Boolean);

      const validSections = editSections
        .map((s, idx) => ({
          id: s.id || `sec-${idx + 1}`,
          title: s.title.trim() || `القسم ${idx + 1}`,
          content: s.content.trim(),
          wordCount: s.content ? s.content.split(/\s+/).filter(Boolean).length : 0,
        }))
        .filter((s) => s.content.length > 0);

      const payload = {
        title: editTitle.trim(),
        subject: editSubject.trim() || (isRtl ? "عام" : "General"),
        grade: editGrade.trim(),
        topics: topicsList,
        cleanedText: cleanedContent,
        rawText: cleanedContent,
        sections: validSections.length > 0 ? validSections : splitIntoSections(cleanedContent),
      };

      const res = await fetch(`/api/groups/${groupId}/curriculum/materials/${editingMaterial.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      const resText = await res.text();
      let data: any = null;
      try { data = JSON.parse(resText); } catch {}

      if (!res.ok) {
        throw new Error(data?.error || (isRtl ? "فشل حفظ وتحديث المنهج" : "Failed to update material"));
      }

      const updatedMat: CurriculumMaterial = data?.material || {
        ...editingMaterial,
        ...payload,
        wordCount: cleanedContent.split(/\s+/).filter(Boolean).length,
        charCount: cleanedContent.length,
        updatedAt: new Date().toISOString(),
      };

      // Synchronize with local storage and component state
      const currentStored = getUserMaterialsFromStorage(groupId);
      const updatedStored = [
        updatedMat,
        ...currentStored.filter((m) => m.id !== updatedMat.id && m.id !== editingMaterial.id),
      ];
      saveUserMaterialsToStorage(groupId, updatedStored);

      // Synchronize cached materials
      try {
        const cachedRaw = localStorage.getItem(`qf_materials_${groupId}`);
        if (cachedRaw) {
          const parsed = JSON.parse(cachedRaw);
          if (Array.isArray(parsed)) {
            const updatedCached = updatedMat.id !== editingMaterial.id
              ? [updatedMat, ...parsed]
              : parsed.map((m: any) => (m.id === editingMaterial.id ? updatedMat : m));
            localStorage.setItem(`qf_materials_${groupId}`, JSON.stringify(updatedCached));
          }
        }
      } catch {}

      setMaterials((prev) => {
        if (updatedMat.id !== editingMaterial.id) {
          return [updatedMat, ...prev];
        }
        return prev.map((m) => (m.id === editingMaterial.id ? updatedMat : m));
      });

      if (selectedMaterialId === editingMaterial.id || !selectedMaterialId) {
        setSelectedMaterialId(updatedMat.id);
      }

      setShowEditModal(false);
      setEditingMaterial(null);
      showToast("success", isRtl ? "تم حفظ وتحديث المنهج الدراسي بنجاح!" : "Curriculum updated successfully!");
    } catch (e: any) {
      showToast("error", e.message || (isRtl ? "فشل حفظ التعديلات" : "Failed to save edits"));
    } finally {
      setSavingEdit(false);
    }
  };

  // ── Action: Save & Test Settings ──
  const handleSaveSettings = async () => {
    setSavingSettings(true);
    try {
      const payload: any = {
        defaultModel: settings?.defaultModel
          ? settings.defaultModel.trim().replace(/^\/?models\//, "")
          : "gemini-3.8-flash",
        defaultDifficulty: settings?.defaultDifficulty || "mixed",
        defaultCount: settings?.defaultCount || 5,
        strictGrounding: settings?.strictGrounding ?? true,
        systemInstruction: settings?.systemInstruction || "",
      };
      const trimmedKey = apiKeyInput.trim();
      const isCandidateValid = isValidApiKey(trimmedKey);

      if (isCandidateValid) {
        payload.geminiApiKey = trimmedKey;
        try {
          localStorage.setItem("gemini_api_key", trimmedKey);
        } catch {}
      }

      const res = await fetch(`/api/groups/${groupId}/curriculum/settings`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      const resText = await res.text();
      let data: any = null;
      try { data = JSON.parse(resText); } catch {}
      if (!res.ok) throw new Error(data?.error || (isRtl ? `فشل حفظ الإعدادات (${res.status})` : "Failed to save settings"));

      setSettings(data.settings);
      if (data.settings?.geminiApiKey && isValidApiKey(data.settings.geminiApiKey)) {
        setApiKeyInput(data.settings.geminiApiKey);
        try { localStorage.setItem("gemini_api_key", data.settings.geminiApiKey); } catch {}
      } else if (payload.geminiApiKey) {
        setApiKeyInput(payload.geminiApiKey);
      }
      showToast("success", isRtl ? "تم حفظ إعدادات الذكاء الاصطناعي بنجاح!" : "AI Settings saved!");
    } catch (e: any) {
      showToast("error", e.message || "Failed to save settings");
    } finally {
      setSavingSettings(false);
    }
  };

  const handleTestConnection = async () => {
    setTestingKey(true);
    setTestResult(null);
    try {
      const localKey = typeof window !== "undefined" ? localStorage.getItem("gemini_api_key") : null;
      const keyToTest = (isValidApiKey(apiKeyInput) ? apiKeyInput.trim() : null) || (isValidApiKey(localKey) ? localKey!.trim() : undefined);

      const res = await fetch(`/api/groups/${groupId}/curriculum/settings/test`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          apiKey: keyToTest,
          model: settings?.defaultModel || "gemini-3.8-flash",
        }),
      });

      const resText = await res.text();
      let data: any = null;
      try { data = JSON.parse(resText); } catch {}

      if (!res.ok && !data) {
        throw new Error(isRtl ? `فشل فحص الاتصال (${res.status})` : "Connection check failed");
      }

      setTestResult({
        success: data?.success ?? false,
        message: data?.message || (data?.success ? "Connection OK" : "Failed"),
        activeModel: data?.activeModel,
        fallbackUsed: data?.fallbackUsed,
      });

      if (data?.availableModels && Array.isArray(data.availableModels) && data.availableModels.length > 0) {
        setAvailableModels(data.availableModels);
      }

      if (data?.success) {
        if (isValidApiKey(apiKeyInput)) {
          try {
            localStorage.setItem("gemini_api_key", apiKeyInput.trim());
          } catch {}
        }
        if (data.activeModel) {
          setSettings((prev) => (prev ? { ...prev, defaultModel: data.activeModel, hasApiKey: true } : null));
          if (data.fallbackUsed) {
            showToast(
              "info",
              isRtl
                ? `تم تحديث النموذج النشط تلقائياً إلى: ${data.activeModel}`
                : `Active model auto-updated to: ${data.activeModel}`
            );
          }
        }
      }
    } catch (e: any) {
      setTestResult({
        success: false,
        message: e.message || "Connection failed",
      });
    } finally {
      setTestingKey(false);
    }
  };

  const handleAutoDetectModels = async () => {
    setDetectingModels(true);
    try {
      const localKey = typeof window !== "undefined" ? localStorage.getItem("gemini_api_key") : null;
      const keyToUse = (isValidApiKey(apiKeyInput) ? apiKeyInput.trim() : null) || (isValidApiKey(localKey) ? localKey!.trim() : undefined);

      const res = await fetch(`/api/groups/${groupId}/curriculum/settings/test`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          apiKey: keyToUse,
          model: "gemini-3.8-flash",
          autoSave: true,
        }),
      });

      const resText = await res.text();
      let data: any = null;
      try { data = JSON.parse(resText); } catch {}

      setTestResult({
        success: data?.success ?? false,
        message: data?.message || (data?.success ? "Connection OK" : "Failed"),
        activeModel: data?.activeModel,
        fallbackUsed: data?.fallbackUsed,
      });

      if (data?.availableModels && Array.isArray(data.availableModels) && data.availableModels.length > 0) {
        setAvailableModels(data.availableModels);
      }

      if (data?.success && data?.activeModel) {
        setSettings((prev) => (prev ? { ...prev, defaultModel: data.activeModel, hasApiKey: true } : null));
        setIsCustomModel(false);
        showToast(
          "success",
          isRtl
            ? `تم اكتشاف وتعيين وحفظ النموذج النشط بنجاح: ${data.activeModel}`
            : `Detected, set & saved active model: ${data.activeModel}`
        );
      } else {
        showToast("error", data?.message || (isRtl ? "تعذر اكتشاف النماذج" : "Failed to detect models"));
      }
    } catch (e: any) {
      setTestResult({
        success: false,
        message: e.message || "Failed to detect models",
      });
      showToast("error", e.message || "Failed to detect models");
    } finally {
      setDetectingModels(false);
    }
  };

  return (
    <div style={{ maxWidth: 1240, margin: "0 auto", paddingBottom: 60 }}>
      {/* Toast notification */}
      {toast && (
        <div
          style={{
            position: "fixed",
            bottom: 24,
            left: isRtl ? 24 : "auto",
            right: isRtl ? "auto" : 24,
            zIndex: 9999,
            padding: "12px 20px",
            borderRadius: "var(--radius-md)",
            background:
              toast.type === "success"
                ? "rgba(16, 185, 129, 0.95)"
                : toast.type === "error"
                ? "rgba(244, 63, 94, 0.95)"
                : "rgba(99, 102, 241, 0.95)",
            color: "#fff",
            backdropFilter: "blur(12px)",
            boxShadow: "0 8px 32px rgba(0,0,0,0.4)",
            display: "flex",
            alignItems: "center",
            gap: 10,
            fontSize: "0.95rem",
            fontWeight: 500,
            animation: "fadeUp 0.3s var(--ease-out)",
          }}
        >
          {toast.type === "success" && <CheckCircle2 size={18} />}
          {toast.type === "error" && <AlertTriangle size={18} />}
          {toast.type === "info" && <HelpCircle size={18} />}
          <span>{toast.msg}</span>
        </div>
      )}

      {/* ── Top Header ── */}
      <div style={{ marginBottom: "var(--space-6)" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: 16 }}>
          <div>
            <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 6 }}>
              <div
                style={{
                  width: 40,
                  height: 40,
                  borderRadius: "var(--radius-md)",
                  background: "var(--grad-brand)",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  color: "#fff",
                  boxShadow: "0 0 20px var(--clr-brand-glow)",
                }}
              >
                <Sparkles size={22} />
              </div>
              <h1 style={{ fontSize: "1.75rem", fontWeight: 800, margin: 0 }}>
                {isRtl ? "توليد الأسئلة والامتحانات من المناهج" : "AI Curriculum & Exam Generator"}
              </h1>
              <span className="badge badge-brand" style={{ fontSize: "0.75rem" }}>
                Zero-Hallucination
              </span>
            </div>
            <p style={{ color: "var(--clr-text-secondary)", fontSize: "0.95rem", margin: 0 }}>
              {isRtl
                ? "نظام الذكاء الاصطناعي الأكاديمي لتوليد أسئلة مطابقة 100% لنصوص المذكرات والكتب بدون أخطاء أو تخريف، مع إمكانية الحفظ والبث المباشر."
                : "Generate strictly grounded curriculum MCQs from textbooks (PDF/Word/Text) with zero hallucinations and one-click Telegram export."}
            </p>
          </div>

          {/* Quick Metrics Header Pill */}
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 12,
              background: "var(--clr-bg-card)",
              padding: "8px 16px",
              borderRadius: "var(--radius-full)",
              border: "1px solid var(--clr-border)",
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: "0.85rem" }}>
              <ShieldCheck size={16} color="var(--clr-success)" />
              <span style={{ color: "var(--clr-text-secondary)" }}>
                {isRtl ? "النموذج:" : "Engine:"}
              </span>
              <strong style={{ color: "var(--clr-text-primary)" }}>
                {settings?.defaultModel || "gemini-3.8-flash"}
              </strong>
            </div>
            <div style={{ width: 1, height: 16, background: "var(--clr-border)" }} />
            <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: "0.85rem" }}>
              <BookOpen size={16} color="var(--clr-brand)" />
              <span style={{ color: "var(--clr-text-secondary)" }}>
                {isRtl ? "المناهج:" : "Materials:"}
              </span>
              <strong style={{ color: "var(--clr-text-primary)" }}>{materials.length}</strong>
            </div>
          </div>
        </div>

        {/* ── Navigation Tabs ── */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            marginTop: "var(--space-6)",
            borderBottom: "1px solid var(--clr-border)",
            paddingBottom: 4,
            overflowX: "auto",
          }}
        >
          <button
            onClick={() => setActiveTab("generate")}
            className={`btn ${activeTab === "generate" ? "btn-brand" : "btn-ghost"}`}
            style={{ gap: 8, borderRadius: "var(--radius-md) var(--radius-md) 0 0" }}
          >
            <Sparkles size={18} />
            <span>{isRtl ? "مولد الأسئلة الذكي" : "Question Generator"}</span>
          </button>
          <button
            onClick={() => setActiveTab("materials")}
            className={`btn ${activeTab === "materials" ? "btn-brand" : "btn-ghost"}`}
            style={{ gap: 8, borderRadius: "var(--radius-md) var(--radius-md) 0 0" }}
          >
            <BookOpen size={18} />
            <span>{isRtl ? "مكتبة المناهج والملفات" : "Curriculum Materials"}</span>
            <span className="badge badge-brand" style={{ padding: "1px 6px", fontSize: "0.7rem" }}>
              {materials.length}
            </span>
          </button>
          <button
            onClick={() => {
              setActiveTab("analytics");
              loadAnalytics();
            }}
            className={`btn ${activeTab === "analytics" ? "btn-brand" : "btn-ghost"}`}
            style={{ gap: 8, borderRadius: "var(--radius-md) var(--radius-md) 0 0" }}
          >
            <BarChart3 size={18} />
            <span>{isRtl ? "إحصائيات واستخدام الذكاء الاصطناعي" : "Usage & Analytics"}</span>
          </button>
          <button
            onClick={() => {
              setActiveTab("settings");
              loadSettings();
            }}
            className={`btn ${activeTab === "settings" ? "btn-brand" : "btn-ghost"}`}
            style={{ gap: 8, borderRadius: "var(--radius-md) var(--radius-md) 0 0" }}
          >
            <Settings size={18} />
            <span>{isRtl ? "إعدادات الذكاء الاصطناعي" : "AI Settings"}</span>
          </button>
        </div>
      </div>

      {/* ═══════════════════════════════════════════════════════════
          TAB 1: QUESTION GENERATOR
      ═══════════════════════════════════════════════════════════ */}
      {activeTab === "generate" && (
        <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-6)" }}>
          {/* Missing API Key Alert */}
          {(!settings?.hasApiKey && !(typeof window !== "undefined" && isValidApiKey(localStorage.getItem("gemini_api_key")))) && !process.env.NEXT_PUBLIC_DEV_KEY && (
            <div
              style={{
                background: "rgba(245, 158, 11, 0.12)",
                border: "1px solid rgba(245, 158, 11, 0.4)",
                padding: "16px 20px",
                borderRadius: "var(--radius-lg)",
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                gap: 16,
                flexWrap: "wrap",
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                <Key size={24} color="var(--clr-warning)" />
                <div>
                  <strong style={{ color: "var(--clr-warning)", display: "block", fontSize: "0.95rem" }}>
                    {isRtl ? "مطلوب مفتاح Google Gemini API Key" : "Gemini API Key Required"}
                  </strong>
                  <span style={{ color: "var(--clr-text-secondary)", fontSize: "0.85rem" }}>
                    {isRtl
                      ? "لتوليد الأسئلة، يرجى إدخال مفتاح API المجاني الخاص بك في إعدادات الذكاء الاصطناعي."
                      : "Please configure your free Gemini API Key in the settings tab to start generating."}
                  </span>
                </div>
              </div>
              <button
                className="btn btn-warning btn-sm"
                onClick={() => {
                  setActiveTab("settings");
                  loadSettings();
                }}
                style={{ gap: 6 }}
              >
                <Settings size={16} />
                <span>{isRtl ? "فتح الإعدادات وإدخال المفتاح" : "Configure Key"}</span>
              </button>
            </div>
          )}

          {/* Persistent Key Active Indicator */}
          {(settings?.hasApiKey || (typeof window !== "undefined" && isValidApiKey(localStorage.getItem("gemini_api_key")))) && (
            <div
              style={{
                background: "rgba(16, 185, 129, 0.08)",
                border: "1px solid rgba(16, 185, 129, 0.35)",
                padding: "10px 16px",
                borderRadius: "var(--radius-md)",
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                gap: 12,
                flexWrap: "wrap",
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: 8, color: "var(--clr-success)", fontSize: "0.9rem", fontWeight: 600 }}>
                <CheckCircle2 size={18} />
                <span>{isRtl ? "✅ مفتاح Google AI Studio محفوظ ومفعّل (جاهز لتوليد الأسئلة بدون أي أخطاء)" : "✅ Gemini API Key is saved and active"}</span>
              </div>
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                onClick={() => {
                  setActiveTab("settings");
                  loadSettings();
                }}
                style={{ fontSize: "0.8rem", padding: "4px 10px", gap: 6 }}
              >
                <Key size={14} />
                <span>{isRtl ? "تعديل المفتاح" : "Manage Key"}</span>
              </button>
            </div>
          )}

          {/* Configuration Grid */}
          <div className="card" style={{ padding: "var(--space-6)" }}>
            <h3 style={{ fontSize: "1.15rem", marginBottom: "var(--space-4)", display: "flex", alignItems: "center", gap: 8 }}>
              <Layers size={20} color="var(--clr-brand)" />
              <span>{isRtl ? "1. حدد المصدر والمنهج الدراسي" : "1. Select Curriculum Source"}</span>
            </h3>

            {/* Source Mode Toggle */}
            <div style={{ display: "flex", gap: 12, marginBottom: "var(--space-4)" }}>
              <button
                type="button"
                onClick={() => setSourceMode("material")}
                className={`btn btn-sm ${sourceMode === "material" ? "btn-brand" : "btn-ghost"}`}
                style={{ flex: 1, justifyContent: "center", gap: 8 }}
              >
                <BookOpen size={16} />
                <span>{isRtl ? "من الكتب والمذكرات المرفوعة" : "From Uploaded Books"}</span>
              </button>
              <button
                type="button"
                onClick={() => setSourceMode("direct")}
                className={`btn btn-sm ${sourceMode === "direct" ? "btn-brand" : "btn-ghost"}`}
                style={{ flex: 1, justifyContent: "center", gap: 8 }}
              >
                <FileText size={16} />
                <span>{isRtl ? "لصق نص مباشر مخصص" : "Paste Custom Text"}</span>
              </button>
            </div>

            {sourceMode === "material" ? (
              materials.length === 0 ? (
                <div
                  style={{
                    background: "rgba(99, 102, 241, 0.06)",
                    border: "1px dashed var(--clr-brand)",
                    padding: "20px",
                    borderRadius: "var(--radius-md)",
                    textAlign: "center",
                    margin: "12px 0",
                  }}
                >
                  <p style={{ margin: "0 0 12px", color: "var(--clr-text-secondary)", fontSize: "0.9rem" }}>
                    {isRtl
                      ? "لم يتم رفع أي كتاب أو مذكرة دراسية حتى الآن. يمكنك رفع أول ملف من تبويب 'مكتبة المناهج والملفات' أو التبديل إلى 'لصق نص مباشر'."
                      : "No study materials uploaded yet. Upload a document or switch to 'Paste Custom Text'."}
                  </p>
                  <div style={{ display: "flex", gap: 10, justifyContent: "center" }}>
                    <button
                      type="button"
                      className="btn btn-brand btn-sm"
                      onClick={() => setActiveTab("materials")}
                      style={{ gap: 6 }}
                    >
                      <Upload size={14} />
                      <span>{isRtl ? "رفع كتاب الآن" : "Upload Document"}</span>
                    </button>
                    <button
                      type="button"
                      className="btn btn-ghost btn-sm"
                      onClick={() => setSourceMode("direct")}
                      style={{ gap: 6 }}
                    >
                      <FileText size={14} />
                      <span>{isRtl ? "لصق نص مباشر" : "Paste Text"}</span>
                    </button>
                  </div>
                </div>
              ) : (
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: 16 }}>
                  <div>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
                    <label style={{ fontSize: "0.85rem", color: "var(--clr-text-secondary)", margin: 0 }}>
                      {isRtl ? "اختر الكتاب أو المذكرة المرفوعة:" : "Select Textbook/Document:"}
                    </label>
                    {currentMaterial && (
                      <button
                        type="button"
                        onClick={() => handleOpenEditModal(currentMaterial)}
                        className="btn btn-ghost btn-sm"
                        style={{ padding: "2px 8px", fontSize: "0.78rem", gap: 4, color: "var(--clr-brand)" }}
                        title={isRtl ? "تعديل نصوص وفصول هذا الكتاب" : "Edit this material"}
                      >
                        <Pencil size={12} />
                        <span>{isRtl ? "تعديل الكتاب" : "Edit Book"}</span>
                      </button>
                    )}
                  </div>
                  <select
                    className="select"
                    value={selectedMaterialId}
                    onChange={(e) => {
                      setSelectedMaterialId(e.target.value);
                      setSelectedSectionId("");
                    }}
                    style={{ width: "100%" }}
                  >
                    {materials.map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.title} ({m.subject} - {m.wordCount} {isRtl ? "كلمة" : "words"})
                      </option>
                    ))}
                  </select>
                </div>

                {/* Sub-section or topic selector */}
                <div>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
                    <label style={{ fontSize: "0.85rem", color: "var(--clr-text-secondary)", margin: 0 }}>
                      {isRtl ? "القسم أو الفصل المستهدف:" : "Target Section/Lesson:"}
                    </label>
                    {currentMaterial?.sections && currentMaterial.sections.length > 0 && (
                      <span style={{ fontSize: "0.75rem", color: "var(--clr-text-muted)" }}>
                        {currentMaterial.sections.length} {isRtl ? "فصول متوفرة" : "sections"}
                      </span>
                    )}
                  </div>
                  <select
                    className="select"
                    value={selectedSectionId}
                    onChange={(e) => setSelectedSectionId(e.target.value)}
                    style={{ width: "100%" }}
                  >
                    <option value="">{isRtl ? "📖 كامل الكتاب / المنهج المعتمد" : "All Available Text"}</option>
                    {currentMaterial?.sections?.map((s) => (
                      <option key={s.id} value={s.id}>
                        📑 {s.title} ({s.wordCount} {isRtl ? "كلمة" : "words"})
                      </option>
                    ))}
                  </select>
                  {selectedSectionId && (
                    <div style={{ marginTop: 6, fontSize: "0.78rem", color: "var(--clr-brand)", display: "flex", alignItems: "center", gap: 6 }}>
                      <span>🎯 {isRtl ? "سيتم توليد الأسئلة حصرياً من هذا الفصل المحدد بدقة متناهية." : "Strictly generated from this section."}</span>
                    </div>
                  )}
                </div>
              </div>
              )
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                <input
                  type="text"
                  className="input"
                  placeholder={isRtl ? "عنوان الموضوع أو المنهج (مثال: الوحدة الثانية - الكيمياء العضوية)" : "Subject / Topic Title"}
                  value={directTitle}
                  onChange={(e) => setDirectTitle(e.target.value)}
                />
                <textarea
                  className="textarea"
                  rows={5}
                  placeholder={
                    isRtl
                      ? "الصق هنا فقرات المنهج أو الملخص أو الدرس الدراسي الذي تريد توليد الأسئلة منه بدقة 100%..."
                      : "Paste the textbook chapter, lecture notes, or study text here..."
                  }
                  value={directText}
                  onChange={(e) => setDirectText(e.target.value)}
                />
              </div>
            )}

            {/* Parameters Row */}
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))",
                gap: 16,
                marginTop: "var(--space-5)",
                paddingTop: "var(--space-4)",
                borderTop: "1px solid var(--clr-border)",
              }}
            >
              <div>
                <label style={{ display: "block", marginBottom: 6, fontSize: "0.85rem", color: "var(--clr-text-secondary)" }}>
                  {isRtl ? "عدد الأسئلة المطلوب:" : "Number of Questions:"}
                </label>
                <div style={{ display: "flex", gap: 6 }}>
                  {[3, 5, 10, 15].map((cnt) => (
                    <button
                      key={cnt}
                      type="button"
                      onClick={() => setGenCount(cnt)}
                      className={`btn btn-sm ${genCount === cnt ? "btn-brand" : "btn-ghost"}`}
                      style={{ flex: 1, padding: "4px 8px" }}
                    >
                      {cnt}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <label style={{ display: "block", marginBottom: 6, fontSize: "0.85rem", color: "var(--clr-text-secondary)" }}>
                  {isRtl ? "مستوى الصعوبة الأكاديمي:" : "Academic Difficulty:"}
                </label>
                <select
                  className="select"
                  value={genDifficulty}
                  onChange={(e: any) => setGenDifficulty(e.target.value)}
                  style={{ width: "100%" }}
                >
                  <option value="mixed">{isRtl ? "متوازن (مزيج تعليمي متدرج)" : "Balanced (Mixed)"}</option>
                  <option value="easy">{isRtl ? "مباشر وسهل (تذكر ومفاهيم أساسية)" : "Easy / Direct Recall"}</option>
                  <option value="medium">{isRtl ? "متوسط (فهم وتطبيق)" : "Medium (Comprehension)"}</option>
                  <option value="hard">{isRtl ? "مهارات عليا (تحليل وتفكير نقدي)" : "Hard (Analysis / Higher-Order)"}</option>
                </select>
              </div>

              <div>
                <label style={{ display: "block", marginBottom: 6, fontSize: "0.85rem", color: "var(--clr-text-secondary)" }}>
                  {isRtl ? "تعليمات خاصة (اختياري):" : "Custom Instructions:"}
                </label>
                <input
                  type="text"
                  className="input"
                  placeholder={isRtl ? "مثال: ركز على التعاريف ووحدات القياس" : "e.g., Focus on formulas & dates"}
                  value={customInstructions}
                  onChange={(e) => setCustomInstructions(e.target.value)}
                  style={{ width: "100%" }}
                />
              </div>

              <div>
                <label style={{ display: "block", marginBottom: 6, fontSize: "0.85rem", color: "var(--clr-text-secondary)" }}>
                  {isRtl ? "محرك الذكاء الاصطناعي (AI Model):" : "AI Model Engine:"}
                </label>
                <select
                  className="select"
                  value={settings?.defaultModel || "gemini-3.8-flash"}
                  onChange={(e) => {
                    const chosen = e.target.value;
                    setSettings((prev) => (prev ? { ...prev, defaultModel: chosen } : null));
                  }}
                  style={{ width: "100%", fontWeight: 600 }}
                >
                  <option value="gemini-3.8-flash">
                    gemini-3.8-flash ({isRtl ? "الأسرع والأحدث" : "Fastest & Latest"})
                  </option>
                  <option value="gemini-2.5-flash">
                    gemini-2.5-flash ({isRtl ? "بديل ممتاز وسريع (حصة مستقلة)" : "Fast (Independent Quota)"})
                  </option>
                  <option value="gemini-2.5-pro">
                    gemini-2.5-pro ({isRtl ? "تفكير تحليلي متقدم" : "Advanced Reasoning"})
                  </option>
                  {availableModels
                    .filter((m) => !["gemini-3.8-flash", "gemini-2.5-flash", "gemini-2.5-pro"].includes(m.id))
                    .map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.id}
                      </option>
                    ))}
                </select>
              </div>
            </div>

            {/* Generate Action Button */}
            <div style={{ marginTop: "var(--space-6)", display: "flex", justifyContent: "flex-end", alignItems: "center", gap: 16 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8, color: "var(--clr-text-secondary)", fontSize: "0.85rem" }}>
                <ShieldCheck size={18} color="var(--clr-success)" />
                <span>
                  {isRtl
                    ? "التحقق الصارم مفعل: سيتم توليد الأسئلة فقط وحصرياً من النص بدون اختراع."
                    : "Zero-Hallucination mode active."}
                </span>
              </div>
              <button
                type="button"
                onClick={handleGenerate}
                disabled={generating}
                className="btn btn-brand"
                style={{ padding: "12px 28px", fontSize: "1rem", gap: 10 }}
              >
                {generating ? (
                  <>
                    <RefreshCw size={20} className="spin" />
                    <span>{isRtl ? "جاري التوليد والتحقق الصارم..." : "Analyzing & Generating..."}</span>
                  </>
                ) : (
                  <>
                    <Sparkles size={20} />
                    <span>{isRtl ? "توليد الأسئلة الآن" : "Generate Questions Now"}</span>
                  </>
                )}
              </button>
            </div>
          </div>

          {/* ── Generated Questions Section ── */}
          {generatedQuestions.length > 0 && (
            <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-4)" }}>
              {/* Batch Actions Bar */}
              <div
                className="card"
                style={{
                  padding: "16px 20px",
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  flexWrap: "wrap",
                  gap: 12,
                  background: "var(--grad-surface)",
                  border: "1px solid var(--clr-brand-glow)",
                }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                  <input
                    type="checkbox"
                    id="selectAll"
                    checked={selectedQuestionIds.size === generatedQuestions.length}
                    onChange={toggleSelectAll}
                    style={{ width: 18, height: 18, cursor: "pointer" }}
                  />
                  <label htmlFor="selectAll" style={{ fontWeight: 600, fontSize: "0.95rem", cursor: "pointer" }}>
                    {isRtl
                      ? `تم تحديد (${selectedQuestionIds.size} من أصل ${generatedQuestions.length}) سؤال`
                      : `Selected (${selectedQuestionIds.size} of ${generatedQuestions.length})`}
                  </label>
                  {generationMeta && (
                    <span className="badge badge-brand" style={{ fontSize: "0.75rem" }}>
                      ⚡ {generationMeta.modelUsed} ({generationMeta.durationMs}ms)
                    </span>
                  )}
                </div>

                <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                  <button
                    type="button"
                    onClick={handleCopyText}
                    className="btn btn-ghost btn-sm"
                    style={{ gap: 6 }}
                    title={isRtl ? "نسخ كنص" : "Copy as text"}
                  >
                    <Copy size={16} />
                    <span className="hide-mobile">{isRtl ? "نسخ كنص" : "Copy"}</span>
                  </button>
                  <button
                    type="button"
                    onClick={handleSaveToLibrary}
                    disabled={selectedQuestions.length === 0}
                    className="btn btn-ghost btn-sm"
                    style={{ gap: 6, color: "var(--clr-brand)" }}
                  >
                    <Save size={16} />
                    <span>{isRtl ? "حفظ في بنك الأسئلة" : "Save to Library"}</span>
                  </button>
                  <button
                    type="button"
                    onClick={handleOpenExamModal}
                    disabled={selectedQuestions.length === 0}
                    className="btn btn-brand btn-sm"
                    style={{ gap: 6 }}
                  >
                    <GraduationCap size={16} />
                    <span>{isRtl ? "إنشاء اختبار متكامل" : "Create Exam"}</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setShowBroadcastModal(true)}
                    disabled={selectedQuestions.length === 0}
                    className="btn btn-success btn-sm"
                    style={{ gap: 6, background: "var(--clr-success)", color: "#fff" }}
                  >
                    <Send size={16} />
                    <span>{isRtl ? "نشر فوري في تليجرام" : "Broadcast Telegram"}</span>
                  </button>
                </div>
              </div>

              {/* Questions List */}
              <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
                {generatedQuestions.map((q, qIndex) => {
                  const isSelected = selectedQuestionIds.has(q.id);
                  return (
                    <div
                      key={q.id}
                      className="card"
                      style={{
                        padding: "var(--space-5)",
                        border: isSelected ? "1px solid var(--clr-brand)" : "1px solid var(--clr-border)",
                        background: isSelected ? "rgba(99, 102, 241, 0.04)" : "var(--clr-bg-card)",
                        transition: "all 0.2s ease",
                      }}
                    >
                      {/* Question Card Top Bar */}
                      <div
                        style={{
                          display: "flex",
                          justifyContent: "space-between",
                          alignItems: "center",
                          marginBottom: 12,
                        }}
                      >
                        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                          <input
                            type="checkbox"
                            checked={isSelected}
                            onChange={() => toggleSelectQuestion(q.id)}
                            style={{ width: 18, height: 18, cursor: "pointer" }}
                          />
                          <span
                            style={{
                              background: "var(--clr-bg-elevated)",
                              color: "var(--clr-brand)",
                              fontWeight: 700,
                              borderRadius: "var(--radius-sm)",
                              padding: "2px 8px",
                              fontSize: "0.85rem",
                            }}
                          >
                            #{qIndex + 1}
                          </span>
                          <span
                            className={`badge ${
                              q.difficulty === "EASY"
                                ? "badge-success"
                                : q.difficulty === "HARD"
                                ? "badge-danger"
                                : "badge-brand"
                            }`}
                            style={{ fontSize: "0.75rem" }}
                          >
                            {q.difficulty}
                          </span>
                          <span className="badge badge-ghost" style={{ fontSize: "0.75rem" }}>
                            {q.bloomTaxonomy}
                          </span>
                          {q.topic && (
                            <span style={{ fontSize: "0.8rem", color: "var(--clr-text-secondary)" }}>
                              📁 {q.topic}
                            </span>
                          )}
                        </div>

                        <button
                          type="button"
                          onClick={() => deleteQuestion(q.id)}
                          className="btn btn-ghost btn-icon btn-sm"
                          style={{ color: "var(--clr-danger)" }}
                          title={isRtl ? "حذف هذا السؤال" : "Delete question"}
                        >
                          <Trash2 size={16} />
                        </button>
                      </div>

                      {/* Question Text Field */}
                      <div style={{ marginBottom: 16 }}>
                        <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
                          <label style={{ fontSize: "0.85rem", color: "var(--clr-text-secondary)" }}>
                            {isRtl ? "نص السؤال:" : "Question Text:"}
                          </label>
                          <span
                            style={{
                              fontSize: "0.75rem",
                              color: q.question.length > 290 ? "var(--clr-warning)" : "var(--clr-text-muted)",
                            }}
                          >
                            {q.question.length}/300
                          </span>
                        </div>
                        <input
                          type="text"
                          className="input"
                          value={q.question}
                          onChange={(e) => updateQuestionField(q.id, "question", e.target.value)}
                          style={{ width: "100%", fontWeight: 600, fontSize: "0.95rem" }}
                        />
                      </div>

                      {/* Options Grid */}
                      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))", gap: 10, marginBottom: 16 }}>
                        {q.options.map((opt, optIdx) => {
                          const isCorrect = q.correctOptionId === optIdx;
                          return (
                            <div
                              key={optIdx}
                              style={{
                                display: "flex",
                                alignItems: "center",
                                gap: 8,
                                background: isCorrect ? "rgba(16, 185, 129, 0.12)" : "var(--clr-bg-elevated)",
                                padding: "6px 10px",
                                borderRadius: "var(--radius-md)",
                                border: isCorrect ? "1px solid var(--clr-success)" : "1px solid var(--clr-border)",
                              }}
                            >
                              <input
                                type="radio"
                                name={`correct-${q.id}`}
                                checked={isCorrect}
                                onChange={() => updateQuestionField(q.id, "correctOptionId", optIdx)}
                                style={{ width: 16, height: 16, cursor: "pointer" }}
                                title={isRtl ? "تعيين كإجابة صحيحة" : "Mark as correct"}
                              />
                              <span style={{ fontWeight: 700, fontSize: "0.85rem", color: isCorrect ? "var(--clr-success)" : "var(--clr-text-muted)" }}>
                                {String.fromCharCode(65 + optIdx)}
                              </span>
                              <input
                                type="text"
                                className="input"
                                value={opt}
                                onChange={(e) => updateOptionText(q.id, optIdx, e.target.value)}
                                style={{
                                  flex: 1,
                                  padding: "4px 8px",
                                  fontSize: "0.88rem",
                                  background: "transparent",
                                  border: "none",
                                  boxShadow: "none",
                                }}
                              />
                              <span style={{ fontSize: "0.7rem", color: "var(--clr-text-muted)" }}>
                                {opt.length}/100
                              </span>
                              {q.options.length > 2 && (
                                <button
                                  type="button"
                                  onClick={() => removeOption(q.id, optIdx)}
                                  className="btn btn-ghost btn-icon btn-sm"
                                  style={{ width: 22, height: 22, color: "var(--clr-text-muted)" }}
                                >
                                  ✕
                                </button>
                              )}
                            </div>
                          );
                        })}
                      </div>

                      {q.options.length < 10 && (
                        <div style={{ marginBottom: 12 }}>
                          <button
                            type="button"
                            onClick={() => addOption(q.id)}
                            className="btn btn-ghost btn-sm"
                            style={{ gap: 6, fontSize: "0.8rem" }}
                          >
                            <Plus size={14} />
                            <span>{isRtl ? "إضافة خيار إضافي" : "Add Option"}</span>
                          </button>
                        </div>
                      )}

                      {/* Explanation Field */}
                      <div style={{ marginBottom: 12 }}>
                        <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
                          <label style={{ fontSize: "0.85rem", color: "var(--clr-text-secondary)" }}>
                            {isRtl ? "شرح الإجابة (يظهر للمتعلم):" : "Explanation (shown to student):"}
                          </label>
                          <span style={{ fontSize: "0.75rem", color: "var(--clr-text-muted)" }}>
                            {q.explanation.length}/200
                          </span>
                        </div>
                        <input
                          type="text"
                          className="input"
                          value={q.explanation}
                          onChange={(e) => updateQuestionField(q.id, "explanation", e.target.value)}
                          placeholder={isRtl ? "شرح الإجابة باختصار..." : "Short explanation..."}
                          style={{ width: "100%", fontSize: "0.88rem" }}
                        />
                      </div>

                      {/* Grounding Evidence Callout */}
                      {q.groundingQuote && (
                        <div
                          style={{
                            background: "rgba(99, 102, 241, 0.08)",
                            padding: "8px 12px",
                            borderRadius: "var(--radius-sm)",
                            borderLeft: isRtl ? "none" : "3px solid var(--clr-brand)",
                            borderRight: isRtl ? "3px solid var(--clr-brand)" : "none",
                            fontSize: "0.82rem",
                            display: "flex",
                            alignItems: "flex-start",
                            gap: 8,
                            color: "var(--clr-text-secondary)",
                          }}
                        >
                          <ShieldCheck size={16} color="var(--clr-brand)" style={{ flexShrink: 0, marginTop: 2 }} />
                          <div>
                            <strong style={{ color: "var(--clr-text-primary)", display: "inline-block", marginInlineEnd: 4 }}>
                              {isRtl ? "دليل المنهج (Grounding Quote):" : "Curriculum Grounding:"}
                            </strong>
                            <span>«{q.groundingQuote}»</span>
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      )}

      {/* ═══════════════════════════════════════════════════════════
          TAB 2: CURRICULUM MATERIALS MANAGEMENT
      ═══════════════════════════════════════════════════════════ */}
      {activeTab === "materials" && (
        <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-6)" }}>
          {/* Upload Card */}
          <div className="card" style={{ padding: "var(--space-6)" }}>
            <h3 style={{ fontSize: "1.15rem", marginBottom: "var(--space-4)", display: "flex", alignItems: "center", gap: 8 }}>
              <Upload size={20} color="var(--clr-brand)" />
              <span>{isRtl ? "إضافة منهج أو كتاب دراسي جديد" : "Add New Curriculum Material"}</span>
            </h3>

            {/* Mode Switcher: File Upload vs Direct Text Input */}
            <div style={{ display: "flex", gap: 10, marginBottom: "var(--space-4)" }}>
              <button
                type="button"
                className={`btn btn-sm ${uploadMode === "file" ? "btn-brand" : "btn-secondary"}`}
                onClick={() => setUploadMode("file")}
                style={{ display: "inline-flex", alignItems: "center", gap: 6, fontWeight: 600, padding: "7px 14px" }}
              >
                <Upload size={16} />
                <span>{isRtl ? "📁 رفع ملف (PDF / Word / TXT)" : "📁 Upload File"}</span>
              </button>
              <button
                type="button"
                className={`btn btn-sm ${uploadMode === "paste" ? "btn-brand" : "btn-secondary"}`}
                onClick={() => setUploadMode("paste")}
                style={{ display: "inline-flex", alignItems: "center", gap: 6, fontWeight: 600, padding: "7px 14px" }}
              >
                <FileText size={16} />
                <span>{isRtl ? "📝 لصق نص المنهج أو الفصل مباشرة (فوري بدون كوتا)" : "📝 Paste Text Directly (Instant)"}</span>
              </button>
            </div>

            <form onSubmit={handleUploadMaterial}>
              {uploadMode === "paste" ? (
                /* Direct Text Paste Area */
                <div style={{ marginBottom: "var(--space-4)" }}>
                  <label
                    htmlFor="pastedTextInput"
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      alignItems: "center",
                      marginBottom: 6,
                      fontSize: "0.88rem",
                      fontWeight: 600,
                      color: "var(--clr-text-primary)",
                    }}
                  >
                    <span>
                      {isRtl
                        ? "📝 الصق نص الفصل، المحاضرة، أو نصوص الكتاب هنا:"
                        : "📝 Paste Chapter, Lecture, or Textbook Text Here:"}
                    </span>
                    <span style={{ fontSize: "0.8rem", color: "var(--clr-text-secondary)" }}>
                      {pastedText.trim()
                        ? `${pastedText.trim().split(/\s+/).filter(Boolean).length} ${isRtl ? "كلمة" : "words"} • ${pastedText.length} ${isRtl ? "حرف" : "chars"}`
                        : isRtl ? "النص جاهز للمعالجة الفورية" : "Ready for instant processing"}
                    </span>
                  </label>
                  <textarea
                    id="pastedTextInput"
                    className="input"
                    dir="auto"
                    rows={8}
                    placeholder={
                      isRtl
                        ? "الصق نصوص المنهج أو الفصل هنا مباشرة (مثلاً: نصوص منسوخة من مستندات Google، ملف Word، ملخص، أو كتاب). سيتم حفظه وتقسيمه وتوليد الأسئلة منه في ثانية واحدة بدون استهلاك أي كوتا أو انتظار."
                        : "Paste chapter text directly here. Instant processing with 0 API calls or cooldown."
                    }
                    value={pastedText}
                    onChange={(e) => {
                      setPastedText(e.target.value);
                      if (!uploadTitle && e.target.value.trim().length > 0) {
                        const firstLine = e.target.value.trim().split("\n")[0].substring(0, 40).replace(/[#*_-]/g, "").trim();
                        if (firstLine.length >= 3) {
                          setUploadTitle(firstLine);
                        }
                      }
                    }}
                    style={{
                      width: "100%",
                      fontSize: "0.88rem",
                      fontFamily: "inherit",
                      lineHeight: 1.6,
                      resize: "vertical",
                    }}
                  />
                </div>
              ) : (
                /* Drag & Drop File Zone and PDF controls */
                <>
                  <div
                    style={{
                      border: isDragging ? "2px dashed var(--clr-brand)" : "2px dashed var(--clr-border-active)",
                      borderRadius: "var(--radius-lg)",
                      padding: "var(--space-8)",
                      textAlign: "center",
                      background: isDragging ? "rgba(99, 102, 241, 0.12)" : "rgba(99, 102, 241, 0.03)",
                      cursor: "pointer",
                      marginBottom: "var(--space-4)",
                      transition: "all 0.2s ease",
                    }}
                    onClick={() => document.getElementById("filePicker")?.click()}
                    onDragOver={(e) => {
                      e.preventDefault();
                      setIsDragging(true);
                    }}
                    onDragLeave={(e) => {
                      e.preventDefault();
                      setIsDragging(false);
                    }}
                    onDrop={(e) => {
                      e.preventDefault();
                      setIsDragging(false);
                      const f = e.dataTransfer.files?.[0];
                      if (f) {
                        setUploadFile(f);
                        if (!uploadTitle) {
                          setUploadTitle(f.name.replace(/\.[^/.]+$/, ""));
                        }
                        setPageRange("");
                        if (f.name.toLowerCase().endsWith(".pdf")) {
                          setReadingPdfInfo(true);
                          getPdfPageCount(f)
                            .then((count) => setPdfPageCount(count > 0 ? count : null))
                            .catch(() => setPdfPageCount(null))
                            .finally(() => setReadingPdfInfo(false));
                        } else {
                          setPdfPageCount(null);
                        }
                      }
                    }}
                  >
                    <input
                      id="filePicker"
                      type="file"
                      accept=".pdf,.docx,.txt,.md,image/png,image/jpeg,image/webp,.png,.jpg,.jpeg,.webp"
                      style={{ display: "none" }}
                      onChange={(e) => {
                        const f = e.target.files?.[0];
                        if (f) {
                          setUploadFile(f);
                          if (!uploadTitle) {
                            setUploadTitle(f.name.replace(/\.[^/.]+$/, ""));
                          }
                          setPageRange("");
                          if (f.name.toLowerCase().endsWith(".pdf")) {
                            setReadingPdfInfo(true);
                            getPdfPageCount(f)
                              .then((count) => setPdfPageCount(count > 0 ? count : null))
                              .catch(() => setPdfPageCount(null))
                              .finally(() => setReadingPdfInfo(false));
                          } else {
                            setPdfPageCount(null);
                          }
                        }
                      }}
                    />
                    <FileCheck size={40} color="var(--clr-brand)" style={{ margin: "0 auto 12px" }} />
                    {uploadFile ? (
                      <div>
                        <h4 style={{ margin: "0 0 4px", color: "var(--clr-text-primary)" }}>{uploadFile.name}</h4>
                        <span style={{ fontSize: "0.85rem", color: "var(--clr-text-secondary)" }}>
                          {uploadFile.size > 1024 * 1024
                            ? `${(uploadFile.size / (1024 * 1024)).toFixed(1)} MB`
                            : `${(uploadFile.size / 1024).toFixed(1)} KB`}
                          {pdfPageCount ? ` • ${pdfPageCount} ${isRtl ? "صفحة" : "pages"}` : readingPdfInfo ? ` • ${isRtl ? "جاري قراءة عدد الصفحات..." : "Reading pages..."}` : ""}{" "}
                          — {isRtl ? "جاهز للاستخراج والتحليل" : "Ready to parse"}
                        </span>
                      </div>
                    ) : (
                      <div>
                        <h4 style={{ margin: "0 0 6px", color: "var(--clr-text-primary)" }}>
                          {isRtl ? "اضغط هنا لاختيار ملف أو اسحبه وأفلته" : "Click to select or drag & drop"}
                        </h4>
                        <p style={{ fontSize: "0.85rem", color: "var(--clr-text-secondary)", margin: "0 0 10px" }}>
                          {isRtl
                            ? "يدعم ملفات PDF و Word (.docx) والنصوص (.txt) والصور عالية الدقة (حتى 50 ميجابايت)"
                            : "Supports PDF, DOCX, TXT, and high-res images (up to 50MB)"}
                        </p>
                        <div style={{ display: "flex", justifyContent: "center", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                          <span
                            className="badge"
                            style={{
                              fontSize: "0.82rem",
                              padding: "5px 14px",
                              display: "inline-flex",
                              alignItems: "center",
                              gap: 6,
                              background: "rgba(99, 102, 241, 0.12)",
                              color: "var(--clr-brand)",
                              border: "1px solid rgba(99, 102, 241, 0.3)",
                              borderRadius: "var(--radius-full)",
                              fontWeight: 600,
                            }}
                          >
                            📸 صور ومستندات ممسوحة / خط يد (OCR مدعوم بالذكاء الاصطناعي)
                          </span>
                        </div>
                      </div>
                    )}
                  </div>

                  {/* Page Range Selector (when PDF selected) */}
                  {uploadFile && uploadFile.name.toLowerCase().endsWith(".pdf") && (
                    <div
                      style={{
                        marginBottom: "var(--space-4)",
                        padding: "12px 14px",
                        borderRadius: "var(--radius-md)",
                        background: "var(--clr-bg-elevated)",
                        border: "1px solid var(--clr-border)",
                      }}
                    >
                      <label
                        htmlFor="pageRangeInput"
                        style={{
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "space-between",
                          marginBottom: 6,
                          fontSize: "0.88rem",
                          fontWeight: 600,
                          color: "var(--clr-text-primary)",
                        }}
                      >
                        <span>
                          {isRtl
                            ? "📄 نطاق الصفحات (اختياري، مثلاً: 1-30 أو اتركه فارغاً لكامل الكتاب):"
                            : "📄 Page Range (optional, e.g., 1-30 or leave empty for full book):"}
                        </span>
                        {pdfPageCount ? (
                          <span
                            style={{
                              fontSize: "0.78rem",
                              color: "var(--clr-brand)",
                              background: "rgba(99, 102, 241, 0.1)",
                              padding: "2px 8px",
                              borderRadius: "var(--radius-full)",
                              fontWeight: 600,
                            }}
                          >
                            {isRtl ? `إجمالي الكتاب: ${pdfPageCount} صفحة` : `Total: ${pdfPageCount} pages`}
                          </span>
                        ) : readingPdfInfo ? (
                          <span style={{ fontSize: "0.75rem", color: "var(--clr-text-secondary)" }}>
                            {isRtl ? "⏳ جاري قراءة عدد الصفحات..." : "Reading pages..."}
                          </span>
                        ) : null}
                      </label>
                      <input
                        id="pageRangeInput"
                        type="text"
                        className="input"
                        dir="ltr"
                        placeholder={
                          pdfPageCount
                            ? `1-${pdfPageCount} (${isRtl ? "مثلاً: 1-30 أو 20-50" : "e.g. 1-30"})`
                            : isRtl
                            ? "مثال: 1-30 أو اتركه فارغاً لكامل الكتاب"
                            : "e.g., 1-30 or leave empty for full book"
                        }
                        value={pageRange}
                        onChange={(e) => setPageRange(e.target.value)}
                        style={{ width: "100%", fontSize: "0.88rem" }}
                      />
                      {pageRange.trim() ? (
                        (() => {
                          const parsed = parsePageRange(pageRange, pdfPageCount || undefined);
                          if (!parsed) {
                            return (
                              <span
                                style={{
                                  display: "block",
                                  fontSize: "0.75rem",
                                  color: "#f59e0b",
                                  marginTop: 4,
                                  fontWeight: 500,
                                }}
                              >
                                {isRtl
                                  ? "⚠️ تعذر التعرف على النطاق، سيتم استخراج المستند كاملاً (صيغ مدعومة: 1-30 أو ١-٣٠ أو 15 أو 10-)"
                                  : "⚠️ Range not recognized, entire document will be extracted (supported: 1-30, 15, 10-)"}
                              </span>
                            );
                          }
                          const count = parsed.endPage - parsed.startPage + 1;
                          return (
                            <span
                              style={{
                                display: "block",
                                fontSize: "0.75rem",
                                color: "#10b981",
                                marginTop: 4,
                                fontWeight: 600,
                              }}
                            >
                              {isRtl
                                ? `✓ سيتم استخراج ${count} ${count === 1 ? "صفحة" : "صفحات"} (من ${parsed.startPage} إلى ${parsed.endPage})`
                                : `✓ Will extract ${count} pages (pages ${parsed.startPage} to ${parsed.endPage})`}
                            </span>
                          );
                        })()
                      ) : (
                        <span
                          style={{
                            display: "block",
                            fontSize: "0.75rem",
                            color: "var(--clr-text-secondary)",
                            marginTop: 4,
                          }}
                        >
                          {isRtl
                            ? "يمكنك تحديد صفحات فصل محدد فقط لتسريع التوليد والاختبار، أو اتركه فارغاً لتحليل المستند بالكامل."
                            : "Specify a chapter range to speed up processing, or leave empty for the entire book."}
                        </span>
                      )}
                    </div>
                  )}

                  {/* Force OCR Option */}
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 12,
                      marginBottom: "var(--space-4)",
                      padding: "12px 14px",
                      borderRadius: "var(--radius-md)",
                      background: forceOcr ? "rgba(99, 102, 241, 0.08)" : "var(--clr-bg-elevated)",
                      border: forceOcr ? "1px solid var(--clr-brand)" : "1px solid var(--clr-border)",
                      cursor: "pointer",
                      transition: "all 0.2s ease",
                    }}
                    onClick={() => setForceOcr(!forceOcr)}
                  >
                    <input
                      type="checkbox"
                      id="forceOcrToggle"
                      checked={forceOcr}
                      onChange={(e) => setForceOcr(e.target.checked)}
                      style={{ width: 18, height: 18, cursor: "pointer" }}
                    />
                    <label htmlFor="forceOcrToggle" style={{ fontSize: "0.88rem", fontWeight: 600, cursor: "pointer", margin: 0, flex: 1 }}>
                      {isRtl
                        ? "✨ تفعيل التعرف البصري الذكي المتقدم (NotebookLM OCR) على كامل المستند"
                        : "✨ Force Intelligent AI Visual OCR (NotebookLM Mode)"}
                      <span style={{ display: "block", fontSize: "0.75rem", fontWeight: 400, color: "var(--clr-text-secondary)", marginTop: 2 }}>
                        {isRtl
                          ? "يضمن استخراج نصوص خط اليد والجداول والرسومات في المستندات الممسوحة ضوئياً. (إذا كان الكتاب يحتوي على نصوص رقمية أصلية، يتم استخراجها فورياً في ثوانٍ بدقة 100% لتجنب الانتظار وحدود معدل الطلبات)."
                          : "Ensures extraction of handwriting, diagrams, and tables in scanned documents. (If textbook has authentic digital text, it is extracted instantly in seconds with 100% precision to bypass rate limits)."}
                      </span>
                    </label>
                  </div>
                </>
              )}

              {/* Metadata Inputs */}
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 16 }}>
                <div>
                  <label style={{ display: "block", marginBottom: 6, fontSize: "0.85rem", color: "var(--clr-text-secondary)" }}>
                    {isRtl ? "اسم الكتاب / المذكرة:" : "Document Title:"}
                  </label>
                  <input
                    type="text"
                    className="input"
                    required
                    placeholder={isRtl ? "مثال: مراجعة نهائية - فيزياء عامة" : "e.g., Physics Review"}
                    value={uploadTitle}
                    onChange={(e) => setUploadTitle(e.target.value)}
                    style={{ width: "100%" }}
                  />
                </div>
                <div>
                  <label style={{ display: "block", marginBottom: 6, fontSize: "0.85rem", color: "var(--clr-text-secondary)" }}>
                    {isRtl ? "المادة الدراسية:" : "Subject:"}
                  </label>
                  <input
                    type="text"
                    className="input"
                    placeholder={isRtl ? "مثال: علوم، لغة عربية، فيزياء" : "e.g., Computer Science"}
                    value={uploadSubject}
                    onChange={(e) => setUploadSubject(e.target.value)}
                    style={{ width: "100%" }}
                  />
                </div>
                <div>
                  <label style={{ display: "block", marginBottom: 6, fontSize: "0.85rem", color: "var(--clr-text-secondary)" }}>
                    {isRtl ? "المرحلة / الصف (اختياري):" : "Grade / Stage:"}
                  </label>
                  <input
                    type="text"
                    className="input"
                    placeholder={isRtl ? "مثال: الصف الثالث الإعدادي" : "e.g., High School"}
                    value={uploadGrade}
                    onChange={(e) => setUploadGrade(e.target.value)}
                    style={{ width: "100%" }}
                  />
                </div>
                <div>
                  <label style={{ display: "block", marginBottom: 6, fontSize: "0.85rem", color: "var(--clr-text-secondary)" }}>
                    {isRtl ? "الوسوم والكلمات الدلالية:" : "Topic Tags (comma-separated):"}
                  </label>
                  <input
                    type="text"
                    className="input"
                    placeholder={isRtl ? "قوى, حركة, نيوتن" : "physics, motion, newton"}
                    value={uploadTopics}
                    onChange={(e) => setUploadTopics(e.target.value)}
                    style={{ width: "100%" }}
                  />
                </div>
              </div>

              {/* Live Upload & Extraction Progress Steps */}
              {(uploading || uploadProgressPercent > 0) && (
                <div
                  style={{
                    marginTop: "var(--space-4)",
                    padding: "14px 18px",
                    borderRadius: "var(--radius-md)",
                    background: "var(--clr-bg-elevated)",
                    border: "1px solid var(--clr-brand)",
                    boxShadow: "var(--shadow-sm)",
                  }}
                >
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 10, fontSize: "0.9rem", fontWeight: 600 }}>
                      {uploadProgressPercent < 100 ? (
                        <RefreshCw size={18} className="spin" style={{ color: "var(--clr-brand)" }} />
                      ) : (
                        <CheckCircle2 size={18} style={{ color: "var(--clr-success)" }} />
                      )}
                      <span style={{ color: "var(--clr-text-primary)" }}>
                        {uploadProgressStep || (isRtl ? "جاري معالجة الكتاب الدراسي..." : "Processing curriculum...")}
                      </span>
                    </div>
                    <span style={{ fontSize: "0.9rem", fontWeight: 700, color: "var(--clr-brand)", minWidth: 40, textAlign: "end" }}>
                      {uploadProgressPercent}%
                    </span>
                  </div>
                  <div
                    style={{
                      width: "100%",
                      height: 8,
                      background: "rgba(99, 102, 241, 0.15)",
                      borderRadius: 4,
                      overflow: "hidden",
                    }}
                  >
                    <div
                      style={{
                        width: `${uploadProgressPercent}%`,
                        height: "100%",
                        background: uploadProgressPercent === 100 ? "var(--clr-success)" : "var(--clr-brand)",
                        borderRadius: 4,
                        transition: "width 0.4s ease",
                      }}
                    />
                  </div>
                </div>
              )}

              <div style={{ marginTop: "var(--space-5)", display: "flex", justifyContent: "flex-end" }}>
                <button
                  type="submit"
                  disabled={uploading || (uploadMode === "paste" ? !pastedText.trim() : !uploadFile)}
                  className="btn btn-brand"
                  style={{ padding: "10px 24px", gap: 8 }}
                >
                  {uploading ? (
                    <>
                      <RefreshCw size={18} className="spin" />
                      <span>{uploadProgressStep || (isRtl ? "جاري المعالجة واستخراج النصوص..." : "Processing & Extracting...")}</span>
                    </>
                  ) : uploadMode === "paste" ? (
                    <>
                      <Save size={18} />
                      <span>{isRtl ? "💾 حفظ المنهج وفهرسته فوراً" : "💾 Save & Index Curriculum"}</span>
                    </>
                  ) : (
                    <>
                      <Upload size={18} />
                      <span>{isRtl ? "🚀 رفع وتحليل المنهج" : "🚀 Upload & Parse"}</span>
                    </>
                  )}
                </button>
              </div>
            </form>

            {/* Helpful Guide for Large Books */}
            <div
              style={{
                marginTop: "var(--space-4)",
                padding: "14px 18px",
                borderRadius: "var(--radius-md)",
                background: "rgba(99, 102, 241, 0.05)",
                border: "1px solid rgba(99, 102, 241, 0.2)",
                fontSize: "0.86rem",
                lineHeight: 1.6,
              }}
            >
              <strong style={{ color: "var(--clr-brand)", display: "flex", alignItems: "center", gap: 6, marginBottom: 6 }}>
                <Sparkles size={16} />
                {isRtl ? "💡 نصيحة لكتب الكليات الكبيرة والممسوحة ضوئياً (صور بدون طبقة نصوص):" : "💡 Tip for Large Scanned Textbooks (Images without text layer):"}
              </strong>
              <p style={{ margin: "0 0 8px", color: "var(--clr-text-secondary)" }}>
                {isRtl
                  ? "لأن معالجة 133 صفحة صور بالذكاء الاصطناعي تستنزف الكوتا المجانية وتتطلب وقتاً طويلاً، إليك أفضل حلين بديلين يوفران وقتك تماماً:"
                  : "Because visual OCR on 133 image pages exhausts free AI quotas, here are the two fastest alternatives:"}
              </p>
              <ul style={{ margin: 0, paddingInlineStart: 20, color: "var(--clr-text-primary)" }}>
                <li style={{ marginBottom: 6 }}>
                  <strong>{isRtl ? "⚡ طريقة مستندات Google المجانية (دقيقة واحدة فقط - موصى به):" : "⚡ Google Docs OCR (1 min - Recommended):"}</strong>{" "}
                  {isRtl
                    ? "ارفع الـ PDF على Google Drive ثم اضغط كليك يمين واختر 'فتح باستخدام مستندات Google'. سيقوم جوجل بقراءة الـ 133 صفحة واستخراج كل نصوصها مجاناً في دقيقة! نزله كملف Word (.docx) وارفعه هنا، أو انسخ نصوصه والصقها في خيار 'لصق النص'."
                    : "Upload PDF to Google Drive -> Open with Google Docs -> Download as Word (.docx) or copy-paste text here directly."}
                </li>
                <li>
                  <strong>{isRtl ? "📄 تحديد نطاق الصفحات (فصل بفصل):" : "📄 Page Range (Chapter by Chapter):"}</strong>{" "}
                  {isRtl
                    ? "حدد أرقام صفحات الفصل المطلوب فقط (مثلاً: 1-15 أو 20-35) في خانة 'نطاق الصفحات' ليتم استخراج صفحات الامتحان فقط في ثوانٍ دون استهلاك الكوتا."
                    : "Specify the exact chapter pages (e.g. 1-15) in the Page Range input to process just that chapter in seconds."}
                </li>
              </ul>
            </div>
          </div>

          {/* Materials Grid */}
          <div>
            <h3 style={{ fontSize: "1.15rem", marginBottom: "var(--space-4)", display: "flex", alignItems: "center", gap: 8 }}>
              <BookOpen size={20} color="var(--clr-brand)" />
              <span>{isRtl ? "المناهج والكتب الدراسية المتاحة" : "Available Study Materials"}</span>
            </h3>

            {materials.length === 0 ? (
              <div className="card" style={{ padding: 40, textAlign: "center", color: "var(--clr-text-muted)" }}>
                <BookOpen size={48} style={{ margin: "0 auto 12px", opacity: 0.5 }} />
                <h4>{isRtl ? "لا توجد مناهج مرفوعة بعد" : "No materials uploaded yet"}</h4>
                <p>{isRtl ? "قم برفع أول كتاب أو مذكرة لبدء توليد الأسئلة فوراً." : "Upload a textbook to get started."}</p>
              </div>
            ) : (
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(320px, 1fr))", gap: 16 }}>
                {materials.map((m) => (
                  <div
                    key={m.id}
                    className="card"
                    style={{
                      padding: "var(--space-5)",
                      display: "flex",
                      flexDirection: "column",
                      justifyContent: "space-between",
                    }}
                  >
                    <div>
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 8 }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                          <span
                            className={`badge ${
                              m.fileType === "pdf"
                                ? "badge-danger"
                                : m.fileType === "docx"
                                ? "badge-brand"
                                : m.fileType === "image"
                                ? "badge-warning"
                                : "badge-ghost"
                            }`}
                            style={{ fontSize: "0.75rem", textTransform: "uppercase" }}
                          >
                            {m.fileType === "image" ? "📸 OCR صورة" : m.fileType}
                          </span>
                          {m.ocrUsed && m.fileType !== "image" && (
                            <span
                              className="badge badge-warning"
                              style={{ fontSize: "0.72rem", padding: "2px 8px" }}
                              title={isRtl ? "تم استخراج النص بالتعرف البصري الذكي OCR" : "Transcribed via AI OCR"}
                            >
                              ✨ OCR
                            </span>
                          )}
                          {m.digitalFallback && (
                            <span
                              className="badge badge-brand"
                              style={{ fontSize: "0.72rem", padding: "2px 8px" }}
                              title={isRtl ? "تم استخراج النص الرقمي المباشر فائق الدقة" : "Direct Digital Text"}
                            >
                              ⚡ نصوص رقمية
                            </span>
                          )}
                        </div>
                        <span style={{ fontSize: "0.75rem", color: "var(--clr-text-muted)" }}>
                          {new Date(m.createdAt).toLocaleDateString()}
                        </span>
                      </div>

                      <h4 style={{ margin: "0 0 6px", fontSize: "1.05rem", color: "var(--clr-text-primary)" }}>
                        {m.title}
                      </h4>
                      <p style={{ margin: "0 0 12px", fontSize: "0.85rem", color: "var(--clr-text-secondary)" }}>
                        {m.subject} {m.grade ? `• ${m.grade}` : ""}
                      </p>

                      <div
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: 12,
                          fontSize: "0.8rem",
                          color: "var(--clr-text-muted)",
                          marginBottom: 12,
                        }}
                      >
                        <span>📝 {m.wordCount} {isRtl ? "كلمة" : "words"}</span>
                        <span>📑 {m.sections?.length || 1} {isRtl ? "أقسام" : "sections"}</span>
                      </div>

                      {/* Topic Tags */}
                      {m.topics && m.topics.length > 0 && (
                        <div style={{ display: "flex", flexWrap: "wrap", gap: 4, marginBottom: 16 }}>
                          {m.topics.slice(0, 4).map((t, idx) => (
                            <span
                              key={idx}
                              style={{
                                background: "var(--clr-bg-elevated)",
                                padding: "2px 8px",
                                borderRadius: "var(--radius-sm)",
                                fontSize: "0.75rem",
                                color: "var(--clr-text-secondary)",
                              }}
                            >
                              #{t}
                            </span>
                          ))}
                        </div>
                      )}
                    </div>

                    {/* Material Actions */}
                    <div
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 8,
                        borderTop: "1px solid var(--clr-border)",
                        paddingTop: 12,
                      }}
                    >
                      <button
                        type="button"
                        onClick={() => {
                          setSelectedMaterialId(m.id);
                          setSourceMode("material");
                          setActiveTab("generate");
                        }}
                        className="btn btn-brand btn-sm"
                        style={{ flex: 1, justifyContent: "center", gap: 6 }}
                      >
                        <Sparkles size={14} />
                        <span>{isRtl ? "توليد أسئلة الآن" : "Generate MCQs"}</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => handleOpenEditModal(m)}
                        className="btn btn-ghost btn-icon btn-sm"
                        style={{ color: "var(--clr-brand)" }}
                        title={isRtl ? "تعديل المنهج أو نصوص الكتاب" : "Edit Material"}
                      >
                        <Pencil size={16} />
                      </button>
                      <button
                        type="button"
                        onClick={() => setPreviewMaterial(m)}
                        className="btn btn-ghost btn-icon btn-sm"
                        title={isRtl ? "معاينة النص المستخرج" : "Preview text"}
                      >
                        <Eye size={16} />
                      </button>
                      {m.groupId !== "global" && (
                        <button
                          type="button"
                          onClick={() => handleDeleteMaterial(m.id)}
                          className="btn btn-ghost btn-icon btn-sm"
                          style={{ color: "var(--clr-danger)" }}
                          title={isRtl ? "حذف المادة" : "Delete"}
                        >
                          <Trash2 size={16} />
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* ═══════════════════════════════════════════════════════════
          TAB 3: AI USAGE, STATS & AUDIT LOGS
      ═══════════════════════════════════════════════════════════ */}
      {activeTab === "analytics" && (
        <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-6)" }}>
          {/* Key Metric Cards */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 16 }}>
            <div className="card" style={{ padding: "var(--space-5)" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
                <span style={{ fontSize: "0.85rem", color: "var(--clr-text-secondary)" }}>
                  {isRtl ? "إجمالي عمليات التوليد" : "Total Generations"}
                </span>
                <Sparkles size={20} color="var(--clr-brand)" />
              </div>
              <h2 style={{ fontSize: "2rem", fontWeight: 800, margin: 0, color: "var(--clr-text-primary)" }}>
                {analytics?.totalGenerations || 0}
              </h2>
            </div>

            <div className="card" style={{ padding: "var(--space-5)" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
                <span style={{ fontSize: "0.85rem", color: "var(--clr-text-secondary)" }}>
                  {isRtl ? "إجمالي الأسئلة المولدة" : "Total Questions"}
                </span>
                <CheckCircle2 size={20} color="var(--clr-success)" />
              </div>
              <h2 style={{ fontSize: "2rem", fontWeight: 800, margin: 0, color: "var(--clr-text-primary)" }}>
                {analytics?.totalQuestions || 0}
              </h2>
            </div>

            <div className="card" style={{ padding: "var(--space-5)" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
                <span style={{ fontSize: "0.85rem", color: "var(--clr-text-secondary)" }}>
                  {isRtl ? "استهلاك الـ Tokens التقديري" : "Estimated Tokens"}
                </span>
                <TrendingUp size={20} color="var(--clr-warning)" />
              </div>
              <h2 style={{ fontSize: "2rem", fontWeight: 800, margin: 0, color: "var(--clr-text-primary)" }}>
                {(analytics?.totalTokens || 0).toLocaleString()}
              </h2>
            </div>

            <div className="card" style={{ padding: "var(--space-5)" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
                <span style={{ fontSize: "0.85rem", color: "var(--clr-text-secondary)" }}>
                  {isRtl ? "المعلمين والمشرفين النشطين" : "Active Users"}
                </span>
                <Users size={20} color="var(--clr-accent)" />
              </div>
              <h2 style={{ fontSize: "2rem", fontWeight: 800, margin: 0, color: "var(--clr-text-primary)" }}>
                {analytics?.activeUsersCount || 0}
              </h2>
            </div>
          </div>

          {/* Student Performance & Live Results Metrics ("وما النتائج") */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 16 }}>
            <div className="card" style={{ padding: "var(--space-5)", background: "rgba(16, 185, 129, 0.05)", border: "1px solid rgba(16, 185, 129, 0.3)" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
                <span style={{ fontSize: "0.85rem", color: "var(--clr-text-secondary)" }}>
                  {isRtl ? "مشاركات وحلول الطلاب" : "Student Submissions"}
                </span>
                <GraduationCap size={20} color="var(--clr-success)" />
              </div>
              <h2 style={{ fontSize: "2rem", fontWeight: 800, margin: 0, color: "var(--clr-text-primary)" }}>
                {analytics?.studentParticipants || 0}
              </h2>
            </div>

            <div className="card" style={{ padding: "var(--space-5)", background: "rgba(99, 102, 241, 0.05)", border: "1px solid rgba(99, 102, 241, 0.3)" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
                <span style={{ fontSize: "0.85rem", color: "var(--clr-text-secondary)" }}>
                  {isRtl ? "متوسط درجات الطلاب" : "Average Exam Score"}
                </span>
                <TrendingUp size={20} color="var(--clr-brand)" />
              </div>
              <h2 style={{ fontSize: "2rem", fontWeight: 800, margin: 0, color: "var(--clr-text-primary)" }}>
                {analytics?.averageScore ? `${analytics.averageScore}%` : "—"}
              </h2>
            </div>

            <div className="card" style={{ padding: "var(--space-5)", background: "rgba(245, 158, 11, 0.05)", border: "1px solid rgba(245, 158, 11, 0.3)" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
                <span style={{ fontSize: "0.85rem", color: "var(--clr-text-secondary)" }}>
                  {isRtl ? "نسبة النجاح العامة" : "Pass Rate"}
                </span>
                <ShieldCheck size={20} color="var(--clr-warning)" />
              </div>
              <h2 style={{ fontSize: "2rem", fontWeight: 800, margin: 0, color: "var(--clr-text-primary)" }}>
                {analytics?.passRate ? `${analytics.passRate}%` : "—"}
              </h2>
            </div>

            <div className="card" style={{ padding: "var(--space-5)", background: "rgba(59, 130, 246, 0.05)", border: "1px solid rgba(59, 130, 246, 0.3)" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
                <span style={{ fontSize: "0.85rem", color: "var(--clr-text-secondary)" }}>
                  {isRtl ? "الكويزات المنشورة في تليجرام" : "Broadcasted Quizzes"}
                </span>
                <Send size={20} color="#3b82f6" />
              </div>
              <h2 style={{ fontSize: "2rem", fontWeight: 800, margin: 0, color: "var(--clr-text-primary)" }}>
                {analytics?.broadcastedQuizzesCount || 0}
              </h2>
            </div>
          </div>

          {/* User Leaderboard & Materials Usage */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))", gap: 16 }}>
            {/* User Usage Leaderboard */}
            <div className="card" style={{ padding: "var(--space-5)" }}>
              <h3 style={{ fontSize: "1.05rem", marginBottom: "var(--space-4)", display: "flex", alignItems: "center", gap: 8 }}>
                <Users size={18} color="var(--clr-brand)" />
                <span>{isRtl ? "المعلمون الأكثر استخداماً للمولد" : "Instructor Activity Leaderboard"}</span>
              </h3>

              {!analytics?.userLeaderboard || analytics.userLeaderboard.length === 0 ? (
                <p style={{ color: "var(--clr-text-muted)", fontSize: "0.9rem" }}>
                  {isRtl ? "لا توجد سجلات استخدام مسجلة بعد." : "No usage logs yet."}
                </p>
              ) : (
                <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                  {analytics.userLeaderboard.map((u, idx) => (
                    <div
                      key={u.userId}
                      style={{
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "space-between",
                        padding: "8px 12px",
                        background: "var(--clr-bg-elevated)",
                        borderRadius: "var(--radius-md)",
                      }}
                    >
                      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                        <span style={{ fontWeight: 700, color: "var(--clr-text-muted)", fontSize: "0.85rem" }}>
                          #{idx + 1}
                        </span>
                        <div
                          style={{
                            width: 32,
                            height: 32,
                            borderRadius: "50%",
                            background: "var(--grad-brand)",
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "center",
                            fontSize: "0.85rem",
                            fontWeight: 700,
                            color: "#fff",
                          }}
                        >
                          {u.userName.charAt(0)}
                        </div>
                        <div>
                          <strong style={{ fontSize: "0.9rem", color: "var(--clr-text-primary)", display: "block" }}>
                            {u.userName}
                          </strong>
                          {u.userUsername && (
                            <span style={{ fontSize: "0.75rem", color: "var(--clr-text-muted)" }}>
                              @{u.userUsername}
                            </span>
                          )}
                        </div>
                      </div>

                      <div style={{ textAlign: isRtl ? "left" : "right" }}>
                        <span style={{ fontWeight: 700, color: "var(--clr-brand)", fontSize: "0.95rem", display: "block" }}>
                          {u.questionsCount} {isRtl ? "سؤال" : "Q"}
                        </span>
                        <span style={{ fontSize: "0.75rem", color: "var(--clr-text-muted)" }}>
                          {u.generationsCount} {isRtl ? "عملية" : "runs"}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Most Utilized Materials */}
            <div className="card" style={{ padding: "var(--space-5)" }}>
              <h3 style={{ fontSize: "1.05rem", marginBottom: "var(--space-4)", display: "flex", alignItems: "center", gap: 8 }}>
                <BookOpen size={18} color="var(--clr-brand)" />
                <span>{isRtl ? "المناهج الأكثر توليداً للأسئلة" : "Top Utilized Materials"}</span>
              </h3>

              {!analytics?.materialsUsage || analytics.materialsUsage.length === 0 ? (
                <p style={{ color: "var(--clr-text-muted)", fontSize: "0.9rem" }}>
                  {isRtl ? "لا توجد مواد مسجلة في العمليات." : "No materials used yet."}
                </p>
              ) : (
                <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                  {analytics.materialsUsage.map((m) => (
                    <div
                      key={m.materialTitle}
                      style={{
                        padding: "8px 12px",
                        background: "var(--clr-bg-elevated)",
                        borderRadius: "var(--radius-md)",
                        display: "flex",
                        justifyContent: "space-between",
                        alignItems: "center",
                      }}
                    >
                      <strong style={{ fontSize: "0.9rem", color: "var(--clr-text-primary)" }}>
                        {m.materialTitle}
                      </strong>
                      <span className="badge badge-brand" style={{ fontSize: "0.8rem" }}>
                        {m.questionsCount} {isRtl ? "سؤال" : "questions"}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Audit Logs Table */}
          <div className="card" style={{ padding: "var(--space-5)" }}>
            <h3 style={{ fontSize: "1.05rem", marginBottom: "var(--space-4)", display: "flex", alignItems: "center", gap: 8 }}>
              <Clock size={18} color="var(--clr-brand)" />
              <span>{isRtl ? "سجل عمليات التوليد الحديثة (Audit Log)" : "Recent AI Generation Logs"}</span>
            </h3>

            {!analytics?.recentLogs || analytics.recentLogs.length === 0 ? (
              <p style={{ color: "var(--clr-text-muted)", fontSize: "0.9rem" }}>
                {isRtl ? "لا توجد سجلات بعد." : "No logs available."}
              </p>
            ) : (
              <div style={{ overflowX: "auto" }}>
                <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.88rem" }}>
                  <thead>
                    <tr style={{ borderBottom: "1px solid var(--clr-border)", textAlign: isRtl ? "right" : "left", color: "var(--clr-text-muted)" }}>
                      <th style={{ padding: "10px 12px" }}>{isRtl ? "الوقت" : "Time"}</th>
                      <th style={{ padding: "10px 12px" }}>{isRtl ? "المعلم" : "User"}</th>
                      <th style={{ padding: "10px 12px" }}>{isRtl ? "المادة / النص" : "Material"}</th>
                      <th style={{ padding: "10px 12px" }}>{isRtl ? "الأسئلة" : "Questions"}</th>
                      <th style={{ padding: "10px 12px" }}>{isRtl ? "النموذج" : "Model"}</th>
                      <th style={{ padding: "10px 12px" }}>{isRtl ? "الـ Tokens" : "Tokens"}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {analytics.recentLogs.map((l) => (
                      <tr key={l.id} style={{ borderBottom: "1px solid var(--clr-border)" }}>
                        <td style={{ padding: "10px 12px", color: "var(--clr-text-secondary)" }}>
                          {new Date(l.timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                        </td>
                        <td style={{ padding: "10px 12px", fontWeight: 600 }}>{l.userName}</td>
                        <td style={{ padding: "10px 12px", color: "var(--clr-text-secondary)" }}>{l.materialTitle}</td>
                        <td style={{ padding: "10px 12px" }}>
                          <span className="badge badge-success" style={{ fontSize: "0.75rem" }}>
                            +{l.questionCount}
                          </span>
                        </td>
                        <td style={{ padding: "10px 12px", color: "var(--clr-text-muted)", fontSize: "0.8rem" }}>
                          {l.modelUsed}
                        </td>
                        <td style={{ padding: "10px 12px", color: "var(--clr-text-muted)" }}>
                          ~{l.estimatedTokens}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ═══════════════════════════════════════════════════════════
          TAB 4: AI SETTINGS
      ═══════════════════════════════════════════════════════════ */}
      {activeTab === "settings" && (
        <div style={{ maxWidth: 760, display: "flex", flexDirection: "column", gap: "var(--space-6)" }}>
          <div className="card" style={{ padding: "var(--space-6)" }}>
            <h3 style={{ fontSize: "1.15rem", marginBottom: "var(--space-2)", display: "flex", alignItems: "center", gap: 8 }}>
              <Key size={20} color="var(--clr-brand)" />
              <span>{isRtl ? "مفتاح Google Gemini API Key" : "Google Gemini API Key"}</span>
            </h3>
            <p style={{ color: "var(--clr-text-secondary)", fontSize: "0.85rem", marginBottom: "var(--space-4)" }}>
              {isRtl
                ? "يمكنك استخدام مفتاح مجاني تماماً من Google AI Studio لتوليد آلاف الأسئلة شهرياً بدون أي تكلفة."
                : "Obtain a free API Key from Google AI Studio to power zero-hallucination generations."}
            </p>

            {/* Persistent Key Active Indicator */}
            {(settings?.hasApiKey || (typeof window !== "undefined" && isValidApiKey(localStorage.getItem("gemini_api_key")))) && (
              <div
                style={{
                  background: "rgba(16, 185, 129, 0.1)",
                  border: "1px solid rgba(16, 185, 129, 0.35)",
                  padding: "10px 14px",
                  borderRadius: "var(--radius-md)",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  gap: 12,
                  marginBottom: 16,
                  color: "var(--clr-success)",
                  fontSize: "0.88rem",
                  fontWeight: 600,
                }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <CheckCircle2 size={18} />
                  <span>{isRtl ? "✅ مفتاح Google Gemini API محفوظ ومفعّل وجاهز للاستخدام بدون الحاجة لإعادة كتابته" : "✅ Gemini API Key is saved and active"}</span>
                </div>
              </div>
            )}

            <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
              <input
                type={showApiKey ? "text" : "password"}
                className="input"
                placeholder={isRtl ? "أدخل مفتاح Google Gemini API Key هنا..." : "Enter Gemini API Key..."}
                value={apiKeyInput}
                onChange={(e) => setApiKeyInput(e.target.value)}
                style={{ flex: 1, fontFamily: "monospace" }}
              />
              <button
                type="button"
                onClick={() => setShowApiKey(!showApiKey)}
                className="btn btn-ghost btn-sm"
              >
                {showApiKey ? (isRtl ? "إخفاء" : "Hide") : (isRtl ? "إظهار" : "Show")}
              </button>
              <button
                type="button"
                onClick={handleTestConnection}
                disabled={testingKey}
                className="btn btn-ghost btn-sm"
                style={{ gap: 6 }}
              >
                {testingKey ? <RefreshCw size={14} className="spin" /> : <ShieldCheck size={14} />}
                <span>{isRtl ? "فحص الاتصال" : "Test"}</span>
              </button>
            </div>

            {testResult && (
              <div
                style={{
                  padding: "10px 14px",
                  borderRadius: "var(--radius-md)",
                  background: testResult.success ? "rgba(16, 185, 129, 0.12)" : "rgba(244, 63, 94, 0.12)",
                  color: testResult.success ? "var(--clr-success)" : "var(--clr-danger)",
                  fontSize: "0.85rem",
                  marginBottom: 16,
                  display: "flex",
                  alignItems: "flex-start",
                  gap: 10,
                  lineHeight: 1.5,
                }}
              >
                <div style={{ marginTop: 2 }}>
                  {testResult.success ? <CheckCircle2 size={18} /> : <AlertTriangle size={18} />}
                </div>
                <div style={{ flex: 1 }}>
                  <div style={{ fontWeight: 600 }}>
                    {testResult.success ? (isRtl ? "تم التحقق بنجاح!" : "Connection Verified!") : (isRtl ? "فشل التحقق" : "Verification Failed")}
                  </div>
                  <div style={{ marginTop: 2 }}>{testResult.message}</div>
                  {testResult.activeModel && (
                    <div style={{ fontSize: "0.78rem", opacity: 0.9, marginTop: 4 }}>
                      {isRtl ? "النموذج النشط المعتمد:" : "Active Model:"}{" "}
                      <code style={{ fontWeight: 700, padding: "1px 6px", borderRadius: 4, background: "rgba(0,0,0,0.06)" }}>
                        {testResult.activeModel}
                      </code>
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* Model Selector */}
            <div style={{ marginBottom: 16 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
                <label style={{ fontSize: "0.85rem", color: "var(--clr-text-secondary)", margin: 0 }}>
                  {isRtl ? "النموذج المفضل (Model):" : "Preferred Gemini Model:"}
                </label>
                <button
                  type="button"
                  className="btn btn-outline"
                  onClick={handleAutoDetectModels}
                  disabled={testingKey || detectingModels}
                  style={{
                    padding: "3px 8px",
                    fontSize: "0.75rem",
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 5,
                    height: "auto",
                    borderRadius: "var(--radius-sm)",
                    cursor: "pointer",
                  }}
                  title={isRtl ? "فحص واكتشاف النماذج المدعومة لمفتاحك" : "Discover supported models for your key"}
                >
                  <Sparkles size={12} />
                  <span>
                    {detectingModels
                      ? (isRtl ? "جارِ الفحص..." : "Detecting...")
                      : (isRtl ? "اكتشاف النماذج النشطة" : "Auto-detect Models")}
                  </span>
                </button>
              </div>

              <select
                className="select"
                value={
                  isCustomModel ||
                  (settings?.defaultModel &&
                    !["gemini-3.8-flash", "gemini-2.5-flash", "gemini-2.5-pro", "gemini-2.0-flash", "gemini-1.5-flash", "gemini-1.5-pro"].includes(settings.defaultModel) &&
                    !availableModels.some((m) => m.id === settings.defaultModel))
                    ? "__custom__"
                    : (settings?.defaultModel || "gemini-3.8-flash")
                }
                onChange={(e: any) => {
                  const val = e.target.value;
                  if (val === "__custom__") {
                    setIsCustomModel(true);
                  } else {
                    setIsCustomModel(false);
                    setSettings((prev) => (prev ? { ...prev, defaultModel: val } : null));
                  }
                }}
                style={{ width: "100%" }}
              >
                <option value="gemini-3.8-flash">
                  gemini-3.8-flash ({isRtl ? "الأحدث والأسرع - موصى به" : "Latest & Fastest - Recommended"})
                </option>
                <option value="gemini-2.5-flash">
                  gemini-2.5-flash ({isRtl ? "أداء متوازن وسريع" : "Fast & Balanced"})
                </option>
                <option value="gemini-2.5-pro">
                  gemini-2.5-pro ({isRtl ? "تفكير تحليلي متقدم" : "Advanced Reasoning"})
                </option>
                <option value="gemini-2.0-flash">
                  gemini-2.0-flash ({isRtl ? "الجيل السابق" : "Previous Generation"})
                </option>
                <option value="gemini-1.5-flash">
                  gemini-1.5-flash ({isRtl ? "سريع مع نافذة سياق 1M Token" : "Fast & Lightweight"})
                </option>
                <option value="gemini-1.5-pro">
                  gemini-1.5-pro ({isRtl ? "تفكير أكاديمي متقدم للكتب الضخمة" : "Deep Academic Reasoning"})
                </option>
                {/* Dynamically detected extra models */}
                {availableModels
                  .filter((m) => !["gemini-3.8-flash", "gemini-2.5-flash", "gemini-2.5-pro", "gemini-2.0-flash", "gemini-1.5-flash", "gemini-1.5-pro"].includes(m.id))
                  .map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.id} {m.displayName && m.displayName !== m.id ? `(${m.displayName})` : `(${isRtl ? "مكتشف من حسابك" : "Discovered"})`}
                    </option>
                  ))}
                <option value="__custom__">
                  ✍️ {isRtl ? "إدخال نموذج مخصص يدويًا..." : "Enter custom model ID..."}
                </option>
              </select>

              {(isCustomModel ||
                (settings?.defaultModel &&
                  !["gemini-3.8-flash", "gemini-2.5-flash", "gemini-2.5-pro", "gemini-2.0-flash", "gemini-1.5-flash", "gemini-1.5-pro"].includes(settings.defaultModel) &&
                  !availableModels.some((m) => m.id === settings.defaultModel))) && (
                <div style={{ marginTop: 8 }}>
                  <input
                    type="text"
                    className="input"
                    value={settings?.defaultModel || ""}
                    placeholder="e.g. gemini-3.8-flash, gemini-exp..."
                    onChange={(e) => {
                      const val = e.target.value;
                      setSettings((prev) => (prev ? { ...prev, defaultModel: val } : null));
                    }}
                    onBlur={(e) => {
                      const val = e.target.value.trim().replace(/^\/?models\//, "");
                      setSettings((prev) => (prev ? { ...prev, defaultModel: val || "gemini-3.8-flash" } : null));
                    }}
                    style={{ width: "100%", fontFamily: "monospace", fontSize: "0.85rem" }}
                  />
                  <span style={{ fontSize: "0.75rem", color: "var(--clr-text-muted)", marginTop: 4, display: "block" }}>
                    {isRtl
                      ? "يمكنك كتابة اسم أي نموذج تجريبي أو مخصص تدعمه واجهة Gemini API."
                      : "Specify any custom model ID supported by your Gemini API key."}
                  </span>
                </div>
              )}
            </div>

            {/* Default Count & Difficulty Row */}
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, marginBottom: 16 }}>
              <div>
                <label style={{ display: "block", marginBottom: 6, fontSize: "0.85rem", color: "var(--clr-text-secondary)" }}>
                  {isRtl ? "العدد الافتراضي للأسئلة:" : "Default Question Count:"}
                </label>
                <select
                  className="select"
                  value={settings?.defaultCount || 5}
                  onChange={(e) => {
                    const cnt = Number(e.target.value) || 5;
                    setSettings((prev) => prev ? { ...prev, defaultCount: cnt } : null);
                  }}
                  style={{ width: "100%" }}
                >
                  <option value={3}>3 {isRtl ? "أسئلة" : "questions"}</option>
                  <option value={5}>5 {isRtl ? "أسئلة (موصى به)" : "questions (Recommended)"}</option>
                  <option value={10}>10 {isRtl ? "أسئلة" : "questions"}</option>
                  <option value={15}>15 {isRtl ? "سؤالاً" : "questions"}</option>
                  <option value={20}>20 {isRtl ? "سؤالاً" : "questions"}</option>
                </select>
              </div>

              <div>
                <label style={{ display: "block", marginBottom: 6, fontSize: "0.85rem", color: "var(--clr-text-secondary)" }}>
                  {isRtl ? "مستوى الصعوبة الافتراضي:" : "Default Difficulty:"}
                </label>
                <select
                  className="select"
                  value={settings?.defaultDifficulty || "mixed"}
                  onChange={(e: any) =>
                    setSettings((prev) => prev ? { ...prev, defaultDifficulty: e.target.value } : null)
                  }
                  style={{ width: "100%" }}
                >
                  <option value="mixed">{isRtl ? "متوازن (مزيج تعليمي متدرج)" : "Balanced / Mixed"}</option>
                  <option value="easy">{isRtl ? "مباشر وسهل (تذكر واسترجاع)" : "Easy / Recall"}</option>
                  <option value="medium">{isRtl ? "متوسط (فهم واستيعاب)" : "Medium / Comprehension"}</option>
                  <option value="hard">{isRtl ? "متقدم (تحليل ومهارات عليا)" : "Hard / Higher-Order"}</option>
                </select>
              </div>
            </div>

            {/* Strict Grounding Toggle */}
            <div
              style={{
                background: "var(--clr-bg-elevated)",
                padding: "12px 16px",
                borderRadius: "var(--radius-md)",
                border: "1px solid var(--clr-border)",
                marginBottom: 16,
                display: "flex",
                alignItems: "flex-start",
                gap: 12,
              }}
            >
              <input
                type="checkbox"
                id="strictGroundingToggle"
                checked={settings?.strictGrounding ?? true}
                onChange={(e) =>
                  setSettings((prev) => prev ? { ...prev, strictGrounding: e.target.checked } : null)
                }
                style={{ width: 18, height: 18, marginTop: 3, cursor: "pointer" }}
              />
              <label htmlFor="strictGroundingToggle" style={{ cursor: "pointer", flex: 1 }}>
                <strong style={{ display: "block", fontSize: "0.95rem", color: "var(--clr-text-primary)", marginBottom: 2 }}>
                  {isRtl ? "تفعيل التحقق الصارم ومنع الهلوسة بنسبة 100% (Strict Academic Grounding)" : "Strict Zero-Hallucination Grounding"}
                </strong>
                <span style={{ fontSize: "0.82rem", color: "var(--clr-text-secondary)", display: "block" }}>
                  {isRtl
                    ? "يجبر الذكاء الاصطناعي على الاعتماد الحصري على نصوص المنهج المرفوعة فقط بدون اختراع أو حقائق خارجية، ويلزمه بإرفاق الاقتباس النصي الدقيق لكل سؤال."
                    : "Forces AI to base questions strictly on uploaded text excerpts and provide verbatim quotes."}
                </span>
              </label>
            </div>

            {/* Custom System Instruction */}
            <div style={{ marginBottom: 16 }}>
              <label style={{ display: "block", marginBottom: 6, fontSize: "0.85rem", color: "var(--clr-text-secondary)" }}>
                {isRtl ? "تعليمات مخصصة ثابتة للنموذج (System Prompt):" : "Custom System Prompt:"}
              </label>
              <textarea
                className="textarea"
                rows={3}
                placeholder={
                  isRtl
                    ? "مثال: اعتمد أسلوب وصيغ اختبارات الثانوية العامة المصرية، وضع الخيارات بالترتيب المنطقي."
                    : "e.g., Follow Egyptian/Saudi curriculum examination style."
                }
                value={settings?.systemInstruction || ""}
                onChange={(e) =>
                  setSettings((prev) => prev ? { ...prev, systemInstruction: e.target.value } : null)
                }
                style={{ width: "100%" }}
              />
            </div>

            <div style={{ display: "flex", justifyContent: "flex-end" }}>
              <button
                type="button"
                onClick={handleSaveSettings}
                disabled={savingSettings}
                className="btn btn-brand"
                style={{ padding: "10px 24px", gap: 8 }}
              >
                {savingSettings ? <RefreshCw size={16} className="spin" /> : <Save size={16} />}
                <span>{isRtl ? "حفظ التغييرات" : "Save Settings"}</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ═══════════════════════════════════════════════════════════
          MODAL 1: CREATE FULL EXAM
      ═══════════════════════════════════════════════════════════ */}
      {showExamModal && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            zIndex: 1000,
            background: "rgba(0,0,0,0.75)",
            backdropFilter: "blur(8px)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: 16,
          }}
        >
          <div className="card" style={{ width: "100%", maxWidth: 500, padding: 24 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
              <h3 style={{ margin: 0, display: "flex", alignItems: "center", gap: 8 }}>
                <GraduationCap size={20} color="var(--clr-brand)" />
                <span>{isRtl ? "إنشاء اختبار إلكتروني كامل" : "Create Online Exam"}</span>
              </h3>
              <button className="btn btn-ghost btn-icon" onClick={() => setShowExamModal(false)}>
                ✕
              </button>
            </div>

            <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
              <div>
                <label style={{ display: "block", marginBottom: 6, fontSize: "0.85rem", color: "var(--clr-text-secondary)" }}>
                  {isRtl ? "عنوان الاختبار:" : "Exam Title:"}
                </label>
                <input
                  type="text"
                  className="input"
                  value={examTitle}
                  onChange={(e) => setExamTitle(e.target.value)}
                  style={{ width: "100%" }}
                />
              </div>

              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                <div>
                  <label style={{ display: "block", marginBottom: 6, fontSize: "0.85rem", color: "var(--clr-text-secondary)" }}>
                    {isRtl ? "المدة الزمنية (بالدقائق):" : "Time Limit (minutes):"}
                  </label>
                  <input
                    type="number"
                    className="input"
                    min={1}
                    max={180}
                    value={examTimeLimit}
                    onChange={(e) => setExamTimeLimit(Number(e.target.value))}
                    style={{ width: "100%" }}
                  />
                </div>
                <div>
                  <label style={{ display: "block", marginBottom: 6, fontSize: "0.85rem", color: "var(--clr-text-secondary)" }}>
                    {isRtl ? "نسبة النجاح (%):" : "Passing Score (%):"}
                  </label>
                  <input
                    type="number"
                    className="input"
                    min={10}
                    max={100}
                    value={examPassingScore}
                    onChange={(e) => setExamPassingScore(Number(e.target.value))}
                    style={{ width: "100%" }}
                  />
                </div>
              </div>

              <div
                style={{
                  background: "var(--clr-bg-elevated)",
                  padding: "10px 14px",
                  borderRadius: "var(--radius-md)",
                  fontSize: "0.85rem",
                  color: "var(--clr-text-secondary)",
                }}
              >
                <span>
                  {isRtl
                    ? `سيحتوي الاختبار على ${selectedQuestions.length} أسئلة مختارة، وسيتم نشره فوراً في قسم الاختبارات.`
                    : `Will include ${selectedQuestions.length} selected questions.`}
                </span>
              </div>
            </div>

            <div style={{ marginTop: 24, display: "flex", justifyContent: "flex-end", gap: 10 }}>
              <button className="btn btn-ghost" onClick={() => setShowExamModal(false)}>
                {isRtl ? "إلغاء" : "Cancel"}
              </button>
              <button
                className="btn btn-brand"
                onClick={handleCreateExam}
                disabled={creatingExam}
                style={{ gap: 8 }}
              >
                {creatingExam ? <RefreshCw size={16} className="spin" /> : <Check size={16} />}
                <span>{isRtl ? "إنشاء الاختبار الآن" : "Create Exam"}</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ═══════════════════════════════════════════════════════════
          MODAL 2: BROADCAST TO TELEGRAM
      ═══════════════════════════════════════════════════════════ */}
      {showBroadcastModal && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            zIndex: 1000,
            background: "rgba(0,0,0,0.75)",
            backdropFilter: "blur(8px)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: 16,
          }}
        >
          <div className="card" style={{ width: "100%", maxWidth: 500, padding: 24 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
              <h3 style={{ margin: 0, display: "flex", alignItems: "center", gap: 8 }}>
                <Send size={20} color="var(--clr-success)" />
                <span>{isRtl ? "نشر الأسئلة في تليجرام" : "Broadcast to Telegram"}</span>
              </h3>
              <button className="btn btn-ghost btn-icon" onClick={() => setShowBroadcastModal(false)}>
                ✕
              </button>
            </div>

            <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
              {topics.length > 0 && (
                <div>
                  <label style={{ display: "block", marginBottom: 6, fontSize: "0.85rem", color: "var(--clr-text-secondary)" }}>
                    {isRtl ? "الموضوع أو التوبيك المستهدف (Forum Thread):" : "Target Topic/Thread:"}
                  </label>
                  <select
                    className="select"
                    value={broadcastTopicId || ""}
                    onChange={(e) => setBroadcastTopicId(e.target.value ? Number(e.target.value) : undefined)}
                    style={{ width: "100%" }}
                  >
                    <option value="">{isRtl ? "القناة / المجموعة العامة (بدون توبيك)" : "Main Chat"}</option>
                    {topics.map((t) => (
                      <option key={t.message_thread_id} value={t.message_thread_id}>
                        {t.name}
                      </option>
                    ))}
                  </select>
                </div>
              )}

              <div>
                <label style={{ display: "block", marginBottom: 6, fontSize: "0.85rem", color: "var(--clr-text-secondary)" }}>
                  {isRtl ? "مدة إغلاق التصويت (Timer):" : "Poll Close Timer:"}
                </label>
                <select
                  className="select"
                  value={broadcastOpenPeriod}
                  onChange={(e) => setBroadcastOpenPeriod(Number(e.target.value))}
                  style={{ width: "100%" }}
                >
                  <option value={0}>{isRtl ? "مفتوح دائماً (بدون مؤقت)" : "Always Open"}</option>
                  <option value={30}>{isRtl ? "30 ثانية" : "30 seconds"}</option>
                  <option value={60}>{isRtl ? "دقيقة واحدة" : "1 minute"}</option>
                  <option value={120}>{isRtl ? "دقيقتان" : "2 minutes"}</option>
                  <option value={300}>{isRtl ? "5 دقائق" : "5 minutes"}</option>
                </select>
              </div>

              <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 4 }}>
                <input
                  type="checkbox"
                  id="anonPoll"
                  checked={broadcastAnonymous}
                  onChange={(e) => setBroadcastAnonymous(e.target.checked)}
                  style={{ width: 16, height: 16 }}
                />
                <label htmlFor="anonPoll" style={{ fontSize: "0.85rem", cursor: "pointer" }}>
                  {isRtl ? "تصويت مجهول (Anonymous Poll)" : "Anonymous Voting"}
                </label>
              </div>

              <div>
                <label style={{ display: "block", marginBottom: 6, fontSize: "0.85rem", color: "var(--clr-text-secondary)" }}>
                  {isRtl ? "⏰ جدولة الإرسال لوقت لاحق (اختياري):" : "Schedule for later (Optional):"}
                </label>
                <input
                  type="datetime-local"
                  className="input"
                  value={broadcastScheduledAt}
                  onChange={(e) => setBroadcastScheduledAt(e.target.value)}
                  style={{ width: "100%", fontSize: "0.85rem" }}
                />
                <span style={{ fontSize: "0.75rem", color: "var(--clr-text-muted)", display: "block", marginTop: 4 }}>
                  {isRtl ? "اتركه فارغاً للبث الفوري الآن إلى تليجرام." : "Leave empty to broadcast immediately."}
                </span>
              </div>

              <div
                style={{
                  background: "var(--clr-bg-elevated)",
                  padding: "10px 14px",
                  borderRadius: "var(--radius-md)",
                  fontSize: "0.85rem",
                  color: "var(--clr-text-secondary)",
                }}
              >
                <span>
                  {broadcastScheduledAt
                    ? (isRtl
                        ? `سيتم حفظ ${selectedQuestions.length} سؤال في قائمة الجدولة وإرسالها تلقائياً في الموعد المحدد.`
                        : `Will schedule ${selectedQuestions.length} questions for automatic dispatch.`)
                    : (isRtl
                        ? `سيتم إرسال ${selectedQuestions.length} سؤال بالتتابع مع الالتزام الصارم بحدود ومعدلات تليجرام لمنع الحظر.`
                        : `Will sequentially broadcast ${selectedQuestions.length} questions.`)}
                </span>
              </div>
            </div>

            <div style={{ marginTop: 24, display: "flex", justifyContent: "flex-end", gap: 10 }}>
              <button className="btn btn-ghost" onClick={() => setShowBroadcastModal(false)}>
                {isRtl ? "إلغاء" : "Cancel"}
              </button>
              <button
                className="btn btn-success"
                onClick={handleBroadcast}
                disabled={broadcasting}
                style={{ gap: 8, background: "var(--clr-success)", color: "#fff" }}
              >
                {broadcasting ? <RefreshCw size={16} className="spin" /> : <Send size={16} />}
                <span>
                  {broadcastScheduledAt
                    ? (isRtl ? "جدولة الإرسال الآن" : "Schedule Broadcast")
                    : (isRtl ? "بدء الإرسال الآن" : "Start Broadcast")}
                </span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ═══════════════════════════════════════════════════════════
          MODAL 3: PREVIEW EXTRACTED TEXT
      ═══════════════════════════════════════════════════════════ */}
      {previewMaterial && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            zIndex: 1000,
            background: "rgba(0,0,0,0.75)",
            backdropFilter: "blur(8px)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: 16,
          }}
        >
          <div
            className="card"
            style={{
              width: "100%",
              maxWidth: 700,
              maxHeight: "85vh",
              display: "flex",
              flexDirection: "column",
              padding: 24,
            }}
          >
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
              <div>
                <h3 style={{ margin: 0 }}>{previewMaterial.title}</h3>
                <span style={{ fontSize: "0.85rem", color: "var(--clr-text-secondary)" }}>
                  {previewMaterial.wordCount} {isRtl ? "كلمة" : "words"} • {previewMaterial.charCount} {isRtl ? "حرف" : "chars"}
                </span>
              </div>
              <button className="btn btn-ghost btn-icon" onClick={() => setPreviewMaterial(null)}>
                ✕
              </button>
            </div>

            <div
              style={{
                flex: 1,
                overflowY: "auto",
                background: "var(--clr-bg-surface)",
                padding: 16,
                borderRadius: "var(--radius-md)",
                whiteSpace: "pre-wrap",
                fontFamily: "var(--font-body)",
                fontSize: "0.9rem",
                lineHeight: 1.7,
                color: "var(--clr-text-secondary)",
              }}
            >
              {previewMaterial.cleanedText}
            </div>

            <div style={{ marginTop: 16, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <button
                type="button"
                className="btn btn-brand btn-sm"
                style={{ gap: 6 }}
                onClick={() => {
                  const target = previewMaterial;
                  setPreviewMaterial(null);
                  if (target) handleOpenEditModal(target);
                }}
              >
                <Pencil size={15} />
                <span>{isRtl ? "تعديل هذا المنهج / الكتاب" : "Edit this material"}</span>
              </button>
              <button className="btn btn-ghost" onClick={() => setPreviewMaterial(null)}>
                {isRtl ? "إغلاق" : "Close"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ═══════════════════════════════════════════════════════════
          MODAL 4: EDIT CURRICULUM MATERIAL
      ═══════════════════════════════════════════════════════════ */}
      {showEditModal && editingMaterial && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            zIndex: 1000,
            background: "rgba(0,0,0,0.75)",
            backdropFilter: "blur(8px)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: 16,
          }}
        >
          <div
            className="card"
            style={{
              width: "100%",
              maxWidth: 820,
              maxHeight: "90vh",
              display: "flex",
              flexDirection: "column",
              padding: 24,
            }}
          >
            {/* Modal Header */}
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 16 }}>
              <div>
                <h3 style={{ margin: "0 0 4px", display: "flex", alignItems: "center", gap: 8, fontSize: "1.25rem" }}>
                  <Pencil size={20} color="var(--clr-brand)" />
                  <span>{isRtl ? "تعديل وتخصيص المنهج / الكتاب" : "Edit Curriculum Material"}</span>
                </h3>
                <span style={{ fontSize: "0.85rem", color: "var(--clr-text-secondary)" }}>
                  {editingMaterial.title} • {editText.split(/\s+/).filter(Boolean).length} {isRtl ? "كلمة" : "words"} • {editSections.length} {isRtl ? "فصول وأقسام" : "sections"}
                </span>
              </div>
              <button className="btn btn-ghost btn-icon" onClick={() => setShowEditModal(false)}>
                ✕
              </button>
            </div>

            {/* Modal Navigation Tabs */}
            <div
              style={{
                display: "flex",
                gap: 8,
                borderBottom: "1px solid var(--clr-border)",
                paddingBottom: 8,
                marginBottom: 16,
              }}
            >
              <button
                type="button"
                className={`btn btn-sm ${activeEditTab === "info" ? "btn-brand" : "btn-ghost"}`}
                onClick={() => setActiveEditTab("info")}
                style={{ gap: 6 }}
              >
                <span>{isRtl ? "📌 المعلومات الأساسية" : "Basic Info"}</span>
              </button>
              <button
                type="button"
                className={`btn btn-sm ${activeEditTab === "text" ? "btn-brand" : "btn-ghost"}`}
                onClick={() => setActiveEditTab("text")}
                style={{ gap: 6 }}
              >
                <span>{isRtl ? "📝 نص الكتاب الكامل" : "Full Text"}</span>
                <span className="badge badge-brand" style={{ padding: "1px 6px", fontSize: "0.7rem" }}>
                  {editText.split(/\s+/).filter(Boolean).length} {isRtl ? "كلمة" : "words"}
                </span>
              </button>
              <button
                type="button"
                className={`btn btn-sm ${activeEditTab === "sections" ? "btn-brand" : "btn-ghost"}`}
                onClick={() => setActiveEditTab("sections")}
                style={{ gap: 6 }}
              >
                <span>{isRtl ? "📑 فصول وأقسام المنهج" : "Chapters & Sections"}</span>
                <span className="badge badge-brand" style={{ padding: "1px 6px", fontSize: "0.7rem" }}>
                  {editSections.length}
                </span>
              </button>
            </div>

            {/* Tab 1: Basic Info */}
            {activeEditTab === "info" && (
              <div style={{ flex: 1, overflowY: "auto", display: "flex", flexDirection: "column", gap: 14, paddingRight: 4 }}>
                <div>
                  <label style={{ display: "block", marginBottom: 6, fontSize: "0.85rem", fontWeight: 600 }}>
                    {isRtl ? "عنوان الكتاب / المنهج الدراسي:" : "Document Title:"}
                  </label>
                  <input
                    type="text"
                    className="input"
                    value={editTitle}
                    onChange={(e) => setEditTitle(e.target.value)}
                    style={{ width: "100%" }}
                    placeholder={isRtl ? "مثال: كتاب الفيزياء الحديثة - الفصل الأول" : "Title"}
                  />
                </div>

                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                  <div>
                    <label style={{ display: "block", marginBottom: 6, fontSize: "0.85rem", fontWeight: 600 }}>
                      {isRtl ? "المادة الدراسية:" : "Subject:"}
                    </label>
                    <input
                      type="text"
                      className="input"
                      value={editSubject}
                      onChange={(e) => setEditSubject(e.target.value)}
                      style={{ width: "100%" }}
                      placeholder={isRtl ? "مثال: فيزياء، أحياء، تاريخ" : "Subject"}
                    />
                  </div>
                  <div>
                    <label style={{ display: "block", marginBottom: 6, fontSize: "0.85rem", fontWeight: 600 }}>
                      {isRtl ? "الصف / المرحلة الدراسية:" : "Grade / Stage:"}
                    </label>
                    <input
                      type="text"
                      className="input"
                      value={editGrade}
                      onChange={(e) => setEditGrade(e.target.value)}
                      style={{ width: "100%" }}
                      placeholder={isRtl ? "مثال: الصف الثاني الثانوي" : "Grade"}
                    />
                  </div>
                </div>

                <div>
                  <label style={{ display: "block", marginBottom: 6, fontSize: "0.85rem", fontWeight: 600 }}>
                    {isRtl ? "الموضوعات والكلمات الدلالية (مفصولة بفواصل):" : "Topics (comma-separated):"}
                  </label>
                  <input
                    type="text"
                    className="input"
                    value={editTopics}
                    onChange={(e) => setEditTopics(e.target.value)}
                    style={{ width: "100%" }}
                    placeholder={isRtl ? "قوانين نيوتن, القصور الذاتي, السرعة" : "topics"}
                  />
                </div>

                <div
                  style={{
                    background: "rgba(99, 102, 241, 0.06)",
                    border: "1px solid rgba(99, 102, 241, 0.2)",
                    borderRadius: "var(--radius-md)",
                    padding: "12px 16px",
                    fontSize: "0.85rem",
                    color: "var(--clr-text-secondary)",
                    lineHeight: 1.6,
                  }}
                >
                  {isRtl
                    ? "💡 يمكنك أيضاً الانتقال إلى تبويب 'نص الكتاب الكامل' لتعديل محتوى الكتاب كنص وإضافة فقرات جديدة، أو تبويب 'فصول وأقسام المنهج' لتحديد وتعديل أجزاء الكتاب بدقة متناهية."
                    : "💡 You can also switch to 'Full Text' to edit paragraphs or 'Chapters & Sections' to organize individual lessons."}
                </div>
              </div>
            )}

            {/* Tab 2: Full Text Editor */}
            {activeEditTab === "text" && (
              <div style={{ flex: 1, overflowY: "auto", display: "flex", flexDirection: "column", gap: 10 }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <span style={{ fontSize: "0.85rem", color: "var(--clr-text-secondary)" }}>
                    {isRtl
                      ? "📝 نص المنهج المعتمد (يمكنك كتابة وتعديل النص بحرية تامة، وسيتم توليد الأسئلة منه بدقة 100%):"
                      : "Curriculum text (editable):"}
                  </span>
                  <span style={{ fontSize: "0.8rem", color: "var(--clr-brand)", fontWeight: 600 }}>
                    {editText.split(/\s+/).filter(Boolean).length} {isRtl ? "كلمة" : "words"} • {editText.length} {isRtl ? "حرف" : "chars"}
                  </span>
                </div>
                <textarea
                  className="textarea"
                  value={editText}
                  onChange={(e) => setEditText(e.target.value)}
                  rows={14}
                  style={{
                    width: "100%",
                    fontSize: "0.9rem",
                    lineHeight: 1.7,
                    fontFamily: "inherit",
                    resize: "vertical",
                  }}
                  placeholder={isRtl ? "اكتب أو الصق نص المنهج هنا..." : "Enter text here..."}
                />
              </div>
            )}

            {/* Tab 3: Chapters & Sections Manager */}
            {activeEditTab === "sections" && (
              <div style={{ flex: 1, overflowY: "auto", display: "flex", flexDirection: "column", gap: 12, paddingRight: 4 }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 8 }}>
                  <span style={{ fontSize: "0.85rem", color: "var(--clr-text-secondary)" }}>
                    {isRtl
                      ? "📑 فصول وأقسام الكتاب (تتيح للطلاب والمعلمين استهداف فصل بعينه أثناء توليد الاختبارات):"
                      : "Chapters and sections for granular targeted generation:"}
                  </span>
                  <div style={{ display: "flex", gap: 8 }}>
                    <button
                      type="button"
                      className="btn btn-ghost btn-sm"
                      onClick={handleAutoSplitEditSections}
                      style={{ gap: 6, fontSize: "0.8rem" }}
                      title={isRtl ? "إعادة استخراج وتقسيم الفصول تلقائياً من نص الكتاب" : "Auto-split from text"}
                    >
                      <Sparkles size={14} />
                      <span>{isRtl ? "⚡ تقسيم تلقائي من النص" : "Auto-Split"}</span>
                    </button>
                    <button
                      type="button"
                      className="btn btn-brand btn-sm"
                      onClick={handleAddEditSection}
                      style={{ gap: 6, fontSize: "0.8rem" }}
                    >
                      <Plus size={14} />
                      <span>{isRtl ? "إضافة فصل جديد" : "Add Section"}</span>
                    </button>
                  </div>
                </div>

                {editSections.length === 0 ? (
                  <div
                    style={{
                      padding: 24,
                      textAlign: "center",
                      background: "var(--clr-bg-elevated)",
                      borderRadius: "var(--radius-md)",
                      border: "1px dashed var(--clr-border)",
                    }}
                  >
                    <p style={{ margin: "0 0 10px", color: "var(--clr-text-secondary)", fontSize: "0.9rem" }}>
                      {isRtl ? "لم يتم تعريف فصول منفصلة لهذا المنهج بعد." : "No distinct sections defined yet."}
                    </p>
                    <button
                      type="button"
                      className="btn btn-ghost btn-sm"
                      onClick={handleAutoSplitEditSections}
                      style={{ gap: 6 }}
                    >
                      <Sparkles size={14} />
                      <span>{isRtl ? "توليد الفصول تلقائياً من النص" : "Auto-generate sections"}</span>
                    </button>
                  </div>
                ) : (
                  <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                    {editSections.map((sec, sIdx) => (
                      <div
                        key={sec.id || sIdx}
                        style={{
                          background: "var(--clr-bg-elevated)",
                          borderRadius: "var(--radius-md)",
                          padding: 12,
                          border: "1px solid var(--clr-border)",
                        }}
                      >
                        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8, gap: 10 }}>
                          <div style={{ display: "flex", alignItems: "center", gap: 8, flex: 1 }}>
                            <span style={{ fontWeight: 700, fontSize: "0.8rem", color: "var(--clr-brand)" }}>
                              #{sIdx + 1}
                            </span>
                            <input
                              type="text"
                              className="input"
                              value={sec.title}
                              onChange={(e) => handleUpdateEditSection(sIdx, "title", e.target.value)}
                              placeholder={isRtl ? `عنوان الفصل ${sIdx + 1}` : `Section title`}
                              style={{ flex: 1, padding: "4px 8px", fontSize: "0.88rem", fontWeight: 600 }}
                            />
                            <span style={{ fontSize: "0.75rem", color: "var(--clr-text-muted)", whiteSpace: "nowrap" }}>
                              {sec.wordCount || sec.content.split(/\s+/).filter(Boolean).length} {isRtl ? "كلمة" : "words"}
                            </span>
                          </div>
                          <button
                            type="button"
                            className="btn btn-ghost btn-icon btn-sm"
                            onClick={() => handleRemoveEditSection(sIdx)}
                            style={{ color: "var(--clr-danger)" }}
                            title={isRtl ? "حذف هذا الفصل" : "Remove section"}
                          >
                            <Trash2 size={15} />
                          </button>
                        </div>
                        <textarea
                          className="textarea"
                          value={sec.content}
                          onChange={(e) => handleUpdateEditSection(sIdx, "content", e.target.value)}
                          rows={3}
                          placeholder={isRtl ? "نص ومحتوى هذا الفصل أو الدرس..." : "Section text..."}
                          style={{ width: "100%", fontSize: "0.85rem", lineHeight: 1.6 }}
                        />
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* Modal Actions */}
            <div
              style={{
                marginTop: 16,
                paddingTop: 12,
                borderTop: "1px solid var(--clr-border)",
                display: "flex",
                justifyContent: "flex-end",
                gap: 10,
              }}
            >
              <button
                type="button"
                className="btn btn-ghost"
                onClick={() => setShowEditModal(false)}
                disabled={savingEdit}
              >
                {isRtl ? "إلغاء" : "Cancel"}
              </button>
              <button
                type="button"
                className="btn btn-brand"
                onClick={handleSaveEdit}
                disabled={savingEdit}
                style={{ gap: 8, padding: "8px 24px" }}
              >
                {savingEdit ? (
                  <>
                    <RefreshCw size={16} className="spin" />
                    <span>{isRtl ? "جاري الحفظ والتحديث..." : "Saving..."}</span>
                  </>
                ) : (
                  <>
                    <Save size={16} />
                    <span>{isRtl ? "حفظ التعديلات في المنهج" : "Save Changes"}</span>
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
