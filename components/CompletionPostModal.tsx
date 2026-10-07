"use client";

import React, { useState, useEffect, useRef } from "react";
import {
  Send,
  Pin,
  BellOff,
  Image as ImageIcon,
  Plus,
  Trash2,
  ExternalLink,
  Sparkles,
  HelpCircle,
  RotateCcw,
  Save,
  Check,
  AlertCircle,
  Eye,
  Sliders,
  Type,
  LayoutGrid,
  X,
  Upload,
  Link as LinkIcon,
  MessageSquare,
} from "lucide-react";

export interface InlineButton {
  id: string;
  text: string;
  url: string;
}

export type ButtonRow = InlineButton[];

export interface CompletionPostConfig {
  enabled: boolean;
  text: string;
  parseMode: "HTML" | "Markdown";
  attachMedia: boolean;
  mediaType: "url" | "file";
  mediaUrl: string;
  mediaBase64?: string;
  mediaMimeType?: string;
  buttonRows: ButtonRow[];
  pinMessage: boolean;
  disableNotification: boolean;
  useCustomTopic: boolean;
  topicId?: number | "";
}

export const DEFAULT_COMPLETION_POST_CONFIG: CompletionPostConfig = {
  enabled: true,
  text: `🎉 <b>تم بحمد الله الانتهاء من نشر كويزات اليوم!</b>\n\n📊 <b>عدد الأسئلة المنشورة:</b> {count} كويز\n🏛 <b>المجموعة:</b> {groupTitle}\n📅 <b>التاريخ:</b> {date}\n\n💡 <i>نتمنى لكم التوفيق والدرجات العالية! راجعوا الإجابات وشاركونا استفساراتكم.</i>`,
  parseMode: "HTML",
  attachMedia: false,
  mediaType: "url",
  mediaUrl: "",
  buttonRows: [
    [
      { id: "btn-1", text: "💬 مجموعة المناقشة", url: "https://t.me" },
      { id: "btn-2", text: "📚 القناة الرسمية", url: "https://t.me" },
    ],
  ],
  pinMessage: true,
  disableNotification: false,
  useCustomTopic: false,
  topicId: "",
};

interface Topic {
  message_thread_id: number;
  name: string;
}

interface CompletionPostModalProps {
  isOpen: boolean;
  onClose: () => void;
  groupId: string;
  groupTitle?: string;
  topics?: Topic[];
  selectedTopicId?: number | "";
  selectedCount?: number;
  config: CompletionPostConfig;
  onSaveConfig: (newConfig: CompletionPostConfig) => void;
  showToast: (type: "success" | "error", msg: string) => void;
}

export default function CompletionPostModal({
  isOpen,
  onClose,
  groupId,
  groupTitle = "المجموعة",
  topics = [],
  selectedTopicId = "",
  selectedCount = 0,
  config: initialConfig,
  onSaveConfig,
  showToast,
}: CompletionPostModalProps) {
  const [draft, setDraft] = useState<CompletionPostConfig>(initialConfig);
  const [activeTab, setActiveTab] = useState<"message" | "buttons" | "settings" | "preview">("message");
  const [testSending, setTestSending] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; msg: string } | null>(null);
  const [savedSuccess, setSavedSuccess] = useState(false);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Sync draft when opened or initialConfig changes
  useEffect(() => {
    if (isOpen) {
      setDraft(initialConfig);
      setTestResult(null);
      setSavedSuccess(false);
    }
  }, [isOpen, initialConfig]);

  if (!isOpen) return null;

  const effectiveCount = selectedCount > 0 ? selectedCount : 5;
  const now = new Date();
  const currentDateFormatted = now.toLocaleDateString("ar-EG", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });
  const currentTimeFormatted = now.toLocaleTimeString("ar-EG", {
    hour: "2-digit",
    minute: "2-digit",
  });

  // Simulated text for preview
  const previewText = draft.text
    .replace(/{count}/gi, String(effectiveCount))
    .replace(/{groupTitle}/gi, groupTitle)
    .replace(/{title}/gi, groupTitle)
    .replace(/{date}/gi, currentDateFormatted)
    .replace(/{time}/gi, currentTimeFormatted);

  // Quick insertion helpers for textarea
  const insertVariable = (variableStr: string) => {
    if (!textareaRef.current) {
      setDraft((d) => ({ ...d, text: d.text + variableStr }));
      return;
    }
    const el = textareaRef.current;
    const start = el.selectionStart;
    const end = el.selectionEnd;
    const before = draft.text.substring(0, start);
    const after = draft.text.substring(end);
    const newText = before + variableStr + after;
    setDraft((d) => ({ ...d, text: newText }));
    setTimeout(() => {
      el.focus();
      el.setSelectionRange(start + variableStr.length, start + variableStr.length);
    }, 0);
  };

  const wrapTag = (openTag: string, closeTag: string) => {
    if (!textareaRef.current) return;
    const el = textareaRef.current;
    const start = el.selectionStart;
    const end = el.selectionEnd;
    const selected = draft.text.substring(start, end) || "نص";
    const replacement = `${openTag}${selected}${closeTag}`;
    const before = draft.text.substring(0, start);
    const after = draft.text.substring(end);
    const newText = before + replacement + after;
    setDraft((d) => ({ ...d, text: newText }));
    setTimeout(() => {
      el.focus();
      el.setSelectionRange(start + openTag.length, start + openTag.length + selected.length);
    }, 0);
  };

  // Button management
  const addRow = () => {
    setDraft((d) => ({
      ...d,
      buttonRows: [
        ...d.buttonRows,
        [{ id: `btn-${Date.now()}-1`, text: "زر جديد", url: "" }],
      ],
    }));
  };

  const removeRow = (rowIndex: number) => {
    setDraft((d) => ({
      ...d,
      buttonRows: d.buttonRows.filter((_, i) => i !== rowIndex),
    }));
  };

  const addButtonToRow = (rowIndex: number) => {
    setDraft((d) => {
      const rows = [...d.buttonRows];
      const targetRow = rows[rowIndex];
      if (targetRow.length >= 4) {
        showToast("error", "الحد الأقصى 4 أزرار في الصف الواحد لظهور متناسق في تلجرام");
        return d;
      }
      rows[rowIndex] = [
        ...targetRow,
        { id: `btn-${Date.now()}-${targetRow.length + 1}`, text: "زر جديد", url: "" },
      ];
      return { ...d, buttonRows: rows };
    });
  };

  const updateButton = (
    rowIndex: number,
    btnIndex: number,
    field: "text" | "url",
    value: string
  ) => {
    setDraft((d) => {
      const rows = d.buttonRows.map((r, ri) => {
        if (ri !== rowIndex) return r;
        return r.map((b, bi) => {
          if (bi !== btnIndex) return b;
          return { ...b, [field]: value };
        });
      });
      return { ...d, buttonRows: rows };
    });
  };

  const removeButton = (rowIndex: number, btnIndex: number) => {
    setDraft((d) => {
      const rows = d.buttonRows
        .map((r, ri) => {
          if (ri !== rowIndex) return r;
          return r.filter((_, bi) => bi !== btnIndex);
        })
        .filter((r) => r.length > 0);
      return { ...d, buttonRows: rows };
    });
  };

  // Helper to downscale and compress client images before storing & sending
  const compressImage = (file: File): Promise<{ base64: string; mimeType: string }> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = (e) => {
        const img = new Image();
        img.onload = () => {
          const maxDim = 1280;
          let width = img.width;
          let height = img.height;
          if (width > maxDim || height > maxDim) {
            if (width > height) {
              height = Math.round((height * maxDim) / width);
              width = maxDim;
            } else {
              width = Math.round((width * maxDim) / height);
              height = maxDim;
            }
          }
          const canvas = document.createElement("canvas");
          canvas.width = width;
          canvas.height = height;
          const ctx = canvas.getContext("2d");
          if (!ctx) {
            const dataUrl = e.target?.result as string;
            resolve({ base64: dataUrl.split(",")[1], mimeType: file.type || "image/jpeg" });
            return;
          }
          ctx.drawImage(img, 0, 0, width, height);
          const compressedDataUrl = canvas.toDataURL("image/jpeg", 0.82);
          resolve({ base64: compressedDataUrl.split(",")[1], mimeType: "image/jpeg" });
        };
        img.onerror = () => {
          const dataUrl = e.target?.result as string;
          resolve({ base64: dataUrl.split(",")[1], mimeType: file.type || "image/jpeg" });
        };
        img.src = e.target?.result as string;
      };
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  };

  // Image upload with automated size optimization
  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (file.size > 10 * 1024 * 1024) {
      showToast("error", "حجم الصورة كبير جداً (الحد الأقصى 10 ميجابايت)");
      return;
    }

    try {
      const { base64, mimeType } = await compressImage(file);
      setDraft((d) => ({
        ...d,
        attachMedia: true,
        mediaType: "file",
        mediaBase64: base64,
        mediaMimeType: mimeType,
      }));
      showToast("success", "تم تحميل الصورة وتحسين حجمها بنجاح ✓");
    } catch {
      showToast("error", "حدث خطأ أثناء معالجة الصورة");
    }
  };

  // Save handler
  const handleSave = (silent = false) => {
    onSaveConfig(draft);
    if (!silent) {
      setSavedSuccess(true);
      showToast("success", "تم حفظ إعدادات بوست الختام بنجاح ✓");
      setTimeout(() => setSavedSuccess(false), 2500);
    }
  };

  const handleResetToDefault = () => {
    if (confirm("هل تريد استعادة القالب الافتراضي لبوست الختام؟")) {
      setDraft({ ...DEFAULT_COMPLETION_POST_CONFIG, enabled: draft.enabled });
      showToast("success", "تمت استعادة القالب الافتراضي");
    }
  };

  // Test sending to Telegram
  const handleTestSend = async () => {
    setTestSending(true);
    setTestResult(null);

    try {
      const targetTopicId = draft.useCustomTopic
        ? draft.topicId || undefined
        : selectedTopicId || undefined;

      const payload = {
        text: draft.text,
        parseMode: draft.parseMode,
        topicId: targetTopicId,
        mediaUrl: draft.attachMedia && draft.mediaType === "url" ? draft.mediaUrl : undefined,
        mediaBase64: draft.attachMedia && draft.mediaType === "file" ? draft.mediaBase64 : undefined,
        mediaMimeType: draft.attachMedia && draft.mediaType === "file" ? draft.mediaMimeType : undefined,
        buttons: draft.buttonRows.map((r) =>
          r.map((b) => ({ text: b.text, url: b.url }))
        ),
        pinMessage: draft.pinMessage,
        disableNotification: draft.disableNotification,
        variables: {
          count: effectiveCount,
          successCount: effectiveCount,
          total: effectiveCount,
          failedCount: 0,
          groupTitle: groupTitle,
          title: groupTitle,
          date: currentDateFormatted,
          time: currentTimeFormatted,
        },
      };

      const res = await fetch(`/api/groups/${groupId}/messages/send`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      const data = await res.json();
      if (res.ok) {
        setTestResult({
          ok: true,
          msg: `تم إرسال بوست تجريبي لتلجرام بنجاح! ${data.pinned ? "📌 وتم تثبيته." : data.pinError ? "(ملاحظة: لم يتم التثبيت لعدم توفر صلاحية التثبيت للبوت)" : ""}`,
        });
        showToast("success", "تم إرسال البوست التجريبي إلى التلجرام بنجاح! 🚀");
      } else {
        setTestResult({
          ok: false,
          msg: data.error || "فشل إرسال البوست التجريبي",
        });
        showToast("error", data.error || "فشل إرسال البوست التجريبي");
      }
    } catch (err: any) {
      setTestResult({
        ok: false,
        msg: err.message || "خطأ أثناء محاولة الإرسال",
      });
      showToast("error", "خطأ في الشبكة أثناء إرسال البوست التجريبي");
    } finally {
      setTestSending(false);
    }
  };

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 1100,
        background: "rgba(0, 0, 0, 0.75)",
        backdropFilter: "blur(8px)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: "16px",
      }}
      onClick={onClose}
    >
      <div
        style={{
          background: "var(--clr-bg-surface)",
          border: "1px solid var(--clr-border)",
          borderRadius: "var(--radius-xl)",
          width: "100%",
          maxWidth: "880px",
          maxHeight: "92vh",
          display: "flex",
          flexDirection: "column",
          boxShadow: "0 28px 72px rgba(0,0,0,0.6), var(--shadow-brand)",
          overflow: "hidden",
        }}
        onClick={(e) => e.stopPropagation()}
        dir="rtl"
      >
        {/* Modal Header */}
        <div
          style={{
            padding: "18px 24px",
            borderBottom: "1px solid var(--clr-border)",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            background: "var(--clr-bg-elevated)",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <div
              style={{
                width: 42,
                height: 42,
                borderRadius: "var(--radius-md)",
                background: "var(--grad-brand)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                color: "#fff",
                boxShadow: "0 4px 14px var(--clr-brand-glow)",
              }}
            >
              <Sparkles size={22} />
            </div>
            <div>
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <h2 style={{ margin: 0, fontSize: "1.2rem", fontWeight: 700, color: "var(--clr-text-primary)" }}>
                  إعدادات بوست الختام (Completion Post)
                </h2>
                <span
                  style={{
                    padding: "3px 10px",
                    borderRadius: "var(--radius-full)",
                    fontSize: "0.74rem",
                    fontWeight: 600,
                    background: draft.enabled ? "var(--clr-success-muted)" : "var(--clr-border-subtle)",
                    color: draft.enabled ? "var(--clr-success)" : "var(--clr-text-muted)",
                    border: `1px solid ${draft.enabled ? "var(--clr-success)" : "var(--clr-border)"}`,
                  }}
                >
                  {draft.enabled ? "مفعّل تلقائياً ✓" : "معطّل"}
                </span>
              </div>
              <p style={{ margin: "2px 0 0", fontSize: "0.82rem", color: "var(--clr-text-muted)" }}>
                إرسال رسالة ختامية تفاعلية بها أزرار وإحصائيات بعد بث الكويزات المختارة مباشرة.
              </p>
            </div>
          </div>

          <button
            onClick={onClose}
            className="btn btn-ghost btn-sm"
            style={{
              padding: "6px",
              borderRadius: "50%",
              color: "var(--clr-text-muted)",
              lineHeight: 1,
            }}
            title="إغلاق"
          >
            <X size={20} />
          </button>
        </div>

        {/* Global Toggle & Tabs Bar */}
        <div
          style={{
            padding: "12px 24px",
            borderBottom: "1px solid var(--clr-border)",
            background: "var(--clr-bg-card)",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            flexWrap: "wrap",
            gap: 12,
          }}
        >
          {/* Main Enable/Disable Switch */}
          <label
            style={{
              display: "flex",
              alignItems: "center",
              gap: 10,
              cursor: "pointer",
              userSelect: "none",
            }}
          >
            <input
              type="checkbox"
              checked={draft.enabled}
              onChange={(e) => setDraft((d) => ({ ...d, enabled: e.target.checked }))}
              style={{
                width: 18,
                height: 18,
                accentColor: "var(--clr-brand)",
                cursor: "pointer",
              }}
            />
            <span style={{ fontWeight: 600, fontSize: "0.9rem", color: "var(--clr-text-primary)" }}>
              تفعيل إرسال بوست الختام تلقائياً بعد انتهاء البث
            </span>
          </label>

          {/* Navigation Tabs */}
          <div
            style={{
              display: "flex",
              gap: 4,
              background: "var(--clr-bg-base)",
              padding: "3px",
              borderRadius: "var(--radius-md)",
              border: "1px solid var(--clr-border)",
            }}
          >
            <button
              type="button"
              onClick={() => setActiveTab("message")}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 6,
                padding: "6px 14px",
                borderRadius: "var(--radius-sm)",
                border: "none",
                fontSize: "0.82rem",
                fontWeight: 600,
                cursor: "pointer",
                background: activeTab === "message" ? "var(--clr-brand)" : "transparent",
                color: activeTab === "message" ? "#fff" : "var(--clr-text-muted)",
                transition: "all 0.15s ease",
              }}
            >
              <Type size={15} />
              الرسالة والمحتوى
            </button>

            <button
              type="button"
              onClick={() => setActiveTab("buttons")}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 6,
                padding: "6px 14px",
                borderRadius: "var(--radius-sm)",
                border: "none",
                fontSize: "0.82rem",
                fontWeight: 600,
                cursor: "pointer",
                background: activeTab === "buttons" ? "var(--clr-brand)" : "transparent",
                color: activeTab === "buttons" ? "#fff" : "var(--clr-text-muted)",
                transition: "all 0.15s ease",
              }}
            >
              <LayoutGrid size={15} />
              الأزرار والروابط ({draft.buttonRows.reduce((acc, r) => acc + r.length, 0)})
            </button>

            <button
              type="button"
              onClick={() => setActiveTab("settings")}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 6,
                padding: "6px 14px",
                borderRadius: "var(--radius-sm)",
                border: "none",
                fontSize: "0.82rem",
                fontWeight: 600,
                cursor: "pointer",
                background: activeTab === "settings" ? "var(--clr-brand)" : "transparent",
                color: activeTab === "settings" ? "#fff" : "var(--clr-text-muted)",
                transition: "all 0.15s ease",
              }}
            >
              <Sliders size={15} />
              خيارات متقدمة
            </button>

            <button
              type="button"
              onClick={() => setActiveTab("preview")}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 6,
                padding: "6px 14px",
                borderRadius: "var(--radius-sm)",
                border: "none",
                fontSize: "0.82rem",
                fontWeight: 600,
                cursor: "pointer",
                background: activeTab === "preview" ? "var(--clr-brand)" : "transparent",
                color: activeTab === "preview" ? "#fff" : "var(--clr-text-muted)",
                transition: "all 0.15s ease",
              }}
            >
              <Eye size={15} />
              معاينة تلجرام
            </button>
          </div>
        </div>

        {/* Modal Scrollable Body */}
        <div
          style={{
            padding: "20px 24px",
            overflowY: "auto",
            flex: 1,
            display: "flex",
            flexDirection: "column",
            gap: 20,
          }}
        >
          {/* TAB 1: MESSAGE & CONTENT */}
          {activeTab === "message" && (
            <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
              {/* Dynamic Variables Bar */}
              <div
                style={{
                  background: "var(--clr-bg-elevated)",
                  padding: "12px 16px",
                  borderRadius: "var(--radius-md)",
                  border: "1px solid var(--clr-border)",
                }}
              >
                <div
                  style={{
                    fontSize: "0.8rem",
                    fontWeight: 600,
                    color: "var(--clr-text-secondary)",
                    marginBottom: 8,
                    display: "flex",
                    alignItems: "center",
                    gap: 6,
                  }}
                >
                  <Sparkles size={14} color="var(--clr-brand)" />
                  انقر لإدراج المتغيرات الديناميكية تلقائياً في النص:
                </div>
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                  <button
                    type="button"
                    onClick={() => insertVariable("{count}")}
                    className="btn btn-ghost btn-sm"
                    style={{
                      background: "var(--clr-brand-muted)",
                      color: "var(--clr-brand)",
                      border: "1px solid var(--clr-border-active)",
                      fontSize: "0.8rem",
                      fontWeight: 600,
                    }}
                    title="عدد الكويزات التي تم إرسالها في هذه الدفعة"
                  >
                    + {"{count}"} (عدد الكويزات: {effectiveCount})
                  </button>

                  <button
                    type="button"
                    onClick={() => insertVariable("{groupTitle}")}
                    className="btn btn-ghost btn-sm"
                    style={{
                      background: "var(--clr-brand-muted)",
                      color: "var(--clr-brand)",
                      border: "1px solid var(--clr-border-active)",
                      fontSize: "0.8rem",
                      fontWeight: 600,
                    }}
                    title="اسم المجموعة الحالية"
                  >
                    + {"{groupTitle}"} (اسم المجموعة)
                  </button>

                  <button
                    type="button"
                    onClick={() => insertVariable("{date}")}
                    className="btn btn-ghost btn-sm"
                    style={{
                      background: "var(--clr-brand-muted)",
                      color: "var(--clr-brand)",
                      border: "1px solid var(--clr-border-active)",
                      fontSize: "0.8rem",
                      fontWeight: 600,
                    }}
                    title="تاريخ اليوم الحالي"
                  >
                    + {"{date}"} (التاريخ)
                  </button>

                    <button
                    type="button"
                    onClick={() => insertVariable("{time}")}
                    className="btn btn-ghost btn-sm"
                    style={{
                      background: "var(--clr-brand-muted)",
                      color: "var(--clr-brand)",
                      border: "1px solid var(--clr-border-active)",
                      fontSize: "0.8rem",
                      fontWeight: 600,
                    }}
                    title="الوقت الحالي"
                  >
                    + {"{time}"} (الوقت)
                  </button>

                  <button
                    type="button"
                    onClick={() => insertVariable("{total}")}
                    className="btn btn-ghost btn-sm"
                    style={{
                      background: "var(--clr-brand-muted)",
                      color: "var(--clr-brand)",
                      border: "1px solid var(--clr-border-active)",
                      fontSize: "0.8rem",
                      fontWeight: 600,
                    }}
                    title="إجمالي عدد الأسئلة المستهدفة في هذه الدفعة"
                  >
                    + {"{total}"} (إجمالي الدفعة)
                  </button>
                </div>
              </div>

              {/* Formatting Toolbar for HTML/Markdown */}
              {draft.parseMode === "HTML" ? (
                <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
                  <span style={{ fontSize: "0.78rem", color: "var(--clr-text-muted)" }}>تنسيق HTML:</span>
                  <button
                    type="button"
                    onClick={() => wrapTag("<b>", "</b>")}
                    className="btn btn-ghost btn-sm"
                    style={{ padding: "2px 8px", fontSize: "0.76rem" }}
                  >
                    <b>B</b> (عريض)
                  </button>
                  <button
                    type="button"
                    onClick={() => wrapTag("<i>", "</i>")}
                    className="btn btn-ghost btn-sm"
                    style={{ padding: "2px 8px", fontSize: "0.76rem" }}
                  >
                    <i>I</i> (مائل)
                  </button>
                  <button
                    type="button"
                    onClick={() => wrapTag("<u>", "</u>")}
                    className="btn btn-ghost btn-sm"
                    style={{ padding: "2px 8px", fontSize: "0.76rem" }}
                  >
                    <u>U</u> (مسطر)
                  </button>
                  <button
                    type="button"
                    onClick={() => wrapTag("<code>", "</code>")}
                    className="btn btn-ghost btn-sm"
                    style={{ padding: "2px 8px", fontSize: "0.76rem" }}
                  >
                    &lt;code&gt;
                  </button>
                  <button
                    type="button"
                    onClick={() => wrapTag('<a href="https://t.me">', "</a>")}
                    className="btn btn-ghost btn-sm"
                    style={{ padding: "2px 8px", fontSize: "0.76rem" }}
                  >
                    رابط &lt;a&gt;
                  </button>
                </div>
              ) : (
                <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
                  <span style={{ fontSize: "0.78rem", color: "var(--clr-text-muted)" }}>تنسيق Markdown:</span>
                  <button
                    type="button"
                    onClick={() => wrapTag("*", "*")}
                    className="btn btn-ghost btn-sm"
                    style={{ padding: "2px 8px", fontSize: "0.76rem" }}
                  >
                    <b>*عريض*</b>
                  </button>
                  <button
                    type="button"
                    onClick={() => wrapTag("_", "_")}
                    className="btn btn-ghost btn-sm"
                    style={{ padding: "2px 8px", fontSize: "0.76rem" }}
                  >
                    <i>_مائل_</i>
                  </button>
                  <button
                    type="button"
                    onClick={() => wrapTag("`", "`")}
                    className="btn btn-ghost btn-sm"
                    style={{ padding: "2px 8px", fontSize: "0.76rem" }}
                  >
                    `كود`
                  </button>
                  <button
                    type="button"
                    onClick={() => wrapTag("[نص الرابط](https://t.me", ")")}
                    className="btn btn-ghost btn-sm"
                    style={{ padding: "2px 8px", fontSize: "0.76rem" }}
                  >
                    [رابط](url)
                  </button>
                </div>
              )}

              {/* Textarea */}
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <label className="input-label" style={{ margin: 0, fontWeight: 600 }}>
                    محتوى رسالة الختام
                  </label>
                  <span
                    style={{
                      fontSize: "0.75rem",
                      fontWeight: draft.attachMedia && draft.text.length > 1024 ? 700 : 400,
                      color:
                        draft.attachMedia && draft.text.length > 1024
                          ? "var(--clr-danger)"
                          : "var(--clr-text-muted)",
                    }}
                  >
                    {draft.text.length}
                    {draft.attachMedia ? " / 1024 حرف (الحد الأقصى للتسمية مع الصورة)" : " حرف"}
                  </span>
                </div>
                <textarea
                  ref={textareaRef}
                  className="input"
                  rows={7}
                  value={draft.text}
                  onChange={(e) => setDraft((d) => ({ ...d, text: e.target.value }))}
                  placeholder="اكتب نص رسالة الختام هنا..."
                  style={{
                    resize: "vertical",
                    fontSize: "0.92rem",
                    lineHeight: "1.6",
                    fontFamily: "var(--font-arabic), inherit",
                    borderColor:
                      draft.attachMedia && draft.text.length > 1024 ? "var(--clr-danger)" : undefined,
                  }}
                />

                {draft.attachMedia && draft.text.length > 1024 && (
                  <div
                    style={{
                      fontSize: "0.8rem",
                      color: "var(--clr-danger)",
                      background: "var(--clr-danger-muted)",
                      border: "1px solid var(--clr-danger)",
                      padding: "8px 12px",
                      borderRadius: "var(--radius-sm)",
                      display: "flex",
                      alignItems: "center",
                      gap: 8,
                    }}
                  >
                    <AlertCircle size={15} />
                    <span>
                      تنبيه: يتجاوز طول النص 1024 حرفاً ({draft.text.length} حرف). تلجرام يسمح بـ 1024 حرف كحد أقصى للتسمية التوضيحية عند إرفاق صورة. يرجى اختصار النص أو إلغاء تفعيل إرفاق الصورة.
                    </span>
                  </div>
                )}
              </div>

              {/* Media Attachment Section */}
              <div
                style={{
                  background: "var(--clr-bg-card)",
                  border: "1px solid var(--clr-border)",
                  borderRadius: "var(--radius-md)",
                  padding: "16px",
                  display: "flex",
                  flexDirection: "column",
                  gap: 12,
                }}
              >
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <label
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 8,
                      cursor: "pointer",
                      margin: 0,
                    }}
                  >
                    <input
                      type="checkbox"
                      checked={draft.attachMedia}
                      onChange={(e) => setDraft((d) => ({ ...d, attachMedia: e.target.checked }))}
                      style={{ accentColor: "var(--clr-brand)", width: 16, height: 16 }}
                    />
                    <span style={{ fontWeight: 600, fontSize: "0.88rem", display: "flex", alignItems: "center", gap: 6 }}>
                      <ImageIcon size={17} color="var(--clr-brand)" />
                      إرفاق صورة مع رسالة الختام (Photo Post)
                    </span>
                  </label>

                  {draft.attachMedia && (
                    <div style={{ display: "flex", gap: 6 }}>
                      <button
                        type="button"
                        onClick={() => setDraft((d) => ({ ...d, mediaType: "url" }))}
                        className="btn btn-ghost btn-sm"
                        style={{
                          fontSize: "0.76rem",
                          padding: "3px 8px",
                          background: draft.mediaType === "url" ? "var(--clr-brand-muted)" : "transparent",
                          color: draft.mediaType === "url" ? "var(--clr-brand)" : "var(--clr-text-muted)",
                          border: `1px solid ${draft.mediaType === "url" ? "var(--clr-brand)" : "transparent"}`,
                        }}
                      >
                        <LinkIcon size={12} /> رابط صورة
                      </button>
                      <button
                        type="button"
                        onClick={() => setDraft((d) => ({ ...d, mediaType: "file" }))}
                        className="btn btn-ghost btn-sm"
                        style={{
                          fontSize: "0.76rem",
                          padding: "3px 8px",
                          background: draft.mediaType === "file" ? "var(--clr-brand-muted)" : "transparent",
                          color: draft.mediaType === "file" ? "var(--clr-brand)" : "var(--clr-text-muted)",
                          border: `1px solid ${draft.mediaType === "file" ? "var(--clr-brand)" : "transparent"}`,
                        }}
                      >
                        <Upload size={12} /> رفع من الجهاز
                      </button>
                    </div>
                  )}
                </div>

                {draft.attachMedia && (
                  <div style={{ marginTop: 4 }}>
                    {draft.mediaType === "url" ? (
                      <div>
                        <input
                          type="url"
                          className="input"
                          placeholder="https://example.com/completion-banner.jpg"
                          value={draft.mediaUrl}
                          onChange={(e) => setDraft((d) => ({ ...d, mediaUrl: e.target.value }))}
                          style={{ fontSize: "0.85rem" }}
                        />
                        <span style={{ fontSize: "0.72rem", color: "var(--clr-text-muted)", marginTop: 4, display: "block" }}>
                          رابط مباشر للصورة بصيغة JPG أو PNG
                        </span>
                      </div>
                    ) : (
                      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                        <input
                          type="file"
                          ref={fileInputRef}
                          accept="image/*"
                          style={{ display: "none" }}
                          onChange={handleFileUpload}
                        />
                        <button
                          type="button"
                          className="btn btn-ghost btn-sm"
                          onClick={() => fileInputRef.current?.click()}
                          style={{ border: "1px dashed var(--clr-border)", padding: "8px 16px" }}
                        >
                          <Upload size={16} /> اختيار صورة من الجهاز...
                        </button>

                        {draft.mediaBase64 && (
                          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                            <img
                              src={`data:${draft.mediaMimeType || "image/jpeg"};base64,${draft.mediaBase64}`}
                              alt="Thumbnail"
                              style={{ width: 44, height: 44, borderRadius: 6, objectFit: "cover" }}
                            />
                            <button
                              type="button"
                              onClick={() => setDraft((d) => ({ ...d, mediaBase64: undefined }))}
                              className="btn btn-ghost btn-sm"
                              style={{ color: "var(--clr-danger)", padding: "4px 8px", fontSize: "0.75rem" }}
                            >
                              إزالة الصورة
                            </button>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* TAB 2: INLINE KEYBOARD BUTTON BUILDER */}
          {activeTab === "buttons" && (
            <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  flexWrap: "wrap",
                  gap: 8,
                }}
              >
                <div>
                  <h4 style={{ margin: 0, fontSize: "0.95rem", fontWeight: 700 }}>
                    مُنشئ أزرار التلجرام التفاعلية (Inline Keyboard)
                  </h4>
                  <p style={{ margin: "2px 0 0", fontSize: "0.8rem", color: "var(--clr-text-muted)" }}>
                    أضف صفوفاً وأزراراً بروابط لمجموعتك، قناتك، أو موقعك الخارجي تظهر أسفل الرسالة.
                  </p>
                </div>

                <button
                  type="button"
                  onClick={addRow}
                  className="btn btn-ghost btn-sm"
                  style={{
                    border: "1px solid var(--clr-brand)",
                    color: "var(--clr-brand)",
                    fontSize: "0.82rem",
                    fontWeight: 600,
                  }}
                >
                  <Plus size={15} /> إضافة صف أزرار جديد
                </button>
              </div>

              {draft.buttonRows.length === 0 ? (
                <div
                  style={{
                    padding: "36px 20px",
                    textAlign: "center",
                    border: "1px dashed var(--clr-border)",
                    borderRadius: "var(--radius-lg)",
                    background: "var(--clr-bg-card)",
                  }}
                >
                  <MessageSquare size={36} color="var(--clr-text-muted)" style={{ margin: "0 auto 8px" }} />
                  <p style={{ margin: 0, fontWeight: 600, color: "var(--clr-text-secondary)" }}>
                    لا توجد أزرار مضافة حالياً
                  </p>
                  <p style={{ margin: "4px 0 12px", fontSize: "0.8rem", color: "var(--clr-text-muted)" }}>
                    يمكنك إضافة أزرار للانضمام للمناقشة أو الانتقال للقناة الرسمية
                  </p>
                  <button type="button" onClick={addRow} className="btn btn-primary btn-sm">
                    + إضافة أول صف أزرار
                  </button>
                </div>
              ) : (
                <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
                  {draft.buttonRows.map((row, rIndex) => (
                    <div
                      key={rIndex}
                      style={{
                        background: "var(--clr-bg-card)",
                        border: "1px solid var(--clr-border)",
                        borderRadius: "var(--radius-md)",
                        padding: "14px",
                        display: "flex",
                        flexDirection: "column",
                        gap: 10,
                      }}
                    >
                      <div
                        style={{
                          display: "flex",
                          justifyContent: "space-between",
                          alignItems: "center",
                          borderBottom: "1px solid var(--clr-border-subtle)",
                          paddingBottom: 8,
                        }}
                      >
                        <span style={{ fontSize: "0.82rem", fontWeight: 700, color: "var(--clr-text-secondary)" }}>
                          الصف {rIndex + 1} ({row.length} {row.length === 1 ? "زر" : "أزرار"})
                        </span>

                        <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                          <button
                            type="button"
                            onClick={() => addButtonToRow(rIndex)}
                            className="btn btn-ghost btn-sm"
                            style={{ fontSize: "0.76rem", padding: "3px 8px" }}
                            title="إضافة زر إضافي بجانب الأزرار الحالية في نفس الصف"
                          >
                            <Plus size={13} /> زر إضافي بالصف
                          </button>
                          <button
                            type="button"
                            onClick={() => removeRow(rIndex)}
                            className="btn btn-ghost btn-sm"
                            style={{ color: "var(--clr-danger)", padding: "3px 8px" }}
                            title="حذف هذا الصف بالكامل"
                          >
                            <Trash2 size={14} />
                          </button>
                        </div>
                      </div>

                      {/* Buttons in this row */}
                      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                        {row.map((btn, bIndex) => (
                          <div
                            key={btn.id || bIndex}
                            style={{
                              display: "flex",
                              gap: 8,
                              alignItems: "center",
                              background: "var(--clr-bg-elevated)",
                              padding: "8px 10px",
                              borderRadius: "var(--radius-sm)",
                              border: "1px solid var(--clr-border-subtle)",
                            }}
                          >
                            <span
                              style={{
                                width: 22,
                                height: 22,
                                borderRadius: "50%",
                                background: "var(--clr-bg-base)",
                                display: "flex",
                                alignItems: "center",
                                justifyContent: "center",
                                fontSize: "0.72rem",
                                fontWeight: 700,
                                color: "var(--clr-text-muted)",
                                flexShrink: 0,
                              }}
                            >
                              {bIndex + 1}
                            </span>

                            <input
                              type="text"
                              className="input"
                              placeholder="نص الزر (مثلاً: 💬 مجموعة النقاش)"
                              value={btn.text}
                              onChange={(e) => updateButton(rIndex, bIndex, "text", e.target.value)}
                              style={{ flex: "1 1 180px", fontSize: "0.85rem", padding: "6px 10px" }}
                            />

                            <input
                              type="text"
                              className="input"
                              placeholder="الرابط (مثلاً: https://t.me/... أو @قناة)"
                              value={btn.url}
                              onChange={(e) => updateButton(rIndex, bIndex, "url", e.target.value)}
                              style={{
                                flex: "1 1 240px",
                                fontSize: "0.85rem",
                                padding: "6px 10px",
                                direction: "ltr",
                                textAlign: "left",
                                borderColor:
                                  btn.text.trim() && (!btn.url.trim() || btn.url.trim() === "https://" || btn.url.trim() === "http://")
                                    ? "var(--clr-warning)"
                                    : undefined,
                              }}
                              title={
                                btn.url.startsWith("@")
                                  ? "سيتم تحويل معرف القناة (@) تلقائياً إلى رابط تلجرام"
                                  : undefined
                              }
                            />

                            <button
                              type="button"
                              onClick={() => removeButton(rIndex, bIndex)}
                              className="btn btn-ghost btn-sm"
                              style={{
                                color: "var(--clr-danger)",
                                padding: "6px",
                                borderRadius: "50%",
                                flexShrink: 0,
                              }}
                              title="حذف هذا الزر"
                            >
                              <X size={14} />
                            </button>
                          </div>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* TAB 3: SETTINGS & TARGETING */}
          {activeTab === "settings" && (
            <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
              {/* Parse mode selector */}
              <div
                style={{
                  background: "var(--clr-bg-card)",
                  border: "1px solid var(--clr-border)",
                  borderRadius: "var(--radius-md)",
                  padding: "16px",
                  display: "flex",
                  flexDirection: "column",
                  gap: 8,
                }}
              >
                <label className="input-label" style={{ margin: 0, fontWeight: 600 }}>
                  صيغة النص (Parse Mode)
                </label>
                <div style={{ display: "flex", gap: 12 }}>
                  <label style={{ display: "flex", alignItems: "center", gap: 6, cursor: "pointer", fontSize: "0.88rem" }}>
                    <input
                      type="radio"
                      name="parseMode"
                      value="HTML"
                      checked={draft.parseMode === "HTML"}
                      onChange={() => setDraft((d) => ({ ...d, parseMode: "HTML" }))}
                      style={{ accentColor: "var(--clr-brand)" }}
                    />
                    <span>HTML (موصى به - يدعم الرموز التعبيرية والتنسيقات المتقدمة)</span>
                  </label>
                  <label style={{ display: "flex", alignItems: "center", gap: 6, cursor: "pointer", fontSize: "0.88rem" }}>
                    <input
                      type="radio"
                      name="parseMode"
                      value="Markdown"
                      checked={draft.parseMode === "Markdown"}
                      onChange={() => setDraft((d) => ({ ...d, parseMode: "Markdown" }))}
                      style={{ accentColor: "var(--clr-brand)" }}
                    />
                    <span>Markdown</span>
                  </label>
                </div>
              </div>

              {/* Pin & Silent Toggles */}
              <div
                style={{
                  background: "var(--clr-bg-card)",
                  border: "1px solid var(--clr-border)",
                  borderRadius: "var(--radius-md)",
                  padding: "16px",
                  display: "flex",
                  flexDirection: "column",
                  gap: 14,
                }}
              >
                {/* Pin message option */}
                <label
                  style={{
                    display: "flex",
                    alignItems: "flex-start",
                    gap: 12,
                    cursor: "pointer",
                  }}
                >
                  <input
                    type="checkbox"
                    checked={draft.pinMessage}
                    onChange={(e) => setDraft((d) => ({ ...d, pinMessage: e.target.checked }))}
                    style={{ accentColor: "var(--clr-brand)", width: 18, height: 18, marginTop: 2 }}
                  />
                  <div>
                    <div style={{ fontWeight: 600, fontSize: "0.9rem", display: "flex", alignItems: "center", gap: 6 }}>
                      <Pin size={16} color="var(--clr-warning)" />
                      تثبيت الرسالة تلقائياً في المجموعة / الموضوع (Pin Message)
                    </div>
                    <div style={{ fontSize: "0.78rem", color: "var(--clr-text-muted)", marginTop: 2 }}>
                      يقوم البوت بتثبيت بوست الختام في أعلى المحادثة فور إرساله (يتطلب صلاحية تثبيت الرسائل للبوت).
                    </div>
                  </div>
                </label>

                <div style={{ height: 1, background: "var(--clr-border-subtle)" }} />

                {/* Silent send option */}
                <label
                  style={{
                    display: "flex",
                    alignItems: "flex-start",
                    gap: 12,
                    cursor: "pointer",
                  }}
                >
                  <input
                    type="checkbox"
                    checked={draft.disableNotification}
                    onChange={(e) => setDraft((d) => ({ ...d, disableNotification: e.target.checked }))}
                    style={{ accentColor: "var(--clr-brand)", width: 18, height: 18, marginTop: 2 }}
                  />
                  <div>
                    <div style={{ fontWeight: 600, fontSize: "0.9rem", display: "flex", alignItems: "center", gap: 6 }}>
                      <BellOff size={16} color="var(--clr-info)" />
                      إرسال صامت بدون إشعار صوتي (Silent / Disable Notification)
                    </div>
                    <div style={{ fontSize: "0.78rem", color: "var(--clr-text-muted)", marginTop: 2 }}>
                      تصل الرسالة لأعضاء المجموعة بدون صوت تنبيهي لتجنب الإزعاج في الأوقات المتأخرة.
                    </div>
                  </div>
                </label>
              </div>

              {/* Target Topic Selector */}
              {topics.length > 0 && (
                <div
                  style={{
                    background: "var(--clr-bg-card)",
                    border: "1px solid var(--clr-border)",
                    borderRadius: "var(--radius-md)",
                    padding: "16px",
                    display: "flex",
                    flexDirection: "column",
                    gap: 10,
                  }}
                >
                  <label
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 8,
                      cursor: "pointer",
                      fontWeight: 600,
                      fontSize: "0.9rem",
                    }}
                  >
                    <input
                      type="checkbox"
                      checked={draft.useCustomTopic}
                      onChange={(e) => setDraft((d) => ({ ...d, useCustomTopic: e.target.checked }))}
                      style={{ accentColor: "var(--clr-brand)", width: 16, height: 16 }}
                    />
                    تحديد موضوع (Topic) مخصص لبوست الختام
                  </label>

                  <div style={{ fontSize: "0.78rem", color: "var(--clr-text-muted)" }}>
                    {draft.useCustomTopic
                      ? "اختر الموضوع الذي سيتم إرسال بوست الختام إليه:"
                      : "بشكل افتراضي، يُرسل بوست الختام إلى نفس الموضوع المختار لبث الكويزات."}
                  </div>

                  {draft.useCustomTopic && (
                    <select
                      className="select"
                      value={draft.topicId || ""}
                      onChange={(e) =>
                        setDraft((d) => ({
                          ...d,
                          topicId: e.target.value ? Number(e.target.value) : "",
                        }))
                      }
                      style={{ maxWidth: 360, fontSize: "0.88rem" }}
                    >
                      <option value="">📌 العام (General)</option>
                      {topics.map((t) => (
                        <option key={t.message_thread_id} value={t.message_thread_id}>
                          📂 {t.name}
                        </option>
                      ))}
                    </select>
                  )}
                </div>
              )}

              {/* Reset to template action */}
              <div style={{ display: "flex", justifyContent: "flex-end" }}>
                <button
                  type="button"
                  onClick={handleResetToDefault}
                  className="btn btn-ghost btn-sm"
                  style={{ color: "var(--clr-text-muted)", fontSize: "0.8rem", gap: 6 }}
                >
                  <RotateCcw size={14} /> استعادة القالب النموذجي الافتراضي
                </button>
              </div>
            </div>
          )}

          {/* TAB 4: LIVE TELEGRAM PREVIEW */}
          {activeTab === "preview" && (
            <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
              <div style={{ fontSize: "0.82rem", color: "var(--clr-text-muted)" }}>
                هذه محاكاة بصرية حية لشكل رسالة الختام كما ستظهر لأعضاء المجموعة في تطبيق تلجرام:
              </div>

              {/* Telegram Message Mockup Container */}
              <div
                style={{
                  background: "#0f172a",
                  borderRadius: 16,
                  padding: "24px",
                  border: "1px solid rgba(255,255,255,0.08)",
                  boxShadow: "inset 0 2px 10px rgba(0,0,0,0.4)",
                  display: "flex",
                  justifyContent: "center",
                }}
              >
                <div
                  style={{
                    maxWidth: 460,
                    width: "100%",
                    display: "flex",
                    flexDirection: "column",
                    gap: 6,
                  }}
                >
                  {/* Pinned banner if pinned */}
                  {draft.pinMessage && (
                    <div
                      style={{
                        background: "rgba(245, 158, 11, 0.15)",
                        border: "1px solid rgba(245, 158, 11, 0.3)",
                        borderRadius: 8,
                        padding: "6px 12px",
                        fontSize: "0.76rem",
                        color: "#fbbf24",
                        display: "flex",
                        alignItems: "center",
                        gap: 6,
                      }}
                    >
                      <Pin size={13} />
                      <span>مثبت في المحادثة</span>
                    </div>
                  )}

                  {/* Telegram Bubble */}
                  <div
                    style={{
                      background: "#1e293b",
                      borderRadius: 14,
                      border: "1px solid rgba(255,255,255,0.1)",
                      overflow: "hidden",
                      boxShadow: "0 8px 24px rgba(0,0,0,0.35)",
                    }}
                  >
                    {/* Media Preview if attached */}
                    {draft.attachMedia && (
                      <div
                        style={{
                          width: "100%",
                          maxHeight: 220,
                          overflow: "hidden",
                          background: "#0b0f17",
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                        }}
                      >
                        {draft.mediaType === "file" && draft.mediaBase64 ? (
                          <img
                            src={`data:${draft.mediaMimeType || "image/jpeg"};base64,${draft.mediaBase64}`}
                            alt="Attached"
                            style={{ width: "100%", height: "auto", objectFit: "cover" }}
                          />
                        ) : draft.mediaType === "url" && draft.mediaUrl ? (
                          <img
                            src={draft.mediaUrl}
                            alt="Attached"
                            style={{ width: "100%", height: "auto", objectFit: "cover" }}
                            onError={(e) => {
                              (e.target as HTMLElement).style.display = "none";
                            }}
                          />
                        ) : (
                          <div style={{ padding: 24, color: "var(--clr-text-muted)", fontSize: "0.8rem" }}>
                            [معاينة الصورة المرفقة]
                          </div>
                        )}
                      </div>
                    )}

                    {/* Content text */}
                    <div
                      style={{
                        padding: "14px 16px",
                        fontSize: "0.9rem",
                        lineHeight: 1.6,
                        color: "#f8fafc",
                        whiteSpace: "pre-wrap",
                        wordBreak: "break-word",
                      }}
                    >
                      {draft.parseMode === "HTML" ? (
                        <div
                          dangerouslySetInnerHTML={{
                            __html: previewText.replace(/\n/g, "<br/>"),
                          }}
                        />
                      ) : (
                        previewText
                      )}

                      {/* Bubble footer timestamp */}
                      <div
                        style={{
                          display: "flex",
                          justifyContent: "flex-end",
                          alignItems: "center",
                          gap: 4,
                          fontSize: "0.68rem",
                          color: "#94a3b8",
                          marginTop: 8,
                        }}
                      >
                        {draft.disableNotification && <BellOff size={11} />}
                        <span>{currentTimeFormatted}</span>
                        <span>✓✓</span>
                      </div>
                    </div>

                    {/* Inline Keyboard Preview */}
                    {draft.buttonRows.length > 0 && (
                      <div
                        style={{
                          padding: "6px 10px 10px",
                          display: "flex",
                          flexDirection: "column",
                          gap: 6,
                          borderTop: "1px solid rgba(255,255,255,0.06)",
                          background: "rgba(0,0,0,0.15)",
                        }}
                      >
                        {draft.buttonRows.map((row, ri) => (
                          <div key={ri} style={{ display: "flex", gap: 6 }}>
                            {row.map((btn, bi) => (
                              <a
                                key={btn.id || bi}
                                href={btn.url || "#"}
                                target="_blank"
                                rel="noreferrer"
                                onClick={(e) => e.preventDefault()}
                                style={{
                                  flex: 1,
                                  background: "rgba(99, 102, 241, 0.18)",
                                  border: "1px solid rgba(99, 102, 241, 0.35)",
                                  borderRadius: 8,
                                  padding: "8px 10px",
                                  textAlign: "center",
                                  fontSize: "0.82rem",
                                  fontWeight: 600,
                                  color: "#818cf8",
                                  textDecoration: "none",
                                  display: "flex",
                                  alignItems: "center",
                                  justifyContent: "center",
                                  gap: 6,
                                  boxShadow: "0 2px 6px rgba(0,0,0,0.2)",
                                }}
                              >
                                <span>{btn.text || "زر"}</span>
                                <ExternalLink size={12} opacity={0.7} />
                              </a>
                            ))}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Test send feedback if available */}
          {testResult && (
            <div
              style={{
                padding: "10px 14px",
                borderRadius: "var(--radius-md)",
                background: testResult.ok ? "var(--clr-success-muted)" : "var(--clr-danger-muted)",
                border: `1px solid ${testResult.ok ? "var(--clr-success)" : "var(--clr-danger)"}`,
                color: testResult.ok ? "var(--clr-success)" : "var(--clr-danger)",
                fontSize: "0.85rem",
                display: "flex",
                alignItems: "center",
                gap: 8,
              }}
            >
              {testResult.ok ? <Check size={16} /> : <AlertCircle size={16} />}
              <span>{testResult.msg}</span>
            </div>
          )}
        </div>

        {/* Modal Footer Actions */}
        <div
          style={{
            padding: "16px 24px",
            borderTop: "1px solid var(--clr-border)",
            background: "var(--clr-bg-elevated)",
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            flexWrap: "wrap",
            gap: 10,
          }}
        >
          {/* Test send button */}
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            onClick={handleTestSend}
            disabled={
              testSending ||
              (!draft.text.trim() && !draft.attachMedia) ||
              (draft.attachMedia && draft.text.length > 1024)
            }
            style={{
              border: "1px solid var(--clr-border)",
              fontSize: "0.82rem",
              gap: 6,
            }}
            title={
              draft.attachMedia && draft.text.length > 1024
                ? "لا يمكن الإرسال: نص الرسالة يتجاوز 1024 حرفاً مع الصورة"
                : "إرسال رسالة تجريبية لتلجرام الآن لمعاينة النتيجة الحقيقية"
            }
          >
            <Send size={14} color="var(--clr-brand)" />
            {testSending ? "جاري الإرسال التجريبي..." : "🚀 إرسال تجريبي لتلجرام الآن"}
          </button>

          {/* Close & Save Actions */}
          <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
            <button type="button" className="btn btn-ghost btn-sm" onClick={onClose}>
              إلغاء
            </button>

            <button
              type="button"
              className="btn btn-primary btn-sm"
              disabled={draft.attachMedia && draft.text.length > 1024}
              onClick={() => {
                handleSave(false);
                setTimeout(onClose, 500);
              }}
              style={{
                padding: "8px 20px",
                fontSize: "0.85rem",
                fontWeight: 600,
                gap: 6,
              }}
              title={
                draft.attachMedia && draft.text.length > 1024
                  ? "يرجى تقصير النص لأقل من 1024 حرفاً للحفظ مع الصورة"
                  : undefined
              }
            >
              <Save size={15} />
              {savedSuccess ? "تم الحفظ ✓" : "حفظ الإعدادات والاعتماد"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
