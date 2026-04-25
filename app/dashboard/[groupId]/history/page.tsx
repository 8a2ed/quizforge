"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import { useParams, useRouter } from "next/navigation";
import { formatDate, truncate } from "@/lib/utils";

interface Quiz {
  id: string;
  question: string;
  type: "QUIZ" | "POLL";
  isAnonymous: boolean;
  topicName: string | null;
  sentAt: string;
  deletedAt: string | null;
  pollClosed: boolean;
  options: string[];
  correctOptionId: number | null;
  explanation: string | null;
  _count: { answers: number };
  correctRate: number | null;
  sentBy: { firstName: string; username: string | null; photoUrl: string | null };
}

interface Pagination {
  page: number;
  limit: number;
  total: number;
  pages: number;
}

export default function HistoryPage() {
  const params = useParams();
  const router = useRouter();
  const groupId = params.groupId as string;

  const [quizzes, setQuizzes] = useState<Quiz[]>([]);
  const [pagination, setPagination] = useState<Pagination | null>(null);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [typeFilter, setTypeFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [search, setSearch] = useState("");
  const [searchInput, setSearchInput] = useState("");
  const [expanded, setExpanded] = useState<string | null>(null);
  const [toast, setToast] = useState<{ type: string; msg: string } | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  const showToast = (type: string, msg: string) => {
    setToast({ type, msg });
    setTimeout(() => setToast(null), 3500);
  };

  const load = useCallback(() => {
    setLoading(true);
    const qs = new URLSearchParams({ page: String(page), limit: "15" });
    if (typeFilter) qs.set("type", typeFilter);
    if (statusFilter) qs.set("status", statusFilter);
    if (search) qs.set("q", search);
    fetch(`/api/groups/${groupId}/history?${qs}`)
      .then((r) => r.json())
      .then((d) => {
        setQuizzes(d.quizzes || []);
        setPagination(d.pagination);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, [groupId, page, typeFilter, statusFilter, search]);

  // Keyboard shortcut: press "/" to focus search
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "/" && document.activeElement?.tagName !== "INPUT" && document.activeElement?.tagName !== "TEXTAREA") {
        e.preventDefault();
        searchRef.current?.focus();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  useEffect(() => { load(); }, [load]);

  const handleDuplicate = async (quiz: Quiz) => {
    const res = await fetch(`/api/groups/${groupId}/quiz/${quiz.id}/duplicate`, { method: "POST" });
    const data = await res.json();
    if (data.ok) {
      const draft = encodeURIComponent(JSON.stringify(data.draft));
      router.push(`/dashboard/${groupId}/quiz/new?draft=${draft}`);
    } else {
      showToast("error", data.error || "Failed to duplicate");
    }
  };

  const handleDelete = async (quiz: Quiz) => {
    if (!confirm(`Delete "${quiz.question.slice(0, 60)}"?\n\nThis will remove it from Telegram and your history.`)) return;
    const res = await fetch(`/api/groups/${groupId}/quiz/${quiz.id}`, { method: "DELETE" });
    const data = await res.json();
    if (data.ok) {
      showToast("success", data.telegramDeleted ? "Deleted from Telegram & history" : "Marked as deleted (message may already be removed from Telegram)");
      load(); // refresh list
    } else {
      showToast("error", data.error || "Failed to delete");
    }
  };

  const exportCSV = () => {
    const rows = quizzes.map((q) => [
      `"${q.question.replace(/"/g, '""')}"`,
      q.type,
      q._count.answers,
      q.correctRate !== null ? `${q.correctRate}%` : "N/A",
      q.topicName || "General",
      `${q.sentBy.firstName}${q.sentBy.username ? ` (@${q.sentBy.username})` : ""}`,
      q.sentAt,
    ]);
    const csv = [
      ["Question","Type","Answers","Correct Rate","Topic","Sent By","Date"].join(","),
      ...rows.map((r) => r.join(",")),
    ].join("\n");
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `quizforge-history-${new Date().toISOString().slice(0,10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div>
      {/* Toast */}
      {toast && (
        <div className="toast-container">
          <div className={`toast toast-${toast.type}`}>{toast.msg}</div>
        </div>
      )}

      {/* Header */}
      <div className="section-header animate-fade-up">
        <div>
          <h1>Quiz History</h1>
          <p>{pagination ? `${pagination.total} quizzes sent` : "Loading…"}</p>
        </div>
        <div style={{ display: "flex", gap: "var(--space-3)", flexWrap: "wrap" }}>
          <button className="btn btn-secondary" onClick={exportCSV}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M7 10l5 5 5-5M12 15V3"/>
            </svg>
            Export CSV
          </button>
        </div>
      </div>

      {/* Filters */}
      <div className="card animate-fade-up animate-delay-1" style={{ marginBottom: "var(--space-5)", padding: "var(--space-4)" }}>
        <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-3)" }}>
          {/* Search row */}
          <div style={{ display: "flex", gap: "var(--space-3)", flexWrap: "wrap" }}>
            <div style={{ position: "relative", flex: 1, minWidth: 200 }}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
                style={{ position: "absolute", left: 12, top: "50%", transform: "translateY(-50%)", color: "var(--clr-text-muted)", pointerEvents: "none" }}>
                <circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/>
              </svg>
              <input
                ref={searchRef}
                className="input"
                style={{ paddingLeft: 40, paddingRight: searchInput ? 36 : 12 }}
                placeholder="Search questions… (press / to focus)"
                value={searchInput}
                onChange={(e) => setSearchInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") { setSearch(searchInput); setPage(1); }
                  if (e.key === "Escape") { setSearchInput(""); setSearch(""); setPage(1); (e.target as HTMLInputElement).blur(); }
                }}
              />
              {searchInput && (
                <button
                  onClick={() => { setSearchInput(""); setSearch(""); setPage(1); }}
                  style={{ position: "absolute", right: 10, top: "50%", transform: "translateY(-50%)", background: "none", border: "none", color: "var(--clr-text-muted)", cursor: "pointer", padding: 2, lineHeight: 1 }}
                >✕</button>
              )}
            </div>
            <select
              className="select"
              style={{ width: "auto", minWidth: 130 }}
              value={typeFilter}
              onChange={(e) => { setTypeFilter(e.target.value); setPage(1); }}
            >
              <option value="">All types</option>
              <option value="quiz">🎯 Quiz</option>
              <option value="poll">📊 Poll</option>
            </select>
            <button className="btn btn-primary btn-sm" onClick={() => { setSearch(searchInput); setPage(1); }}>Search</button>
          </div>

          {/* Status pills */}
          <div style={{ display: "flex", gap: "var(--space-2)", flexWrap: "wrap", alignItems: "center" }}>
            <span style={{ fontSize: "0.75rem", color: "var(--clr-text-muted)", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.05em" }}>Status:</span>
            {[
              { value: "",        label: "All" },
              { value: "active",  label: "🟢 Active" },
              { value: "closed",  label: "⏹ Closed" },
              { value: "deleted", label: "🗑 Deleted" },
            ].map((s) => (
              <button
                key={s.value}
                onClick={() => { setStatusFilter(s.value); setPage(1); }}
                style={{
                  padding: "4px 12px",
                  borderRadius: "var(--radius-full)",
                  border: "1px solid",
                  fontSize: "0.8rem",
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
            {(search || typeFilter || statusFilter) && (
              <button
                className="btn btn-ghost btn-sm"
                style={{ marginLeft: "auto" }}
                onClick={() => { setSearch(""); setSearchInput(""); setTypeFilter(""); setStatusFilter(""); setPage(1); }}
              >
                Clear All ✕
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Table */}
      {loading ? (
        <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-3)" }}>
          {[1,2,3,4,5].map((i) => (
            <div key={i} className="skeleton" style={{ height: 60, borderRadius: "var(--radius-md)" }} />
          ))}
        </div>
      ) : quizzes.length === 0 ? (
        <div className="empty-state">
          <div className="empty-state-icon">
            <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
              <path d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"/>
            </svg>
          </div>
          <h3>{search ? "No results found" : "No quizzes yet"}</h3>
          <p>{search ? `No quizzes match "${search}"` : "Send your first quiz to see it here"}</p>
        </div>
      ) : (
        <>
          <div className="table-wrapper animate-fade-up animate-delay-2">
            <table className="responsive-table">
              <thead>
                <tr>
                  <th>Question</th>
                  <th>Type</th>
                  <th>Topic</th>
                  <th>Sent By</th>
                  <th>Responses</th>
                  <th>Correct Rate</th>
                  <th>Date</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {quizzes.map((quiz) => (
                  <>
                    <tr
                      key={quiz.id}
                      style={{ cursor: "pointer" }}
                      onClick={() => setExpanded(expanded === quiz.id ? null : quiz.id)}
                    >
                      <td data-label="Question" style={{ maxWidth: 280 }}>
                        <div style={{ fontWeight: 500, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                          {truncate(quiz.question, 55)}
                        </div>
                      </td>
                      <td data-label="Type">
                        <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
                          <span className={`badge ${quiz.type === "QUIZ" ? "badge-brand" : "badge-accent"}`}>
                            {quiz.type === "QUIZ" ? "🎯 Quiz" : "📊 Poll"}
                          </span>
                          {quiz.deletedAt && (
                            <span className="badge" style={{ background: "rgba(239,68,68,0.15)", color: "#f87171", fontSize: "0.7rem" }}>🗑 Deleted</span>
                          )}
                          {quiz.pollClosed && !quiz.deletedAt && (
                            <span className="badge" style={{ background: "rgba(251,191,36,0.15)", color: "#fbbf24", fontSize: "0.7rem" }}>⏹ Closed</span>
                          )}
                        </div>
                      </td>
                      <td data-label="Topic" style={{ color: "var(--clr-text-muted)", fontSize: "0.85rem" }}>
                        {quiz.topicName || "General"}
                      </td>
                      <td data-label="Sent By">
                        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                          <div className="avatar sm">
                            {quiz.sentBy.photoUrl
                              ? <img src={quiz.sentBy.photoUrl} alt="" />
                              : quiz.sentBy.firstName.charAt(0)}
                          </div>
                          <span style={{ fontSize: "0.85rem" }}>
                            {quiz.sentBy.username ? `@${quiz.sentBy.username}` : quiz.sentBy.firstName}
                          </span>
                        </div>
                      </td>
                      <td data-label="Responses">
                        <span style={{ fontWeight: 600 }}>{quiz._count.answers}</span>
                      </td>
                      <td data-label="Correct Rate">
                        {quiz.correctRate !== null ? (
                          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                            <div style={{
                              width: 40, height: 6,
                              background: "var(--clr-bg-hover)",
                              borderRadius: "var(--radius-full)",
                              overflow: "hidden",
                            }}>
                              <div style={{
                                width: `${quiz.correctRate}%`,
                                height: "100%",
                                background: quiz.correctRate >= 70
                                  ? "var(--clr-success)"
                                  : quiz.correctRate >= 40
                                    ? "var(--clr-warning)"
                                    : "var(--clr-danger)",
                                borderRadius: "var(--radius-full)",
                                transition: "width 0.5s var(--ease-out)",
                              }} />
                            </div>
                            <span style={{ fontSize: "0.85rem", fontWeight: 600 }}>{quiz.correctRate}%</span>
                          </div>
                        ) : (
                          <span style={{ color: "var(--clr-text-muted)", fontSize: "0.85rem" }}>—</span>
                        )}
                      </td>
                      <td data-label="Date" style={{ color: "var(--clr-text-muted)", fontSize: "0.82rem", whiteSpace: "nowrap" }}>
                        {formatDate(quiz.sentAt)}
                      </td>
                      <td data-label="Actions" onClick={(e) => e.stopPropagation()}>
                        <div style={{ display: "flex", gap: 6 }}>
                          <button
                            className="btn btn-ghost btn-sm"
                            title="Duplicate quiz"
                            onClick={() => handleDuplicate(quiz)}
                          >
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                              <rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"/>
                            </svg>
                          </button>
                          {!quiz.deletedAt && (
                            <button
                              className="btn btn-ghost btn-sm"
                              title="Delete from Telegram & history"
                              style={{ color: "var(--clr-danger)" }}
                              onClick={() => handleDelete(quiz)}
                            >
                              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                <polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6M14 11v6"/><path d="M9 6V4h6v2"/>
                              </svg>
                            </button>
                          )}
                          <button
                            className="btn btn-ghost btn-sm"
                            title="Expand details"
                            onClick={() => setExpanded(expanded === quiz.id ? null : quiz.id)}
                          >
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
                              style={{ transform: expanded === quiz.id ? "rotate(180deg)" : "none", transition: "0.2s" }}>
                              <path d="m6 9 6 6 6-6"/>
                            </svg>
                          </button>
                        </div>
                      </td>
                    </tr>

                    {/* Expanded row */}
                    {expanded === quiz.id && (
                      <tr key={`${quiz.id}-detail`}>
                        <td colSpan={8} style={{ background: "var(--clr-bg-elevated)", padding: "var(--space-5)" }}>
                          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "var(--space-6)" }}>
                            {/* Options */}
                            <div>
                              <h4 style={{ marginBottom: "var(--space-3)", fontSize: "0.875rem" }}>Full Question</h4>
                              <p style={{ color: "var(--clr-text-primary)", fontWeight: 500, marginBottom: "var(--space-4)", lineHeight: 1.5 }}>
                                {quiz.question}
                              </p>
                              <h4 style={{ marginBottom: "var(--space-3)", fontSize: "0.875rem" }}>Answer Options</h4>
                              {quiz.options.map((opt, idx) => (
                                <div key={idx} style={{
                                  padding: "var(--space-2) var(--space-3)",
                                  marginBottom: 6,
                                  borderRadius: "var(--radius-md)",
                                  background: quiz.type === "QUIZ" && quiz.correctOptionId === idx
                                    ? "var(--clr-success-muted)"
                                    : "var(--clr-bg-hover)",
                                  border: `1px solid ${quiz.type === "QUIZ" && quiz.correctOptionId === idx
                                    ? "rgba(52,211,153,0.3)"
                                    : "var(--clr-border)"}`,
                                  display: "flex",
                                  justifyContent: "space-between",
                                  alignItems: "center",
                                  fontSize: "0.875rem",
                                }}>
                                  <span>
                                    <span style={{ color: "var(--clr-text-muted)", marginRight: 8, fontWeight: 600 }}>
                                      {String.fromCharCode(65 + idx)}.
                                    </span>
                                    {quiz.type === "QUIZ" && quiz.correctOptionId === idx && (
                                      <span style={{ color: "var(--clr-success)", marginRight: 6 }}>✓</span>
                                    )}
                                    {opt}
                                  </span>
                                </div>
                              ))}
                              {quiz.explanation && (
                                <div style={{
                                  marginTop: "var(--space-3)",
                                  fontSize: "0.85rem",
                                  color: "var(--clr-text-muted)",
                                  background: "var(--clr-bg-hover)",
                                  padding: "var(--space-3)",
                                  borderRadius: "var(--radius-md)",
                                  borderLeft: "3px solid var(--clr-brand)",
                                }}>
                                  💡 <strong>Explanation:</strong> {quiz.explanation}
                                </div>
                              )}
                            </div>

                            {/* Meta */}
                            <div>
                              <h4 style={{ marginBottom: "var(--space-3)", fontSize: "0.875rem" }}>Details</h4>
                              <dl style={{ display: "grid", gridTemplateColumns: "auto 1fr", gap: "var(--space-2) var(--space-4)" }}>
                                {([
                                  ["Type", quiz.type === "QUIZ" ? "🎯 Quiz" : "📊 Poll"],
                                  ["Sent By", `${quiz.sentBy.firstName}${quiz.sentBy.username ? ` (@${quiz.sentBy.username})` : ""}`],
                                  ["Anonymous", quiz.isAnonymous ? "Yes" : "No"],
                                  ["Total Responses", String(quiz._count.answers)],
                                  ["Correct Rate", quiz.correctRate !== null ? `${quiz.correctRate}%` : "N/A"],
                                  ["Topic", quiz.topicName || "General"],
                                  ["Date Sent", formatDate(quiz.sentAt)],
                                ] as [string,string][]).map(([k, v]) => (
                                  <>
                                    <dt key={`k-${k}`} style={{ color: "var(--clr-text-muted)", fontSize: "0.8rem", fontWeight: 600, whiteSpace: "nowrap" }}>{k}</dt>
                                    <dd key={`v-${k}`} style={{ color: "var(--clr-text-primary)", fontSize: "0.875rem" }}>{v}</dd>
                                  </>
                                ))}
                              </dl>

                              <div style={{ marginTop: "var(--space-5)", display: "flex", gap: "var(--space-3)" }}>
                                <button
                                  className="btn btn-secondary btn-sm"
                                  onClick={() => handleDuplicate(quiz)}
                                >
                                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                    <rect x="9" y="9" width="13" height="13" rx="2"/>
                                    <path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"/>
                                  </svg>
                                  Duplicate & Edit
                                </button>
                              </div>
                            </div>
                          </div>
                        </td>
                      </tr>
                    )}
                  </>
                ))}
              </tbody>
            </table>
          </div>

          {/* Pagination */}
          {pagination && pagination.pages > 1 && (
            <div style={{ display: "flex", justifyContent: "center", alignItems: "center", gap: "var(--space-2)", marginTop: "var(--space-6)" }}>
              <button
                className="btn btn-secondary btn-sm"
                disabled={page <= 1}
                onClick={() => setPage((p) => p - 1)}
              >← Prev</button>

              {Array.from({ length: pagination.pages }, (_, i) => i + 1)
                .filter((p) => Math.abs(p - page) <= 2)
                .map((p) => (
                  <button
                    key={p}
                    className={`btn btn-sm ${p === page ? "btn-primary" : "btn-secondary"}`}
                    onClick={() => setPage(p)}
                  >{p}</button>
                ))}

              <button
                className="btn btn-secondary btn-sm"
                disabled={page >= pagination.pages}
                onClick={() => setPage((p) => p + 1)}
              >Next →</button>

              <span style={{ fontSize: "0.8rem", color: "var(--clr-text-muted)", marginLeft: "var(--space-3)" }}>
                {pagination.total} total
              </span>
            </div>
          )}
        </>
      )}
    </div>
  );
}
