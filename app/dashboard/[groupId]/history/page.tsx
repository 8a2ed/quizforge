"use client";

import React, { useEffect, useState, useCallback, useRef, useMemo } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { formatDate, relativeTime, truncate } from "@/lib/utils";

interface PublicAnswer {
  id: string;
  telegramUserId: string;
  firstName: string | null;
  username: string | null;
  optionIds: number[];
  answeredAt: string;
}

interface Quiz {
  id: string;
  question: string;
  type: "QUIZ" | "POLL";
  isAnonymous: boolean;
  allowsMultiple: boolean;
  openPeriod: number | null;
  topicId: number | null;
  topicName: string | null;
  sentAt: string;
  deletedAt: string | null;
  pollClosed: boolean;
  secondsLeft?: number | null;
  options: string[];
  correctOptionId: number | null;
  explanation: string | null;
  _count: { answers: number };
  correctRate: number | null;
  sentBy: { firstName: string; username: string | null; photoUrl: string | null };
  tags?: string[];
  messageId?: number | null;
  optionVotes?: Record<number, number>;
  telegramUrl?: string | null;
  publicAnswers?: PublicAnswer[];
}

interface Pagination {
  page: number;
  limit: number;
  total: number;
  pages: number;
}

interface Summary {
  totalQuizzes: number;
  totalPolls: number;
  activeCount: number;
  closedCount: number;
  anonymousCount: number;
  publicCount: number;
  totalResponses: number;
  deletedCount: number;
  avgAccuracyRate: number | null;
}

interface TopicItem {
  topicId: number;
  name: string;
  iconColor: number | null;
}

export default function HistoryPage() {
  const params = useParams();
  const router = useRouter();
  const groupId = params.groupId as string;

  const [quizzes, setQuizzes] = useState<Quiz[]>([]);
  const [pagination, setPagination] = useState<Pagination | null>(null);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [availableTopics, setAvailableTopics] = useState<TopicItem[]>([]);
  const [availableTags, setAvailableTags] = useState<string[]>([]);
  const [groupTitle, setGroupTitle] = useState<string | null>(null);

  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [page, setPage] = useState(1);

  // Filters
  const [typeFilter, setTypeFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [privacyFilter, setPrivacyFilter] = useState("");
  const [topicFilter, setTopicFilter] = useState("");
  const [tagsFilter, setTagsFilter] = useState("");
  const [sortFilter, setSortFilter] = useState("newest");
  const [search, setSearch] = useState("");
  const [searchInput, setSearchInput] = useState("");

  // View mode: cards or table
  const [viewMode, setViewMode] = useState<"cards" | "table">("cards");

  // Expanded items (multi-expand supported)
  const [expandedIds, setExpandedIds] = useState<Record<string, boolean>>({});
  const [expandedRespondents, setExpandedRespondents] = useState<Record<string, boolean>>({});

  // Countdown timer clock
  const [now, setNow] = useState(Date.now());

  // Action states
  const [actionLoading, setActionLoading] = useState<Record<string, boolean>>({});
  const [toast, setToast] = useState<{ type: "success" | "error" | "info"; msg: string } | null>(null);

  // Confirmation modal
  const [confirmModal, setConfirmModal] = useState<{
    open: boolean;
    title: string;
    message: string;
    confirmText: string;
    cancelText?: string;
    isDanger?: boolean;
    onConfirm: () => void;
  } | null>(null);

  const searchRef = useRef<HTMLInputElement>(null);

  // Read view mode preference
  useEffect(() => {
    try {
      const saved = localStorage.getItem("qf_history_view_mode");
      if (saved === "table" || saved === "cards") {
        setViewMode(saved);
      }
    } catch {
      // ignore
    }
  }, []);

  const changeViewMode = (mode: "cards" | "table") => {
    setViewMode(mode);
    try {
      localStorage.setItem("qf_history_view_mode", mode);
    } catch {
      // ignore
    }
  };

  const showToast = (type: "success" | "error" | "info", msg: string) => {
    setToast({ type, msg });
    setTimeout(() => setToast(null), 3800);
  };

  // Live timer interval for active polls with openPeriod
  useEffect(() => {
    const hasLivePoll = quizzes.some(
      (q) => !q.pollClosed && q.openPeriod && q.sentAt
    );
    if (!hasLivePoll) return;

    const timer = setInterval(() => {
      setNow(Date.now());
    }, 1000);
    return () => clearInterval(timer);
  }, [quizzes]);

  // Main data fetching function
  const load = useCallback(
    (isManualRefresh = false) => {
      if (isManualRefresh) setRefreshing(true);
      else if (quizzes.length === 0) setLoading(true);

      const qs = new URLSearchParams({ page: String(page), limit: "15" });
      if (typeFilter) qs.set("type", typeFilter);
      if (statusFilter) qs.set("status", statusFilter);
      if (privacyFilter) qs.set("privacy", privacyFilter);
      if (topicFilter) qs.set("topicId", topicFilter);
      if (tagsFilter) qs.set("tags", tagsFilter);
      if (sortFilter) qs.set("sort", sortFilter);
      if (search) qs.set("q", search);

      fetch(`/api/groups/${groupId}/history?${qs}`)
        .then((r) => r.json())
        .then((d) => {
          if (d.quizzes) setQuizzes(d.quizzes);
          if (d.pagination) setPagination(d.pagination);
          if (d.summary) setSummary(d.summary);
          if (d.availableTopics) setAvailableTopics(d.availableTopics);
          if (d.availableTags) setAvailableTags(d.availableTags);
          if (d.groupTitle) setGroupTitle(d.groupTitle);
          setLoading(false);
          setRefreshing(false);
        })
        .catch(() => {
          setLoading(false);
          setRefreshing(false);
          showToast("error", "فشل تحميل سجل الكويزات");
        });
    },
    [groupId, page, typeFilter, statusFilter, privacyFilter, topicFilter, tagsFilter, sortFilter, search, quizzes.length]
  );

  useEffect(() => {
    load();
  }, [load]);

  // Debounced search
  useEffect(() => {
    const timer = setTimeout(() => {
      if (search !== searchInput) {
        setSearch(searchInput);
        setPage(1);
      }
    }, 350);
    return () => clearTimeout(timer);
  }, [searchInput, search]);

  // Keyboard shortcut "/" to focus search
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (
        e.key === "/" &&
        document.activeElement?.tagName !== "INPUT" &&
        document.activeElement?.tagName !== "TEXTAREA"
      ) {
        e.preventDefault();
        searchRef.current?.focus();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  // Toggle detail expand
  const toggleExpand = (quizId: string) => {
    setExpandedIds((prev) => ({ ...prev, [quizId]: !prev[quizId] }));
  };

  // Toggle public respondents
  const toggleRespondents = (quizId: string) => {
    setExpandedRespondents((prev) => ({ ...prev, [quizId]: !prev[quizId] }));
  };

  // Expand all / Collapse all
  const toggleAllExpanded = () => {
    const allExpanded = quizzes.length > 0 && quizzes.every((q) => expandedIds[q.id]);
    const newState: Record<string, boolean> = {};
    if (!allExpanded) {
      quizzes.forEach((q) => {
        newState[q.id] = true;
      });
    }
    setExpandedIds(newState);
  };

  // Duplicate Quiz Action
  const handleDuplicate = async (quiz: Quiz) => {
    setActionLoading((prev) => ({ ...prev, [`dup-${quiz.id}`]: true }));
    try {
      const res = await fetch(`/api/groups/${groupId}/quiz/${quiz.id}/duplicate`, {
        method: "POST",
      });
      const data = await res.json();
      if (data.ok && data.draft) {
        const draft = encodeURIComponent(JSON.stringify(data.draft));
        router.push(`/dashboard/${groupId}/quiz/new?draft=${draft}`);
      } else {
        showToast("error", data.error || "فشل تكرار الكويز");
      }
    } catch {
      showToast("error", "حدث خطأ في الشبكة أثناء تكرار الكويز");
    } finally {
      setActionLoading((prev) => ({ ...prev, [`dup-${quiz.id}`]: false }));
    }
  };

  // Close Poll Remote Action
  const handleClose = (quiz: Quiz) => {
    setConfirmModal({
      open: true,
      title: "⏹ إيقاف التصويت في تيليجرام؟",
      message: `هل أنت متأكد من رغبتك في إيقاف التصويت نهائياً لهذا السؤال:\n\n"${truncate(quiz.question, 90)}"\n\nسيتم إغلاق الاستطلاع في تيليجرام وتثبيت جميع النتائج وإرسال ملخص بالحل الصحيح.`,
      confirmText: "نعم، أوقف التصويت",
      cancelText: "إلغاء",
      isDanger: false,
      onConfirm: async () => {
        setConfirmModal(null);
        setActionLoading((prev) => ({ ...prev, [`close-${quiz.id}`]: true }));
        try {
          const res = await fetch(`/api/groups/${groupId}/quiz/${quiz.id}/close`, {
            method: "POST",
          });
          const data = await res.json();
          if (data.ok) {
            showToast("success", data.telegramClosed ? "تم إغلاق التصويت في تيليجرام ومزامنة النتائج!" : "تم تمييز الكويز كمغلق بنجاح");
            setQuizzes((prev) =>
              prev.map((q) => (q.id === quiz.id ? { ...q, pollClosed: true } : q))
            );
            load(true);
          } else {
            showToast("error", data.error || "فشل إغلاق الاستطلاع");
          }
        } catch {
          showToast("error", "خطأ في الشبكة أثناء محاولة إغلاق الاستطلاع");
        } finally {
          setActionLoading((prev) => ({ ...prev, [`close-${quiz.id}`]: false }));
        }
      },
    });
  };

  // Delete Quiz Remote Action
  const handleDelete = (quiz: Quiz) => {
    setConfirmModal({
      open: true,
      title: "🗑 حذف الكويز من تيليجرام؟",
      message: `هل أنت متأكد من حذف هذا الكويز:\n\n"${truncate(quiz.question, 90)}"\n\nسيتم حذف الرسالة من مجموعة تيليجرام وتحديدها كمحذوفة في السجل مع الحفاظ على الإحصائيات التاريخية.`,
      confirmText: "نعم، احذف الكويز",
      cancelText: "إلغاء",
      isDanger: true,
      onConfirm: async () => {
        setConfirmModal(null);
        setActionLoading((prev) => ({ ...prev, [`del-${quiz.id}`]: true }));
        try {
          const res = await fetch(`/api/groups/${groupId}/quiz/${quiz.id}`, {
            method: "DELETE",
          });
          const data = await res.json();
          if (data.ok) {
            showToast(
              "success",
              data.telegramDeleted
                ? "تم حذف الرسالة من تيليجرام وتحديث السجل"
                : "تم تمييز الكويز كمحذوف في السجل"
            );
            setQuizzes((prev) =>
              prev.map((q) => (q.id === quiz.id ? { ...q, deletedAt: new Date().toISOString() } : q))
            );
            load(true);
          } else {
            showToast("error", data.error || "فشل حذف الكويز");
          }
        } catch {
          showToast("error", "خطأ في الشبكة أثناء محاولة حذف الكويز");
        } finally {
          setActionLoading((prev) => ({ ...prev, [`del-${quiz.id}`]: false }));
        }
      },
    });
  };

  // Export Comprehensive CSV with Arabic UTF-8 BOM
  const exportCSV = () => {
    if (quizzes.length === 0) {
      showToast("info", "لا توجد كويزات لتصديرها");
      return;
    }

    const headers = [
      "السؤال (Question)",
      "النوع (Type)",
      "الخصوصية (Privacy)",
      "اختيار متعدد (Multiple)",
      "الحالة (Status)",
      "الموضوع (Topic)",
      "عدد المشاركين (Responses)",
      "نسبة الصحة (Accuracy)",
      "الإجابة الصحيحة (Correct Answer)",
      "الخيارات (Options)",
      "الشرح (Explanation)",
      "المرسل (Sent By)",
      "تاريخ الإرسال (Sent At)",
      "مدة الإجابة بالثواني (Timer)",
      "الوسوم (Tags)",
      "رقم الرسالة في تيليجرام (Message ID)",
      "رابط تيليجرام المباشر (Telegram URL)",
    ];

    const rows = quizzes.map((q) => {
      const correctText =
        q.type === "QUIZ" && q.correctOptionId !== null && q.options[q.correctOptionId]
          ? q.options[q.correctOptionId]
          : "N/A";

      return [
        `"${q.question.replace(/"/g, '""')}"`,
        q.type,
        q.isAnonymous ? "Anonymous" : "Public",
        q.allowsMultiple ? "Yes" : "No",
        q.deletedAt ? "Deleted" : q.pollClosed ? "Closed" : "Active",
        `"${(q.topicName || "General").replace(/"/g, '""')}"`,
        q._count.answers,
        q.correctRate !== null ? `${q.correctRate}%` : "N/A",
        `"${correctText.replace(/"/g, '""')}"`,
        `"${q.options.map((opt, i) => `${String.fromCharCode(65 + i)}: ${opt}`).join(" | ").replace(/"/g, '""')}"`,
        `"${(q.explanation || "").replace(/"/g, '""')}"`,
        `"${q.sentBy.firstName}${q.sentBy.username ? ` (@${q.sentBy.username})` : ""}"`,
        q.sentAt,
        q.openPeriod || "",
        `"${(q.tags || []).join(", ")}"`,
        q.messageId || "",
        `"${q.telegramUrl || ""}"`,
      ];
    });

    const csvContent = [headers.join(","), ...rows.map((r) => r.join(","))].join("\r\n");

    // Add \uFEFF BOM so Arabic opens properly in Microsoft Excel
    const blob = new Blob(["\uFEFF" + csvContent], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `quizforge-history-${groupId}-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    showToast("success", "تم تصدير ملف CSV بنجاح وبترميز UTF-8 سليم");
  };

  // Helper to format remaining timer
  const getTimerDisplay = (quiz: Quiz) => {
    if (quiz.pollClosed || quiz.deletedAt) return null;
    if (!quiz.openPeriod || !quiz.sentAt) return null;

    const sentTime = new Date(quiz.sentAt).getTime();
    const expiryTime = sentTime + quiz.openPeriod * 1000;
    const remainingSeconds = Math.max(0, Math.floor((expiryTime - now) / 1000));

    if (remainingSeconds <= 0) {
      return { expired: true, text: "⏱️ انتهت المدة (Closed)" };
    }

    const min = Math.floor(remainingSeconds / 60);
    const sec = remainingSeconds % 60;
    const timeStr = min > 0 ? `${min}m ${sec}s` : `${sec}s`;
    return { expired: false, text: `⏳ يغلق خلال ${timeStr}` };
  };

  // Active filters count
  const activeFiltersCount = useMemo(() => {
    let count = 0;
    if (typeFilter) count++;
    if (statusFilter) count++;
    if (privacyFilter) count++;
    if (topicFilter) count++;
    if (tagsFilter) count++;
    if (search) count++;
    return count;
  }, [typeFilter, statusFilter, privacyFilter, topicFilter, tagsFilter, search]);

  const clearAllFilters = () => {
    setTypeFilter("");
    setStatusFilter("");
    setPrivacyFilter("");
    setTopicFilter("");
    setTagsFilter("");
    setSortFilter("newest");
    setSearch("");
    setSearchInput("");
    setPage(1);
  };

  // Reusable Detail View Panel (Used in both Cards View and Table View)
  const renderDetailPanel = (quiz: Quiz) => {
    const totalAnswers = quiz._count.answers;

    return (
      <div
        style={{
          background: "rgba(0,0,0,0.25)",
          borderRadius: "var(--radius-md)",
          padding: "var(--space-3) var(--space-4)",
          border: "1px solid var(--clr-border-subtle)",
          display: "flex",
          flexDirection: "column",
          gap: 10,
          marginTop: 6,
        }}
      >
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 6 }}>
          <span style={{ fontSize: "0.82rem", fontWeight: 700, color: "var(--clr-text-secondary)" }}>
            📊 توزيع تصويت الطلاب على الخيارات ({quiz.options.length}):
          </span>
          {quiz.allowsMultiple && (
            <span
              className="badge"
              style={{
                fontSize: "0.7rem",
                background: "rgba(168,85,247,0.12)",
                color: "var(--clr-accent)",
                border: "1px solid rgba(168,85,247,0.3)",
              }}
            >
              ☑️ مسموح اختيار أكثر من إجابة (Multiple Choice)
            </span>
          )}
        </div>

        {quiz.options.map((opt, idx) => {
          const votes = quiz.optionVotes?.[idx] || 0;
          const pct = totalAnswers > 0 ? Math.min(100, Math.round((votes / totalAnswers) * 100)) : 0;
          const isCorrect = quiz.type === "QUIZ" && quiz.correctOptionId === idx;

          return (
            <div
              key={idx}
              style={{
                padding: "8px 12px",
                borderRadius: "var(--radius-sm)",
                background: isCorrect ? "rgba(16,185,129,0.12)" : "rgba(255,255,255,0.03)",
                border: `1px solid ${
                  isCorrect ? "rgba(16,185,129,0.32)" : "rgba(255,255,255,0.06)"
                }`,
                fontSize: "0.86rem",
              }}
            >
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  gap: 8,
                }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: 6, flex: 1, minWidth: 0 }}>
                  <span style={{ color: "var(--clr-text-muted)", fontWeight: 700, minWidth: 18 }}>
                    {String.fromCharCode(65 + idx)}.
                  </span>
                  {isCorrect && (
                    <span
                      style={{
                        color: "var(--clr-success)",
                        fontWeight: 700,
                        fontSize: "0.85rem",
                      }}
                      title="الإجابة الصحيحة النموذجية"
                    >
                      ✓
                    </span>
                  )}
                  <span style={{ wordBreak: "break-word" }}>{opt}</span>
                </div>

                <span
                  style={{
                    fontSize: "0.78rem",
                    fontWeight: 700,
                    color: isCorrect ? "var(--clr-success)" : "var(--clr-text-secondary)",
                    flexShrink: 0,
                  }}
                >
                  {votes} {votes === 1 ? "صوت" : "أصوات"} ({pct}%)
                </span>
              </div>

              {/* Visual Progress bar */}
              <div
                style={{
                  height: 5,
                  background: "rgba(255,255,255,0.08)",
                  borderRadius: 99,
                  overflow: "hidden",
                  marginTop: 6,
                }}
              >
                <div
                  style={{
                    width: `${pct}%`,
                    height: "100%",
                    background: isCorrect ? "var(--clr-success)" : "var(--clr-brand)",
                    borderRadius: 99,
                    transition: "width 0.4s ease",
                  }}
                />
              </div>
            </div>
          );
        })}

        {/* Explanation */}
        {quiz.explanation && (
          <div
            style={{
              marginTop: 4,
              fontSize: "0.84rem",
              color: "var(--clr-text-secondary)",
              background: "var(--clr-bg-elevated)",
              padding: "10px 14px",
              borderRadius: "var(--radius-sm)",
              borderLeft: "3px solid var(--clr-brand)",
              lineHeight: 1.6,
            }}
          >
            💡 <strong>التوضيح والشرح للطلاب:</strong> {quiz.explanation}
          </div>
        )}

        {/* Public Quiz Respondents List */}
        {!quiz.isAnonymous && quiz.publicAnswers && quiz.publicAnswers.length > 0 && (
          <div style={{ marginTop: 6 }}>
            <button
              className="btn btn-ghost btn-sm"
              style={{
                width: "100%",
                justifyContent: "space-between",
                padding: "6px 10px",
                fontSize: "0.8rem",
                border: "1px dashed var(--clr-border)",
                borderRadius: "var(--radius-sm)",
              }}
              onClick={() => toggleRespondents(quiz.id)}
            >
              <span>👥 تفاصيل إجابات الطلاب الحقيقية ({quiz.publicAnswers.length})</span>
              <span>{expandedRespondents[quiz.id] ? "▲ طي" : "▼ استعراض الأسماء"}</span>
            </button>

            {expandedRespondents[quiz.id] && (
              <div
                style={{
                  marginTop: 6,
                  maxHeight: 200,
                  overflowY: "auto",
                  display: "flex",
                  flexDirection: "column",
                  gap: 4,
                  padding: "4px 0",
                }}
              >
                {quiz.publicAnswers.map((ans) => {
                  const chosen = ans.optionIds.map((o) => quiz.options[o] || `#${o}`).join("، ");
                  const isCorrect =
                    quiz.type === "QUIZ" &&
                    quiz.correctOptionId !== null &&
                    ans.optionIds.includes(quiz.correctOptionId);

                  return (
                    <div
                      key={ans.id}
                      style={{
                        display: "flex",
                        justifyContent: "space-between",
                        alignItems: "center",
                        padding: "5px 10px",
                        background: "rgba(255,255,255,0.03)",
                        borderRadius: 4,
                        fontSize: "0.78rem",
                        gap: 8,
                      }}
                    >
                      <div style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        <span style={{ fontWeight: 600 }}>{ans.firstName || "طالب"}</span>
                        {ans.username && (
                          <span style={{ color: "var(--clr-text-muted)", marginLeft: 6 }}>
                            @{ans.username}
                          </span>
                        )}
                      </div>
                      <div style={{ display: "flex", alignItems: "center", gap: 6, flexShrink: 0 }}>
                        <span style={{ color: "var(--clr-text-secondary)" }}>{chosen}</span>
                        {quiz.type === "QUIZ" && (
                          <span
                            style={{
                              color: isCorrect ? "var(--clr-success)" : "var(--clr-danger)",
                              fontWeight: 700,
                              fontSize: "0.85rem",
                            }}
                          >
                            {isCorrect ? "✓ صحيح" : "✗ خطأ"}
                          </span>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* Anonymous Quiz Privacy Notice */}
        {quiz.isAnonymous && (
          <div
            style={{
              padding: "7px 12px",
              background: "rgba(99,102,241,0.07)",
              borderRadius: "var(--radius-sm)",
              fontSize: "0.76rem",
              color: "var(--clr-text-muted)",
              display: "flex",
              alignItems: "center",
              gap: 8,
            }}
          >
            <span>🔒</span>
            <span>
              نظام تشفير تيليجرام يحفظ خصوصية الطلاب بنسبة 100%. وتظهر كافة نسب وإحصائيات الخيارات مجمعة بدقة.
            </span>
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="container" style={{ paddingBottom: "var(--space-12)" }}>
      {/* Toast Notification */}
      {toast && (
        <div className="toast-container">
          <div className={`toast toast-${toast.type}`} style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span>{toast.type === "success" ? "✅" : toast.type === "error" ? "❌" : "ℹ️"}</span>
            <span>{toast.msg}</span>
          </div>
        </div>
      )}

      {/* Modern Confirmation Modal */}
      {confirmModal && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0,0,0,0.72)",
            backdropFilter: "blur(6px)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 1000,
            padding: "var(--space-4)",
          }}
          onClick={() => setConfirmModal(null)}
        >
          <div
            className="card"
            style={{
              maxWidth: 480,
              width: "100%",
              padding: "var(--space-6)",
              boxShadow: "var(--shadow-lg)",
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <h3 style={{ marginBottom: "var(--space-3)", fontSize: "1.15rem" }}>
              {confirmModal.title}
            </h3>
            <p
              style={{
                color: "var(--clr-text-secondary)",
                fontSize: "0.9rem",
                whiteSpace: "pre-line",
                lineHeight: 1.6,
                marginBottom: "var(--space-6)",
              }}
            >
              {confirmModal.message}
            </p>
            <div style={{ display: "flex", justifyContent: "flex-end", gap: "var(--space-3)" }}>
              <button
                className="btn btn-secondary btn-sm"
                onClick={() => setConfirmModal(null)}
              >
                {confirmModal.cancelText || "إلغاء"}
              </button>
              <button
                className={`btn btn-sm ${confirmModal.isDanger ? "btn-danger" : "btn-primary"}`}
                onClick={confirmModal.onConfirm}
              >
                {confirmModal.confirmText}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Header */}
      <div
        className="section-header animate-fade-up"
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "flex-start",
          flexWrap: "wrap",
          gap: "var(--space-4)",
          marginBottom: "var(--space-5)",
        }}
      >
        <div>
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 4, flexWrap: "wrap" }}>
            <h1 style={{ margin: 0, fontSize: "clamp(1.5rem, 3vw, 2rem)" }}>
              سجل الكويزات • Quiz History
            </h1>
            {groupTitle && (
              <span className="badge badge-brand" style={{ fontSize: "0.8rem", padding: "4px 10px" }}>
                {groupTitle}
              </span>
            )}
          </div>
          <p style={{ margin: 0, fontSize: "0.9rem", color: "var(--clr-text-secondary)" }}>
            استعراض الأسئلة والاستطلاعات المرسلة وتحليل مشاركات ودقة الطلاب وفق معايير Telegram Bot API
          </p>
        </div>

        <div style={{ display: "flex", gap: "var(--space-2)", flexWrap: "wrap", alignItems: "center" }}>
          <button
            className="btn btn-secondary btn-sm"
            onClick={() => load(true)}
            disabled={refreshing || loading}
            title="مزامنة وتحديث القائمة"
          >
            <svg
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              style={{
                animation: refreshing ? "spin 0.8s linear infinite" : "none",
              }}
            >
              <path d="M21 2v6h-6M3 12a9 9 0 0 1 15-6.7L21 8M3 22v-6h6M21 12a9 9 0 0 1-15 6.7L3 16" />
            </svg>
            تحديث Sync
          </button>

          <button
            className="btn btn-secondary btn-sm"
            onClick={exportCSV}
            disabled={quizzes.length === 0}
            title="تصدير تقرير إكسل مع ترميز UTF-8 سليم"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3" />
            </svg>
            تصدير CSV
          </button>

          <Link href={`/dashboard/${groupId}/quiz/new`} className="btn btn-primary btn-sm">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <line x1="12" y1="5" x2="12" y2="19" />
              <line x1="5" y1="12" x2="19" y2="12" />
            </svg>
            كويز جديد
          </Link>
        </div>
      </div>

      {/* KPI Overview Summary Bar */}
      {summary && (
        <div className="history-kpi-grid animate-fade-up">
          <div
            className={`history-kpi-card ${typeFilter === "quiz" ? "is-active-filter" : ""}`}
            onClick={() => {
              setTypeFilter((prev) => (prev === "quiz" ? "" : "quiz"));
              setPage(1);
            }}
            title="فلترة حسب الكويزات فقط"
          >
            <div
              style={{
                width: 38,
                height: 38,
                borderRadius: "var(--radius-md)",
                background: "rgba(99,102,241,0.12)",
                color: "var(--clr-brand)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                fontSize: "1.2rem",
                flexShrink: 0,
              }}
            >
              🎯
            </div>
            <div>
              <div style={{ fontSize: "1.35rem", fontWeight: 700, lineHeight: 1 }}>
                {summary.totalQuizzes}
              </div>
              <div style={{ fontSize: "0.75rem", color: "var(--clr-text-secondary)", marginTop: 2 }}>
                كويزات تعليمية
              </div>
            </div>
          </div>

          <div
            className={`history-kpi-card ${typeFilter === "poll" ? "is-active-filter" : ""}`}
            onClick={() => {
              setTypeFilter((prev) => (prev === "poll" ? "" : "poll"));
              setPage(1);
            }}
            title="فلترة حسب الاستطلاعات فقط"
          >
            <div
              style={{
                width: 38,
                height: 38,
                borderRadius: "var(--radius-md)",
                background: "rgba(168,85,247,0.12)",
                color: "var(--clr-accent)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                fontSize: "1.2rem",
                flexShrink: 0,
              }}
            >
              📊
            </div>
            <div>
              <div style={{ fontSize: "1.35rem", fontWeight: 700, lineHeight: 1 }}>
                {summary.totalPolls}
              </div>
              <div style={{ fontSize: "0.75rem", color: "var(--clr-text-secondary)", marginTop: 2 }}>
                استطلاعات رأي
              </div>
            </div>
          </div>

          <div className="history-kpi-card" style={{ cursor: "default" }}>
            <div
              style={{
                width: 38,
                height: 38,
                borderRadius: "var(--radius-md)",
                background: "rgba(16,185,129,0.12)",
                color: "var(--clr-success)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                fontSize: "1.2rem",
                flexShrink: 0,
              }}
            >
              👥
            </div>
            <div>
              <div style={{ fontSize: "1.35rem", fontWeight: 700, lineHeight: 1 }}>
                {summary.totalResponses.toLocaleString()}
              </div>
              <div style={{ fontSize: "0.75rem", color: "var(--clr-text-secondary)", marginTop: 2 }}>
                إجمالي الإجابات
              </div>
            </div>
          </div>

          {summary.avgAccuracyRate !== null && (
            <div
              className={`history-kpi-card ${sortFilter === "highest_rate" ? "is-active-filter" : ""}`}
              onClick={() => {
                setSortFilter((prev) => (prev === "highest_rate" ? "newest" : "highest_rate"));
                setPage(1);
              }}
              title="دقة الإجابات العامة في المجموعة (اضغط للترتيب حسب الأعلى دقة)"
            >
              <div
                style={{
                  width: 38,
                  height: 38,
                  borderRadius: "var(--radius-md)",
                  background:
                    summary.avgAccuracyRate >= 70
                      ? "rgba(16,185,129,0.12)"
                      : summary.avgAccuracyRate >= 45
                      ? "rgba(245,158,11,0.12)"
                      : "rgba(239,68,68,0.12)",
                  color:
                    summary.avgAccuracyRate >= 70
                      ? "var(--clr-success)"
                      : summary.avgAccuracyRate >= 45
                      ? "var(--clr-warning)"
                      : "var(--clr-danger)",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  fontSize: "1.1rem",
                  flexShrink: 0,
                }}
              >
                📈
              </div>
              <div>
                <div style={{ fontSize: "1.35rem", fontWeight: 700, lineHeight: 1 }}>
                  {summary.avgAccuracyRate}%
                </div>
                <div style={{ fontSize: "0.75rem", color: "var(--clr-text-secondary)", marginTop: 2 }}>
                  متوسط دقة الطلاب
                </div>
              </div>
            </div>
          )}

          <div
            className={`history-kpi-card ${statusFilter === "active" ? "is-active-filter" : ""}`}
            onClick={() => {
              setStatusFilter((prev) => (prev === "active" ? "" : "active"));
              setPage(1);
            }}
            title="فلترة الاستطلاعات النشطة حالياً"
          >
            <div
              style={{
                width: 38,
                height: 38,
                borderRadius: "var(--radius-md)",
                background: "rgba(16,185,129,0.12)",
                color: "var(--clr-success)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                position: "relative",
                flexShrink: 0,
              }}
            >
              <span className="pulsing-dot" style={{ width: 12, height: 12 }} />
            </div>
            <div>
              <div style={{ fontSize: "1.35rem", fontWeight: 700, lineHeight: 1 }}>
                {summary.activeCount}
              </div>
              <div style={{ fontSize: "0.75rem", color: "var(--clr-text-secondary)", marginTop: 2 }}>
                نشطة في تيليجرام
              </div>
            </div>
          </div>

          <div
            className={`history-kpi-card ${privacyFilter === "anonymous" ? "is-active-filter" : ""}`}
            onClick={() => {
              setPrivacyFilter((prev) => (prev === "anonymous" ? "" : "anonymous"));
              setPage(1);
            }}
            title="فلترة التصويت المجهول"
          >
            <div
              style={{
                width: 38,
                height: 38,
                borderRadius: "var(--radius-md)",
                background: "rgba(99,102,241,0.1)",
                color: "var(--clr-brand)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                fontSize: "1.1rem",
                flexShrink: 0,
              }}
            >
              🔒
            </div>
            <div>
              <div style={{ fontSize: "1.35rem", fontWeight: 700, lineHeight: 1 }}>
                {summary.anonymousCount}
              </div>
              <div style={{ fontSize: "0.75rem", color: "var(--clr-text-secondary)", marginTop: 2 }}>
                تصويت مجهول (سري)
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Filter and Control Hub */}
      <div
        className="card animate-fade-up"
        style={{
          marginBottom: "var(--space-5)",
          padding: "var(--space-4)",
        }}
      >
        <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-3)" }}>
          {/* Search and Main Filters Row */}
          <div
            style={{
              display: "flex",
              flexWrap: "wrap",
              gap: "var(--space-3)",
              alignItems: "center",
            }}
          >
            {/* Search Input */}
            <div style={{ position: "relative", flex: "1 1 240px", minWidth: 200 }}>
              <svg
                width="16"
                height="16"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                style={{
                  position: "absolute",
                  left: 12,
                  top: "50%",
                  transform: "translateY(-50%)",
                  color: "var(--clr-text-muted)",
                  pointerEvents: "none",
                }}
              >
                <circle cx="11" cy="11" r="8" />
                <path d="m21 21-4.35-4.35" />
              </svg>
              <input
                ref={searchRef}
                className="input"
                style={{ paddingLeft: 38, paddingRight: searchInput ? 36 : 12 }}
                placeholder="ابحث في الأسئلة والخيارات والناشرين... (اضغط / للتركيز)"
                value={searchInput}
                onChange={(e) => setSearchInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    setSearch(searchInput);
                    setPage(1);
                  }
                  if (e.key === "Escape") {
                    setSearchInput("");
                    setSearch("");
                    setPage(1);
                    (e.target as HTMLInputElement).blur();
                  }
                }}
              />
              {searchInput && (
                <button
                  onClick={() => {
                    setSearchInput("");
                    setSearch("");
                    setPage(1);
                  }}
                  style={{
                    position: "absolute",
                    right: 10,
                    top: "50%",
                    transform: "translateY(-50%)",
                    background: "none",
                    border: "none",
                    color: "var(--clr-text-muted)",
                    cursor: "pointer",
                    padding: 4,
                    lineHeight: 1,
                  }}
                >
                  ✕
                </button>
              )}
            </div>

            {/* Type Filter */}
            <select
              className="select"
              style={{ flex: "0 1 130px", minWidth: 110 }}
              value={typeFilter}
              onChange={(e) => {
                setTypeFilter(e.target.value);
                setPage(1);
              }}
            >
              <option value="">كل الأنواع</option>
              <option value="quiz">🎯 كويز (Quiz)</option>
              <option value="poll">📊 استطلاع (Poll)</option>
            </select>

            {/* Privacy Filter */}
            <select
              className="select"
              style={{ flex: "0 1 145px", minWidth: 120 }}
              value={privacyFilter}
              onChange={(e) => {
                setPrivacyFilter(e.target.value);
                setPage(1);
              }}
            >
              <option value="">كل الخصوصيات</option>
              <option value="anonymous">🔒 مجهول (Anonymous)</option>
              <option value="public">👥 علني (Public)</option>
            </select>

            {/* Topic Filter */}
            <select
              className="select"
              style={{ flex: "0 1 150px", minWidth: 120 }}
              value={topicFilter}
              onChange={(e) => {
                setTopicFilter(e.target.value);
                setPage(1);
              }}
            >
              <option value="">كل المواضيع / التوبيكات</option>
              <option value="general">📌 General (العام)</option>
              {availableTopics.map((t) => (
                <option key={t.topicId} value={String(t.topicId)}>
                  💬 {t.name}
                </option>
              ))}
            </select>

            {/* Tag Filter */}
            {availableTags.length > 0 && (
              <select
                className="select"
                style={{ flex: "0 1 130px", minWidth: 110 }}
                value={tagsFilter}
                onChange={(e) => {
                  setTagsFilter(e.target.value);
                  setPage(1);
                }}
              >
                <option value="">كل الوسوم</option>
                {availableTags.map((tag) => (
                  <option key={tag} value={tag}>
                    #{tag}
                  </option>
                ))}
              </select>
            )}

            {/* Sort Filter */}
            <select
              className="select"
              style={{ flex: "0 1 155px", minWidth: 135 }}
              value={sortFilter}
              onChange={(e) => {
                setSortFilter(e.target.value);
                setPage(1);
              }}
            >
              <option value="newest">🕒 الأحدث إرسالاً</option>
              <option value="oldest">⏳ الأقدم إرسالاً</option>
              <option value="most_responses">🔥 الأكثر مشاركة</option>
              <option value="highest_rate">🏆 الأعلى نسبة صحيحة</option>
              <option value="lowest_rate">⚠️ الأقل نسبة (مراجعة)</option>
            </select>

            {/* View Mode Toggle Buttons */}
            <div
              style={{
                display: "flex",
                background: "var(--clr-bg-elevated)",
                padding: 2,
                borderRadius: "var(--radius-md)",
                border: "1px solid var(--clr-border)",
                marginLeft: "auto",
              }}
            >
              <button
                className="btn btn-ghost btn-sm"
                onClick={() => changeViewMode("cards")}
                style={{
                  padding: "4px 8px",
                  borderRadius: "calc(var(--radius-md) - 2px)",
                  background: viewMode === "cards" ? "var(--clr-bg-hover)" : "transparent",
                  color: viewMode === "cards" ? "var(--clr-text-primary)" : "var(--clr-text-muted)",
                }}
                title="عرض البطاقات (Cards View)"
              >
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <rect x="3" y="3" width="7" height="7" rx="1" />
                  <rect x="14" y="3" width="7" height="7" rx="1" />
                  <rect x="14" y="14" width="7" height="7" rx="1" />
                  <rect x="3" y="14" width="7" height="7" rx="1" />
                </svg>
              </button>
              <button
                className="btn btn-ghost btn-sm"
                onClick={() => changeViewMode("table")}
                style={{
                  padding: "4px 8px",
                  borderRadius: "calc(var(--radius-md) - 2px)",
                  background: viewMode === "table" ? "var(--clr-bg-hover)" : "transparent",
                  color: viewMode === "table" ? "var(--clr-text-primary)" : "var(--clr-text-muted)",
                }}
                title="عرض الجدول المدمج (Table View)"
              >
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <line x1="3" y1="6" x2="21" y2="6" />
                  <line x1="3" y1="12" x2="21" y2="12" />
                  <line x1="3" y1="18" x2="21" y2="18" />
                </svg>
              </button>
            </div>
          </div>

          {/* Status Pills and Action Chips */}
          <div
            style={{
              display: "flex",
              gap: "var(--space-2)",
              flexWrap: "wrap",
              alignItems: "center",
              justifyContent: "space-between",
              borderTop: "1px solid var(--clr-border-subtle)",
              paddingTop: "var(--space-2)",
            }}
          >
            <div style={{ display: "flex", gap: "var(--space-2)", flexWrap: "wrap", alignItems: "center" }}>
              <span
                style={{
                  fontSize: "0.75rem",
                  color: "var(--clr-text-muted)",
                  fontWeight: 600,
                  textTransform: "uppercase",
                  letterSpacing: "0.05em",
                }}
              >
                الحالة:
              </span>
              {[
                { value: "", label: "الكل" },
                { value: "active", label: "🟢 نشط (Active)" },
                { value: "closed", label: "⏹ مغلق (Closed)" },
                { value: "deleted", label: "🗑 محذوف (Deleted)" },
              ].map((s) => (
                <button
                  key={s.value}
                  onClick={() => {
                    setStatusFilter(s.value);
                    setPage(1);
                  }}
                  style={{
                    padding: "4px 10px",
                    borderRadius: "var(--radius-full)",
                    border: "1px solid",
                    fontSize: "0.78rem",
                    fontWeight: 600,
                    cursor: "pointer",
                    transition: "all var(--duration-fast)",
                    background: statusFilter === s.value ? "var(--clr-brand)" : "var(--clr-bg-elevated)",
                    borderColor: statusFilter === s.value ? "var(--clr-brand)" : "var(--clr-border)",
                    color: statusFilter === s.value ? "white" : "var(--clr-text-secondary)",
                  }}
                >
                  {s.label}
                </button>
              ))}

              {activeFiltersCount > 0 && (
                <button
                  className="btn btn-ghost btn-sm"
                  style={{ color: "var(--clr-danger)", padding: "3px 8px", fontSize: "0.78rem" }}
                  onClick={clearAllFilters}
                >
                  إلغاء الفلاتر ({activeFiltersCount}) ✕
                </button>
              )}
            </div>

            <div style={{ display: "flex", alignItems: "center", gap: "var(--space-2)" }}>
              <button
                className="btn btn-ghost btn-sm"
                onClick={toggleAllExpanded}
                style={{ fontSize: "0.78rem", padding: "3px 8px" }}
              >
                {quizzes.length > 0 && quizzes.every((q) => expandedIds[q.id])
                  ? "طي كل التفاصيل"
                  : "توسيع كل التفاصيل"}
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Main Content Area */}
      {loading ? (
        <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-3)" }}>
          {[1, 2, 3, 4, 5].map((i) => (
            <div
              key={i}
              className="skeleton"
              style={{ height: 95, borderRadius: "var(--radius-lg)" }}
            />
          ))}
        </div>
      ) : quizzes.length === 0 ? (
        <div className="empty-state animate-fade-up">
          <div className="empty-state-icon">
            <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
              <path d="M12 8v4l3 3m6-3a9 9 0 1 1-18 0 9 9 0 0 1 18 0z" />
            </svg>
          </div>
          <h3>{search || activeFiltersCount > 0 ? "لا توجد نتائج مطابقة للبحث" : "لم يتم إرسال كويزات بعد"}</h3>
          <p>
            {search || activeFiltersCount > 0
              ? "جرّب تغيير كلمات البحث أو إعادة تعيين الفلاتر لعرض نتائج أخرى."
              : "ابدأ بإرسال أول كويز أو استطلاع رأي إلى مجموعتك في تيليجرام لمشاهدة التحليلات هنا."}
          </p>
          {activeFiltersCount > 0 ? (
            <button className="btn btn-secondary btn-sm" onClick={clearAllFilters} style={{ marginTop: 12 }}>
              إعادة ضبط كل الفلاتر
            </button>
          ) : (
            <Link
              href={`/dashboard/${groupId}/quiz/new`}
              className="btn btn-primary btn-sm"
              style={{ marginTop: 12 }}
            >
              إنشاء كويز جديد 🚀
            </Link>
          )}
        </div>
      ) : viewMode === "cards" ? (
        /* ═══════════════════════════════════════════════════════════
           MODERN CARDS VIEW (Responsive Grid)
        ═══════════════════════════════════════════════════════════ */
        <div className="history-grid animate-fade-up">
          {quizzes.map((quiz) => {
            const isExpanded = !!expandedIds[quiz.id];
            const timerInfo = getTimerDisplay(quiz);
            const totalAnswers = quiz._count.answers;
            const hasCorrectRate = quiz.correctRate !== null;

            return (
              <div
                key={quiz.id}
                className={`history-card ${
                  quiz.deletedAt ? "is-deleted" : quiz.pollClosed ? "is-closed" : "is-active"
                }`}
              >
                {/* Top Badges Header */}
                <div
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "flex-start",
                    gap: 8,
                    flexWrap: "wrap",
                  }}
                >
                  <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
                    <span
                      className={`badge ${quiz.type === "QUIZ" ? "badge-brand" : "badge-accent"}`}
                      style={{ fontSize: "0.74rem" }}
                    >
                      {quiz.type === "QUIZ" ? "🎯 كويز Quiz" : "📊 استطلاع Poll"}
                    </span>

                    <span
                      className="badge"
                      style={{
                        background: quiz.isAnonymous ? "rgba(99,102,241,0.12)" : "rgba(16,185,129,0.12)",
                        color: quiz.isAnonymous ? "var(--clr-brand)" : "var(--clr-success)",
                        fontSize: "0.72rem",
                      }}
                      title={
                        quiz.isAnonymous
                          ? "تصويت مجهول الهوية: Telegram يحمي بيانات الطلاب لزيادة المشاركة"
                          : "تصويت علني: أسماء الطلاب مسجلة في تيليجرام"
                      }
                    >
                      {quiz.isAnonymous ? "🔒 مجهول" : "👥 علني"}
                    </span>

                    {quiz.deletedAt && (
                      <span className="badge badge-danger" style={{ fontSize: "0.72rem" }}>
                        🗑 محذوف Deleted
                      </span>
                    )}

                    {quiz.pollClosed && !quiz.deletedAt && (
                      <span className="badge badge-warning" style={{ fontSize: "0.72rem" }}>
                        ⏹ مغلق Closed
                      </span>
                    )}

                    {!quiz.pollClosed && !quiz.deletedAt && timerInfo && !timerInfo.expired && (
                      <span
                        className="badge"
                        style={{
                          background: "rgba(16,185,129,0.15)",
                          color: "var(--clr-success)",
                          border: "1px solid rgba(16,185,129,0.3)",
                          fontSize: "0.72rem",
                        }}
                      >
                        <span className="pulsing-dot" style={{ width: 6, height: 6, marginRight: 4 }} />
                        {timerInfo.text}
                      </span>
                    )}

                    {!quiz.pollClosed && !quiz.deletedAt && timerInfo?.expired && (
                      <span className="badge badge-warning" style={{ fontSize: "0.72rem" }}>
                        ⏱️ انتهت المدة
                      </span>
                    )}
                  </div>

                  {/* Topic badge */}
                  <div style={{ marginLeft: "auto" }}>
                    <span
                      className="badge badge-muted"
                      style={{
                        fontSize: "0.72rem",
                        maxWidth: 160,
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                      }}
                      title={quiz.topicName || "General Topic"}
                    >
                      {quiz.topicName ? `💬 ${quiz.topicName}` : "📌 General"}
                    </span>
                  </div>
                </div>

                {/* Question Text */}
                <div style={{ margin: "2px 0" }}>
                  <h3
                    style={{
                      fontSize: "1rem",
                      fontWeight: 600,
                      lineHeight: 1.5,
                      color: "var(--clr-text-primary)",
                      wordBreak: "break-word",
                    }}
                  >
                    {quiz.question}
                  </h3>
                </div>

                {/* Metrics Stats Row */}
                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: "1fr 1fr",
                    gap: "var(--space-2)",
                    background: "var(--clr-bg-elevated)",
                    padding: "8px 12px",
                    borderRadius: "var(--radius-md)",
                    border: "1px solid var(--clr-border-subtle)",
                  }}
                >
                  <div style={{ display: "flex", flexDirection: "column" }}>
                    <span style={{ fontSize: "0.72rem", color: "var(--clr-text-muted)" }}>المشاركون</span>
                    <span style={{ fontSize: "0.95rem", fontWeight: 700, color: "var(--clr-text-primary)" }}>
                      👥 {totalAnswers} {quiz.isAnonymous ? "طالب (سري)" : "طالب"}
                    </span>
                  </div>

                  <div style={{ display: "flex", flexDirection: "column" }}>
                    <span style={{ fontSize: "0.72rem", color: "var(--clr-text-muted)" }}>
                      {quiz.type === "QUIZ" ? "نسبة الدقة" : "النوع"}
                    </span>
                    {hasCorrectRate ? (
                      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                        <span
                          style={{
                            fontSize: "0.95rem",
                            fontWeight: 700,
                            color:
                              (quiz.correctRate ?? 0) >= 70
                                ? "var(--clr-success)"
                                : (quiz.correctRate ?? 0) >= 40
                                ? "var(--clr-warning)"
                                : "var(--clr-danger)",
                          }}
                        >
                          {quiz.correctRate}%
                        </span>
                        <div
                          style={{
                            flex: 1,
                            height: 5,
                            background: "rgba(255,255,255,0.08)",
                            borderRadius: 99,
                            overflow: "hidden",
                          }}
                        >
                          <div
                            style={{
                              width: `${quiz.correctRate}%`,
                              height: "100%",
                              background:
                                (quiz.correctRate ?? 0) >= 70
                                  ? "var(--clr-success)"
                                  : (quiz.correctRate ?? 0) >= 40
                                  ? "var(--clr-warning)"
                                  : "var(--clr-danger)",
                              borderRadius: 99,
                            }}
                          />
                        </div>
                      </div>
                    ) : (
                      <span style={{ fontSize: "0.85rem", color: "var(--clr-text-muted)" }}>
                        {quiz.type === "QUIZ" ? "بانتظار الإجابات" : "استطلاع عام"}
                      </span>
                    )}
                  </div>
                </div>

                {/* Tags if any */}
                {quiz.tags && quiz.tags.length > 0 && (
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
                    {quiz.tags.map((t) => (
                      <span
                        key={t}
                        className="badge badge-muted"
                        style={{ fontSize: "0.68rem", cursor: "pointer" }}
                        onClick={() => {
                          setTagsFilter(t);
                          setPage(1);
                        }}
                      >
                        #{t}
                      </span>
                    ))}
                  </div>
                )}

                {/* Expandable Options & Breakdown */}
                {isExpanded && renderDetailPanel(quiz)}

                {/* Footer: Sender, Date, and Actions */}
                <div
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                    gap: 8,
                    flexWrap: "wrap",
                    marginTop: "auto",
                    paddingTop: "var(--space-2)",
                    borderTop: "1px solid var(--clr-border-subtle)",
                  }}
                >
                  {/* Sender Info */}
                  <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                    <div
                      className="avatar sm"
                      style={{ width: 22, height: 22, fontSize: "0.7rem" }}
                    >
                      {quiz.sentBy.photoUrl ? (
                        <img src={quiz.sentBy.photoUrl} alt="" />
                      ) : (
                        quiz.sentBy.firstName.charAt(0)
                      )}
                    </div>
                    <span style={{ fontSize: "0.76rem", color: "var(--clr-text-secondary)" }}>
                      {quiz.sentBy.username ? `@${quiz.sentBy.username}` : quiz.sentBy.firstName}
                    </span>
                    <span style={{ fontSize: "0.72rem", color: "var(--clr-text-muted)" }}>
                      • {relativeTime(quiz.sentAt)}
                    </span>
                  </div>

                  {/* Action Buttons */}
                  <div style={{ display: "flex", gap: 4, alignItems: "center" }}>
                    {/* Open in Telegram */}
                    {quiz.telegramUrl && (
                      <a
                        href={quiz.telegramUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="btn btn-ghost btn-sm"
                        style={{ padding: "4px 8px", fontSize: "0.75rem", color: "var(--clr-brand)" }}
                        title="فتح الرسالة مباشرة في تطبيق تيليجرام"
                      >
                        <svg
                          width="13"
                          height="13"
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="2"
                        >
                          <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
                          <polyline points="15 3 21 3 21 9" />
                          <line x1="10" y1="14" x2="21" y2="3" />
                        </svg>
                        تيليجرام
                      </a>
                    )}

                    {/* Duplicate */}
                    <button
                      className="btn btn-ghost btn-sm"
                      style={{ padding: "4px 8px", fontSize: "0.75rem" }}
                      onClick={() => handleDuplicate(quiz)}
                      disabled={actionLoading[`dup-${quiz.id}`]}
                      title="نسخ وتعديل الكويز في المحرر"
                    >
                      <svg
                        width="13"
                        height="13"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                      >
                        <rect x="9" y="9" width="13" height="13" rx="2" />
                        <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
                      </svg>
                      تكرار
                    </button>

                    {/* Close poll if active */}
                    {!quiz.pollClosed && !quiz.deletedAt && (
                      <button
                        className="btn btn-ghost btn-sm"
                        style={{
                          padding: "4px 8px",
                          fontSize: "0.75rem",
                          color: "var(--clr-warning)",
                        }}
                        onClick={() => handleClose(quiz)}
                        disabled={actionLoading[`close-${quiz.id}`]}
                        title="إيقاف التصويت نهائياً في تيليجرام"
                      >
                        ⏹ إيقاف
                      </button>
                    )}

                    {/* Delete */}
                    {!quiz.deletedAt && (
                      <button
                        className="btn btn-ghost btn-sm"
                        style={{
                          padding: "4px 8px",
                          fontSize: "0.75rem",
                          color: "var(--clr-danger)",
                        }}
                        onClick={() => handleDelete(quiz)}
                        disabled={actionLoading[`del-${quiz.id}`]}
                        title="حذف الرسالة من تيليجرام ومن السجل"
                      >
                        <svg
                          width="13"
                          height="13"
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="2"
                        >
                          <polyline points="3 6 5 6 21 6" />
                          <path d="M19 6l-1 14H6L5 6" />
                          <path d="M10 11v6M14 11v6" />
                        </svg>
                      </button>
                    )}

                    {/* Expand/Collapse Toggle */}
                    <button
                      className="btn btn-ghost btn-sm"
                      style={{ padding: "4px 6px" }}
                      onClick={() => toggleExpand(quiz.id)}
                      title={isExpanded ? "طي التفاصيل" : "استعراض التفاصيل الكاملة"}
                    >
                      <svg
                        width="14"
                        height="14"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                        style={{
                          transform: isExpanded ? "rotate(180deg)" : "none",
                          transition: "0.2s ease",
                        }}
                      >
                        <path d="m6 9 6 6 6-6" />
                      </svg>
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        /* ═══════════════════════════════════════════════════════════
           COMPACT TABLE VIEW (With Full Detail Row Expansion!)
        ═══════════════════════════════════════════════════════════ */
        <div className="table-wrapper animate-fade-up">
          <table className="responsive-table">
            <thead>
              <tr>
                <th>السؤال</th>
                <th>النوع والخصوصية</th>
                <th>الموضوع</th>
                <th>المرسل</th>
                <th>الإجابات</th>
                <th>نسبة الدقة</th>
                <th>التاريخ</th>
                <th style={{ textAlign: "right" }}>إجراءات</th>
              </tr>
            </thead>
            <tbody>
              {quizzes.map((quiz) => {
                const isExpanded = !!expandedIds[quiz.id];
                const totalAnswers = quiz._count.answers;

                return (
                  <React.Fragment key={quiz.id}>
                    <tr
                      className={`history-table-row ${isExpanded ? "is-expanded" : ""}`}
                      onClick={() => toggleExpand(quiz.id)}
                    >
                      <td data-label="السؤال" style={{ maxWidth: 300 }}>
                        <div
                          style={{
                            fontWeight: 600,
                            overflow: "hidden",
                            textOverflow: "ellipsis",
                            whiteSpace: "nowrap",
                          }}
                          title={quiz.question}
                        >
                          {truncate(quiz.question, 65)}
                        </div>
                      </td>

                      <td data-label="النوع والخصوصية">
                        <div style={{ display: "flex", gap: 4, flexWrap: "wrap", alignItems: "center" }}>
                          <span
                            className={`badge ${quiz.type === "QUIZ" ? "badge-brand" : "badge-accent"}`}
                            style={{ fontSize: "0.7rem" }}
                          >
                            {quiz.type === "QUIZ" ? "🎯 Quiz" : "📊 Poll"}
                          </span>
                          <span
                            className="badge"
                            style={{
                              background: quiz.isAnonymous ? "rgba(99,102,241,0.12)" : "rgba(16,185,129,0.12)",
                              color: quiz.isAnonymous ? "var(--clr-brand)" : "var(--clr-success)",
                              fontSize: "0.68rem",
                            }}
                          >
                            {quiz.isAnonymous ? "🔒 Anon" : "👥 Public"}
                          </span>
                          {quiz.pollClosed && !quiz.deletedAt && (
                            <span className="badge badge-warning" style={{ fontSize: "0.68rem" }}>
                              ⏹ Closed
                            </span>
                          )}
                          {quiz.deletedAt && (
                            <span className="badge badge-danger" style={{ fontSize: "0.68rem" }}>
                              🗑 Deleted
                            </span>
                          )}
                        </div>
                      </td>

                      <td data-label="الموضوع" style={{ fontSize: "0.82rem", color: "var(--clr-text-secondary)" }}>
                        <div>{quiz.topicName ? `💬 ${quiz.topicName}` : "📌 General"}</div>
                      </td>

                      <td data-label="المرسل">
                        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                          <div className="avatar sm" style={{ width: 22, height: 22, fontSize: "0.7rem" }}>
                            {quiz.sentBy.photoUrl ? (
                              <img src={quiz.sentBy.photoUrl} alt="" />
                            ) : (
                              quiz.sentBy.firstName.charAt(0)
                            )}
                          </div>
                          <span style={{ fontSize: "0.82rem" }}>
                            {quiz.sentBy.username ? `@${quiz.sentBy.username}` : quiz.sentBy.firstName}
                          </span>
                        </div>
                      </td>

                      <td data-label="الإجابات">
                        <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
                          <span style={{ fontWeight: 700 }}>{totalAnswers}</span>
                          {quiz.isAnonymous && <span title="تصويت مجهول">🔒</span>}
                        </div>
                      </td>

                      <td data-label="نسبة الدقة">
                        {quiz.correctRate !== null ? (
                          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                            <span
                              style={{
                                fontSize: "0.84rem",
                                fontWeight: 700,
                                color:
                                  (quiz.correctRate ?? 0) >= 70
                                    ? "var(--clr-success)"
                                    : (quiz.correctRate ?? 0) >= 40
                                    ? "var(--clr-warning)"
                                    : "var(--clr-danger)",
                              }}
                            >
                              {quiz.correctRate}%
                            </span>
                          </div>
                        ) : (
                          <span style={{ color: "var(--clr-text-muted)", fontSize: "0.8rem" }}>—</span>
                        )}
                      </td>

                      <td data-label="التاريخ" style={{ fontSize: "0.8rem", color: "var(--clr-text-muted)", whiteSpace: "nowrap" }}>
                        {formatDate(quiz.sentAt)}
                      </td>

                      <td data-label="إجراءات" onClick={(e) => e.stopPropagation()} style={{ textAlign: "right" }}>
                        <div style={{ display: "inline-flex", gap: 4 }}>
                          {quiz.telegramUrl && (
                            <a
                              href={quiz.telegramUrl}
                              target="_blank"
                              rel="noreferrer"
                              className="btn btn-ghost btn-sm"
                              style={{ padding: "4px 6px", color: "var(--clr-brand)" }}
                              title="فتح في تيليجرام"
                            >
                              ↗
                            </a>
                          )}
                          <button
                            className="btn btn-ghost btn-sm"
                            style={{ padding: "4px 6px" }}
                            onClick={() => handleDuplicate(quiz)}
                            disabled={actionLoading[`dup-${quiz.id}`]}
                            title="تكرار الكويز"
                          >
                            📋
                          </button>
                          <button
                            className="btn btn-ghost btn-sm"
                            style={{ padding: "4px 6px" }}
                            onClick={() => toggleExpand(quiz.id)}
                            title={isExpanded ? "طي التفاصيل" : "عرض التفاصيل"}
                          >
                            {isExpanded ? "▲" : "▼"}
                          </button>
                        </div>
                      </td>
                    </tr>

                    {/* Expanded Detail Row in Table View */}
                    {isExpanded && (
                      <tr className="history-table-detail-row">
                        <td colSpan={8} onClick={(e) => e.stopPropagation()}>
                          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 10, flexWrap: "wrap" }}>
                              <div>
                                <h4 style={{ margin: "0 0 4px 0", fontSize: "1rem", color: "var(--clr-text-primary)" }}>
                                  {quiz.question}
                                </h4>
                                <div style={{ fontSize: "0.78rem", color: "var(--clr-text-muted)" }}>
                                  مرسل بواسطة: <strong>{quiz.sentBy.firstName}</strong> ({quiz.sentBy.username ? `@${quiz.sentBy.username}` : "بدون معرف"}) • في {formatDate(quiz.sentAt)}
                                </div>
                              </div>

                              {/* Action buttons inside table detail */}
                              <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
                                {quiz.telegramUrl && (
                                  <a
                                    href={quiz.telegramUrl}
                                    target="_blank"
                                    rel="noreferrer"
                                    className="btn btn-secondary btn-sm"
                                    style={{ fontSize: "0.78rem", padding: "4px 10px" }}
                                  >
                                    ↗ فتح في تيليجرام
                                  </a>
                                )}
                                <button
                                  className="btn btn-secondary btn-sm"
                                  style={{ fontSize: "0.78rem", padding: "4px 10px" }}
                                  onClick={() => handleDuplicate(quiz)}
                                  disabled={actionLoading[`dup-${quiz.id}`]}
                                >
                                  📋 تكرار الكويز
                                </button>
                                {!quiz.pollClosed && !quiz.deletedAt && (
                                  <button
                                    className="btn btn-warning btn-sm"
                                    style={{ fontSize: "0.78rem", padding: "4px 10px" }}
                                    onClick={() => handleClose(quiz)}
                                    disabled={actionLoading[`close-${quiz.id}`]}
                                  >
                                    ⏹ إيقاف التصويت
                                  </button>
                                )}
                                {!quiz.deletedAt && (
                                  <button
                                    className="btn btn-danger btn-sm"
                                    style={{ fontSize: "0.78rem", padding: "4px 10px" }}
                                    onClick={() => handleDelete(quiz)}
                                    disabled={actionLoading[`del-${quiz.id}`]}
                                  >
                                    🗑 حذف
                                  </button>
                                )}
                              </div>
                            </div>

                            {renderDetailPanel(quiz)}
                          </div>
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Pagination Controls */}
      {pagination && pagination.pages > 1 && (
        <div
          style={{
            display: "flex",
            justifyContent: "center",
            alignItems: "center",
            gap: "var(--space-2)",
            marginTop: "var(--space-6)",
            flexWrap: "wrap",
          }}
        >
          <button
            className="btn btn-secondary btn-sm"
            disabled={page <= 1}
            onClick={() => setPage((p) => p - 1)}
          >
            ← السابق
          </button>

          {Array.from({ length: pagination.pages }, (_, i) => i + 1)
            .filter((p) => Math.abs(p - page) <= 2 || p === 1 || p === pagination.pages)
            .map((p, idx, arr) => {
              const prev = arr[idx - 1];
              return (
                <span key={p} style={{ display: "inline-flex", alignItems: "center" }}>
                  {prev && p - prev > 1 && (
                    <span style={{ padding: "0 4px", color: "var(--clr-text-muted)" }}>...</span>
                  )}
                  <button
                    className={`btn btn-sm ${p === page ? "btn-primary" : "btn-secondary"}`}
                    onClick={() => setPage(p)}
                    style={{ minWidth: 34 }}
                  >
                    {p}
                  </button>
                </span>
              );
            })}

          <button
            className="btn btn-secondary btn-sm"
            disabled={page >= pagination.pages}
            onClick={() => setPage((p) => p + 1)}
          >
            التالي →
          </button>

          <span
            style={{
              fontSize: "0.82rem",
              color: "var(--clr-text-muted)",
              marginLeft: "var(--space-3)",
            }}
          >
            إجمالي {pagination.total} سؤال
          </span>
        </div>
      )}
    </div>
  );
}
