"use client";
import { useEffect, useState, useCallback } from "react";
import { useParams } from "next/navigation";

interface Question { question: string; options: string[]; correctOptionId: number; explanation?: string; }
interface Topic { message_thread_id: number; name: string; }

interface Exam {
  id: string; title: string; description?: string;
  questions: Question[]; timeLimit: number | null; passingScore: number;
  isPublished: boolean; launchMsgId?: number | null; createdAt: string;
  topicId?: number | null; topicName?: string | null;
  _count: { results: number };
  createdBy?: { firstName: string; username?: string | null };
}

interface QuestionDetail {
  questionIndex: number;
  question: string;
  options: string[];
  chosenOptionId: number | null;
  chosenOptionText: string;
  correctOptionId: number;
  correctOptionText: string;
  isCorrect: boolean;
  isAnswered: boolean;
  explanation: string | null;
}

interface Result {
  id: string;
  name: string;
  telegramId?: string;
  score: number;
  passed: boolean;
  duration?: number;
  completedAt: string;
  answers?: Record<string, any>;
  correctCount: number;
  totalQuestions: number;
  details: QuestionDetail[];
}

interface QuestionAnalytic {
  index: number;
  question: string;
  options: string[];
  correctOptionId: number;
  explanation: string | null;
  totalAnswered: number;
  correctCount: number;
  successRate: number;
  difficulty: "EASY" | "MEDIUM" | "HARD";
  optionCounts: number[];
  mostCommonMistake: {
    optionIndex: number;
    optionText: string;
    count: number;
    percentage: number;
  } | null;
}

interface ExamStats {
  id: string;
  title: string;
  description?: string;
  passingScore: number;
  timeLimit: number | null;
  isPublished: boolean;
  createdAt: string;
  totalResults: number;
  inProgressCount: number;
  passCount: number;
  failCount: number;
  passRate: number;
  avgScore: number;
  highestScore: number;
  lowestScore: number;
  avgDuration: number;
  questionsCount: number;
}

interface ViewResultsState {
  exam: Exam & ExamStats;
  questionAnalytics: QuestionAnalytic[];
  results: Result[];
}

const emptyQ = (): Question => ({ question: "", options: ["", "", "", ""], correctOptionId: 0 });

function timeAgo(iso: string) {
  const s = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return new Date(iso).toLocaleDateString();
}

export default function ExamsPage() {
  const { groupId } = useParams() as { groupId: string };
  const [exams, setExams] = useState<Exam[]>([]);
  const [loading, setLoading] = useState(true);
  const [toast, setToast] = useState<{ type: string; msg: string } | null>(null);
  const [mode, setMode] = useState<"list" | "create" | "edit" | "results">("list");
  const [viewResults, setViewResults] = useState<ViewResultsState | null>(null);
  const [editingExam, setEditingExam] = useState<Exam | null>(null);

  // Results interactive filters
  const [resultsTab, setResultsTab] = useState<"students" | "questions">("students");
  const [studentSearch, setStudentSearch] = useState("");
  const [studentFilter, setStudentFilter] = useState<"all" | "passed" | "failed" | "inProgress">("all");
  const [studentSort, setStudentSort] = useState<"newest" | "highest" | "lowest" | "fastest" | "slowest">("newest");
  const [expandedStudentIds, setExpandedStudentIds] = useState<Set<string>>(new Set());
  const [savingQuestionIdx, setSavingQuestionIdx] = useState<number | null>(null);

  // Form state
  const [title, setTitle] = useState("");
  const [desc, setDesc] = useState("");
  const [timeLimit, setTimeLimit] = useState("");
  const [passingScore, setPassingScore] = useState("60");
  const [topicId, setTopicId] = useState<number | "">("");
  const [topicName, setTopicName] = useState("");
  const [topics, setTopics] = useState<Topic[]>([]);
  const [questions, setQuestions] = useState<Question[]>([emptyQ()]);
  const [saving, setSaving] = useState(false);

  const showToast = (type: string, msg: string) => {
    setToast({ type, msg });
    setTimeout(() => setToast(null), 4000);
  };

  const load = useCallback(() => {
    setLoading(true);
    fetch(`/api/groups/${groupId}/exams`)
      .then(async r => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); })
      .then(d => { setExams(d.exams || []); setLoading(false); })
      .catch(e => { setLoading(false); showToast("error", `Failed to load: ${e.message}`); });
  }, [groupId]);

  useEffect(() => { load(); }, [load]);
  // Load topics once
  useEffect(() => {
    fetch(`/api/groups/${groupId}/topics`)
      .then(r => r.json()).then(d => setTopics(d.topics || [])).catch(() => {});
  }, [groupId]);

  // Reset form
  const resetForm = () => {
    setTitle(""); setDesc(""); setTimeLimit(""); setPassingScore("60");
    setTopicId(""); setTopicName("");
    setQuestions([emptyQ()]); setEditingExam(null);
  };

  const openCreate = () => { resetForm(); setMode("create"); };

  const openEdit = (exam: Exam) => {
    setEditingExam(exam);
    setTitle(exam.title);
    setDesc(exam.description || "");
    setTimeLimit(exam.timeLimit ? String(Math.floor(exam.timeLimit / 60)) : "");
    setPassingScore(String(exam.passingScore));
    setTopicId(exam.topicId ?? "");
    setTopicName(exam.topicName || "");
    setQuestions((exam.questions as Question[]).map(q => ({ ...q, options: [...q.options] })));
    setMode("edit");
  };

  const validateQuestions = (): { valid: Question[]; error?: string } => {
    if (questions.length === 0) return { valid: [], error: "Please add at least 1 question." };

    for (let i = 0; i < questions.length; i++) {
      const q = questions[i];
      const qText = q.question.trim();
      if (!qText) {
        return { valid: [], error: `Question ${i + 1}: Please enter question text.` };
      }
      const cleanOpts = q.options.map(o => o.trim()).filter(Boolean);
      if (cleanOpts.length < 2) {
        return { valid: [], error: `Question ${i + 1}: Needs at least 2 non-empty options.` };
      }
      if (cleanOpts.length > 10) {
        return { valid: [], error: `Question ${i + 1}: Maximum 10 options allowed.` };
      }
      const lower = cleanOpts.map(o => o.toLowerCase());
      if (new Set(lower).size !== lower.length) {
        return { valid: [], error: `Question ${i + 1}: Options must be unique (duplicate answers found).` };
      }
      if (q.correctOptionId < 0 || q.correctOptionId >= cleanOpts.length) {
        return { valid: [], error: `Question ${i + 1}: Please select a valid correct answer option.` };
      }
    }

    const cleaned = questions.map(q => ({
      question: q.question.trim(),
      options: q.options.map(o => o.trim()).filter(Boolean),
      correctOptionId: q.correctOptionId,
      explanation: q.explanation?.trim() || undefined,
    }));

    return { valid: cleaned };
  };

  const handleCreate = async () => {
    if (!title.trim()) return showToast("error", "Exam title is required");
    const { valid: validQ, error } = validateQuestions();
    if (error) return showToast("error", error);
    setSaving(true);
    const score = Math.min(100, Math.max(1, parseInt(passingScore) || 60));
    const limit = timeLimit && parseInt(timeLimit) > 0 ? parseInt(timeLimit) * 60 : null;
    const res = await fetch(`/api/groups/${groupId}/exams`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title: title.trim(),
        description: desc.trim() || null,
        questions: validQ,
        timeLimit: limit,
        passingScore: score,
        topicId: topicId || null,
        topicName: topicId ? (topics.find(t => t.message_thread_id === topicId)?.name || "") : null,
      }),
    });
    const data = await res.json();
    setSaving(false);
    if (data.ok) { showToast("success", "Exam created successfully!"); resetForm(); setMode("list"); load(); }
    else showToast("error", data.error || "Failed to create exam");
  };

  const handleSaveEdit = async () => {
    if (!editingExam) return;
    if (!title.trim()) return showToast("error", "Exam title is required");
    const { valid: validQ, error } = validateQuestions();
    if (error) return showToast("error", error);
    setSaving(true);
    const score = Math.min(100, Math.max(1, parseInt(passingScore) || 60));
    const limit = timeLimit && parseInt(timeLimit) > 0 ? parseInt(timeLimit) * 60 : null;
    const res = await fetch(`/api/groups/${groupId}/exams`, {
      method: "PATCH", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        id: editingExam.id,
        title: title.trim(),
        description: desc.trim() || null,
        questions: validQ,
        timeLimit: limit,
        passingScore: score,
        topicId: topicId || null,
        topicName: topicId ? (topics.find(t => t.message_thread_id === topicId)?.name || "") : null,
      }),
    });
    setSaving(false);
    if (res.ok) { showToast("success", "Exam changes saved!"); resetForm(); setMode("list"); load(); }
    else showToast("error", "Failed to save exam");
  };

  const handlePublish = async (exam: Exam) => {
    const verb = exam.isPublished ? "Re-send" : "Launch";
    if (!confirm(`${verb} exam "${exam.title}" to the Telegram group?`)) return;
    const res = await fetch(`/api/groups/${groupId}/exams`, {
      method: "PATCH", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: exam.id, isPublished: true }),
    });
    if (res.ok) { showToast("success", `✅ Exam ${exam.isPublished ? "re-sent" : "launched"} in Telegram!`); load(); }
    else showToast("error", "Failed to publish");
  };

  const handleDelete = async (id: string) => {
    if (!confirm("Delete this exam? All results will be lost.")) return;
    await fetch(`/api/groups/${groupId}/exams`, { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id }) });
    setExams(p => p.filter(e => e.id !== id));
    showToast("success", "Deleted");
  };

  const loadResults = async (exam: Exam) => {
    try {
      const res = await fetch(`/api/groups/${groupId}/exams/${exam.id}/results`);
      if (!res.ok) throw new Error("Failed to load results");
      const data = await res.json();
      if (data.exam) {
        setViewResults({
          exam: { ...exam, ...data.exam },
          questionAnalytics: data.questionAnalytics || [],
          results: data.results || [],
        });
        setResultsTab("students");
        setStudentSearch("");
        setStudentFilter("all");
        setStudentSort("newest");
        setExpandedStudentIds(new Set());
        setMode("results");
      }
    } catch (e: any) {
      showToast("error", e.message || "Failed to load results");
    }
  };

  const toggleExpandStudent = (id: string) => {
    setExpandedStudentIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const saveQuestionToLibrary = async (q: QuestionAnalytic) => {
    setSavingQuestionIdx(q.index);
    try {
      const res = await fetch("/api/templates", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          question: q.question,
          options: q.options,
          type: "QUIZ",
          correctOptionId: q.correctOptionId,
          explanation: q.explanation || null,
          tags: ["exam", (viewResults?.exam.title || "exam-q").slice(0, 20)],
        }),
      });
      const data = await res.json();
      if (res.ok) {
        showToast("success", `Q${q.index + 1} saved to Question Library ✓`);
      } else {
        showToast("error", data.error || "Failed to save question");
      }
    } catch {
      showToast("error", "Network error saving question");
    } finally {
      setSavingQuestionIdx(null);
    }
  };

  const exportResultsCSV = () => {
    if (!viewResults || viewResults.results.length === 0) {
      showToast("error", "No results to export.");
      return;
    }
    const exam = viewResults.exam;
    const questionsCount = viewResults.questionAnalytics.length;

    const headers = [
      "Student Name",
      "Telegram ID",
      "Score (%)",
      "Correct Answers",
      "Total Questions",
      "Status",
      "Duration (Seconds)",
      "Duration Formatted",
      "Completed At",
    ];

    for (let i = 0; i < questionsCount; i++) {
      headers.push(`Q${i + 1} Result`);
      headers.push(`Q${i + 1} Chosen Option`);
    }

    const rows = viewResults.results.map(r => {
      const dur = r.duration ? `${Math.floor(r.duration / 60)}m ${r.duration % 60}s` : "N/A";
      const status = r.score < 0 ? "In Progress" : r.passed ? "Passed" : "Failed";
      const row = [
        `"${(r.name || "").replace(/"/g, '""')}"`,
        `"${(r.telegramId || "").replace(/"/g, '""')}"`,
        r.score < 0 ? "N/A" : r.score,
        r.correctCount ?? "N/A",
        r.totalQuestions ?? questionsCount,
        status,
        r.duration ?? "N/A",
        `"${dur}"`,
        `"${new Date(r.completedAt).toLocaleString()}"`,
      ];

      for (let i = 0; i < questionsCount; i++) {
        const detail = r.details?.[i];
        if (!detail || !detail.isAnswered) {
          row.push('"Not Answered"');
          row.push('"N/A"');
        } else {
          row.push(detail.isCorrect ? '"CORRECT ✅"' : '"INCORRECT ❌"');
          row.push(`"${(detail.chosenOptionText || "").replace(/"/g, '""')}"`);
        }
      }
      return row.join(",");
    });

    const csvContent = "\uFEFF" + [headers.join(","), ...rows].join("\r\n");
    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `exam-${exam.title.replace(/\s+/g, "_")}-results.csv`;
    a.click();
    URL.revokeObjectURL(url);
    showToast("success", `Exported ${viewResults.results.length} result(s) to CSV ✓`);
  };

  const setQ = (i: number, field: keyof Question, val: string | string[] | number) =>
    setQuestions(prev => prev.map((q, idx) => idx === i ? { ...q, [field]: val } : q));

  // ── Results view ──────────────────────────────────────────────────────────
  if (mode === "results" && viewResults) {
    const exam = viewResults.exam;
    const completedResults = viewResults.results.filter(r => r.score >= 0);
    const inProgressCount = viewResults.results.filter(r => r.score < 0).length;

    const filteredStudents = viewResults.results
      .filter(r => {
        const inProgress = r.score < 0;
        if (studentFilter === "passed" && (!r.passed || inProgress)) return false;
        if (studentFilter === "failed" && (r.passed || inProgress)) return false;
        if (studentFilter === "inProgress" && !inProgress) return false;
        if (!studentSearch.trim()) return true;
        const term = studentSearch.toLowerCase();
        return (
          r.name.toLowerCase().includes(term) ||
          (r.telegramId && r.telegramId.toLowerCase().includes(term))
        );
      })
      .sort((a, b) => {
        if (studentSort === "highest") return b.score - a.score;
        if (studentSort === "lowest") return a.score - b.score;
        if (studentSort === "fastest") return (a.duration || 999999) - (b.duration || 999999);
        if (studentSort === "slowest") return (b.duration || 0) - (a.duration || 0);
        return new Date(b.completedAt).getTime() - new Date(a.completedAt).getTime();
      });

    return (
      <div>
        {toast && (
          <div className="toast-container">
            <div className={`toast toast-${toast.type}`}>{toast.msg}</div>
          </div>
        )}

        {/* Top Header */}
        <div className="section-header animate-fade-up">
          <div>
            <h1>{exam.title} — Results & Analytics</h1>
            <p style={{ marginTop: 4 }}>
              {exam.totalResults} completed submission{exam.totalResults !== 1 ? "s" : ""}
              {inProgressCount > 0 && ` · ${inProgressCount} in progress`}
              {` · Passing score: ${exam.passingScore}%`}
              {exam.timeLimit ? ` · Time limit: ${Math.floor(exam.timeLimit / 60)}m` : " · No time limit"}
            </p>
          </div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
            <button
              className="btn btn-ghost btn-sm"
              style={{ border: "1px solid var(--clr-border)" }}
              onClick={exportResultsCSV}
              disabled={viewResults.results.length === 0}
              title="Export all student scores and answers to Excel-compatible CSV"
            >
              📥 Export CSV
            </button>
            <button className="btn btn-secondary btn-sm" onClick={() => { setViewResults(null); setMode("list"); }}>
              ← Back to Exams
            </button>
          </div>
        </div>

        {/* ── KPI Metric Cards ── */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 12, marginBottom: 20 }}>
          {/* Card 1: Submissions */}
          <div className="card" style={{ padding: "var(--space-3) var(--space-4)" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <span style={{ fontSize: "0.76rem", color: "var(--clr-text-muted)", fontWeight: 600 }}>👥 Submissions</span>
              {inProgressCount > 0 && (
                <span className="badge badge-accent" style={{ fontSize: "0.68rem" }}>
                  +{inProgressCount} in progress
                </span>
              )}
            </div>
            <div style={{ fontSize: "1.6rem", fontWeight: 800, color: "var(--clr-brand)", marginTop: 4 }}>
              {exam.totalResults}
            </div>
            <div style={{ fontSize: "0.72rem", color: "var(--clr-text-muted)", marginTop: 2 }}>
              {viewResults.results.length} total participants
            </div>
          </div>

          {/* Card 2: Pass Rate */}
          <div className="card" style={{ padding: "var(--space-3) var(--space-4)" }}>
            <div style={{ fontSize: "0.76rem", color: "var(--clr-text-muted)", fontWeight: 600 }}>🏆 Pass Rate</div>
            <div style={{ fontSize: "1.6rem", fontWeight: 800, color: exam.passRate >= 70 ? "var(--clr-success)" : exam.passRate >= 50 ? "var(--clr-warning)" : "var(--clr-danger)", marginTop: 4 }}>
              {exam.passRate}%
            </div>
            <div style={{ fontSize: "0.72rem", color: "var(--clr-text-muted)", marginTop: 2 }}>
              ✅ {exam.passCount} passed · ❌ {exam.failCount} failed
            </div>
          </div>

          {/* Card 3: Average Score */}
          <div className="card" style={{ padding: "var(--space-3) var(--space-4)" }}>
            <div style={{ fontSize: "0.76rem", color: "var(--clr-text-muted)", fontWeight: 600 }}>🎯 Average Score</div>
            <div style={{ fontSize: "1.6rem", fontWeight: 800, color: "var(--clr-warning)", marginTop: 4 }}>
              {exam.avgScore}%
            </div>
            <div style={{ fontSize: "0.72rem", color: "var(--clr-text-muted)", marginTop: 2 }}>
              Min: {exam.lowestScore}% · Max: {exam.highestScore}%
            </div>
          </div>

          {/* Card 4: Average Duration */}
          <div className="card" style={{ padding: "var(--space-3) var(--space-4)" }}>
            <div style={{ fontSize: "0.76rem", color: "var(--clr-text-muted)", fontWeight: 600 }}>⏱ Avg Time Taken</div>
            <div style={{ fontSize: "1.6rem", fontWeight: 800, color: "var(--clr-accent)", marginTop: 4 }}>
              {exam.avgDuration ? `${Math.floor(exam.avgDuration / 60)}m ${exam.avgDuration % 60}s` : "—"}
            </div>
            <div style={{ fontSize: "0.72rem", color: "var(--clr-text-muted)", marginTop: 2 }}>
              {exam.timeLimit && exam.avgDuration
                ? `${Math.round((exam.avgDuration / exam.timeLimit) * 100)}% of limit (${Math.floor(exam.timeLimit / 60)}m)`
                : "No time limit set"}
            </div>
          </div>
        </div>

        {/* ── Sub-Tabs Navigation ── */}
        <div style={{ display: "flex", gap: 8, borderBottom: "1px solid var(--clr-border)", paddingBottom: 8, marginBottom: 16 }}>
          <button
            onClick={() => setResultsTab("students")}
            className="btn btn-ghost btn-sm"
            style={{
              borderBottom: resultsTab === "students" ? "2px solid var(--clr-brand)" : "none",
              color: resultsTab === "students" ? "var(--clr-brand)" : "var(--clr-text-muted)",
              fontWeight: 600,
              borderRadius: 0,
            }}
          >
            👥 Student Submissions ({viewResults.results.length})
          </button>
          <button
            onClick={() => setResultsTab("questions")}
            className="btn btn-ghost btn-sm"
            style={{
              borderBottom: resultsTab === "questions" ? "2px solid var(--clr-brand)" : "none",
              color: resultsTab === "questions" ? "var(--clr-brand)" : "var(--clr-text-muted)",
              fontWeight: 600,
              borderRadius: 0,
            }}
          >
            📊 Question Performance & Item Analysis ({viewResults.questionAnalytics.length})
          </button>
        </div>

        {/* ── TAB 1: Student Submissions ── */}
        {resultsTab === "students" && (
          <div>
            {/* Filter Bar */}
            <div className="card" style={{ padding: "var(--space-3) var(--space-4)", marginBottom: 16 }}>
              <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
                {/* Search */}
                <div style={{ position: "relative", flex: "1 1 200px" }}>
                  <input
                    className="input"
                    placeholder="Search students by name or @username…"
                    value={studentSearch}
                    onChange={e => setStudentSearch(e.target.value)}
                    style={{ width: "100%", fontSize: "0.84rem" }}
                  />
                </div>

                {/* Status Filter Buttons */}
                <div style={{ display: "flex", gap: 4 }}>
                  {(
                    [
                      { id: "all", label: `All (${viewResults.results.length})` },
                      { id: "passed", label: `Passed (${exam.passCount})` },
                      { id: "failed", label: `Failed (${exam.failCount})` },
                      { id: "inProgress", label: `In Progress (${inProgressCount})` },
                    ] as const
                  ).map(pill => (
                    <button
                      key={pill.id}
                      onClick={() => setStudentFilter(pill.id)}
                      className="btn btn-ghost btn-sm"
                      style={{
                        fontSize: "0.75rem",
                        padding: "4px 10px",
                        border: `1px solid ${studentFilter === pill.id ? "var(--clr-brand)" : "var(--clr-border)"}`,
                        color: studentFilter === pill.id ? "var(--clr-brand)" : "var(--clr-text-muted)",
                        background: studentFilter === pill.id ? "var(--clr-brand-muted)" : "transparent",
                      }}
                    >
                      {pill.label}
                    </button>
                  ))}
                </div>

                {/* Sort */}
                <select
                  className="select"
                  style={{ flex: "0 1 150px", fontSize: "0.8rem", padding: "4px 8px", height: 34 }}
                  value={studentSort}
                  onChange={e => setStudentSort(e.target.value as any)}
                >
                  <option value="newest">🕐 Most Recent</option>
                  <option value="highest">🏆 Highest Score</option>
                  <option value="lowest">📉 Lowest Score</option>
                  <option value="fastest">⚡ Fastest Time</option>
                  <option value="slowest">⏳ Slowest Time</option>
                </select>
              </div>
            </div>

            {/* List */}
            {filteredStudents.length === 0 ? (
              <div className="empty-state">
                <div className="empty-state-icon">📋</div>
                <h3>No matching submissions</h3>
                <p>Try adjusting your search query or filters.</p>
              </div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                {filteredStudents.map(r => {
                  const inProgress = r.score < 0;
                  const isExpanded = expandedStudentIds.has(r.id);
                  const timeLimitSec = exam.timeLimit;
                  const durationFormatted = r.duration ? `${Math.floor(r.duration / 60)}m ${r.duration % 60}s` : null;

                  return (
                    <div
                      key={r.id}
                      className="card"
                      style={{
                        padding: 0,
                        overflow: "hidden",
                        border: `1px solid ${inProgress ? "rgba(245,158,11,0.3)" : r.passed ? "rgba(52,211,153,0.3)" : "rgba(248,113,113,0.3)"}`,
                      }}
                    >
                      {/* Row Header */}
                      <div
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: 12,
                          padding: "14px 18px",
                          flexWrap: "wrap",
                          background: inProgress
                            ? "rgba(245,158,11,0.03)"
                            : r.passed
                            ? "rgba(52,211,153,0.03)"
                            : "rgba(248,113,113,0.03)",
                        }}
                      >
                        {/* Score Circle */}
                        <div
                          style={{
                            width: 44,
                            height: 44,
                            borderRadius: "50%",
                            background: inProgress
                              ? "rgba(245,158,11,0.12)"
                              : r.passed
                              ? "var(--clr-success-muted)"
                              : "rgba(248,113,113,0.12)",
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "center",
                            fontWeight: 800,
                            fontSize: "0.95rem",
                            color: inProgress
                              ? "var(--clr-warning)"
                              : r.passed
                              ? "var(--clr-success)"
                              : "var(--clr-danger)",
                            flexShrink: 0,
                          }}
                        >
                          {inProgress ? "⏱" : `${r.score}%`}
                        </div>

                        {/* Student Info */}
                        <div style={{ flex: 1, minWidth: 160 }}>
                          <div style={{ fontWeight: 700, fontSize: "0.95rem" }}>{r.name}</div>
                          <div style={{ fontSize: "0.74rem", color: "var(--clr-text-muted)", marginTop: 2 }}>
                            {r.telegramId ? (
                              <span style={{ color: "var(--clr-brand)", marginRight: 6 }}>
                                ID: {r.telegramId}
                              </span>
                            ) : null}
                            <span>🕐 {new Date(r.completedAt).toLocaleString()}</span>
                          </div>
                        </div>

                        {/* Metrics: Score + Duration */}
                        <div style={{ display: "flex", gap: 16, alignItems: "center", flexWrap: "wrap" }}>
                          {!inProgress && (
                            <div style={{ textAlign: "right" }}>
                              <div style={{ fontSize: "0.88rem", fontWeight: 700 }}>
                                🎯 {r.correctCount} / {r.totalQuestions}
                              </div>
                              <div style={{ fontSize: "0.7rem", color: "var(--clr-text-muted)" }}>
                                Correct answers
                              </div>
                            </div>
                          )}

                          {durationFormatted && (
                            <div style={{ textAlign: "right" }}>
                              <div style={{ fontSize: "0.88rem", fontWeight: 700 }}>
                                ⏱ {durationFormatted}
                              </div>
                              <div style={{ fontSize: "0.7rem", color: "var(--clr-text-muted)" }}>
                                {timeLimitSec ? `${Math.round((r.duration! / timeLimitSec) * 100)}% of limit` : "Time taken"}
                              </div>
                            </div>
                          )}

                          {/* Status Badge */}
                          <span className={`badge ${inProgress ? "badge-muted" : r.passed ? "badge-success" : "badge-danger"}`} style={{ fontSize: "0.75rem", padding: "4px 10px" }}>
                            {inProgress ? "⏱ In Progress" : r.passed ? "✓ Passed" : "✗ Failed"}
                          </span>

                          {/* Accordion Toggle */}
                          {!inProgress && r.details && r.details.length > 0 && (
                            <button
                              className="btn btn-ghost btn-sm"
                              style={{ fontSize: "0.76rem", border: "1px solid var(--clr-border)", padding: "4px 10px" }}
                              onClick={() => toggleExpandStudent(r.id)}
                            >
                              {isExpanded ? "▲ Hide Answers" : "👁 View Answers"}
                            </button>
                          )}
                        </div>
                      </div>

                      {/* Expanded Question-by-Question Breakdown */}
                      {isExpanded && !inProgress && r.details && (
                        <div style={{ padding: "16px 20px", borderTop: "1px solid var(--clr-border)", background: "var(--clr-bg-elevated)" }}>
                          <div style={{ fontWeight: 600, fontSize: "0.85rem", marginBottom: 12, color: "var(--clr-text-secondary)" }}>
                            📝 Question-by-Question Detailed Review for {r.name}:
                          </div>

                          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                            {r.details.map((item, qIdx) => (
                              <div
                                key={qIdx}
                                style={{
                                  padding: "10px 14px",
                                  borderRadius: "var(--radius-md)",
                                  background: "var(--clr-bg-card)",
                                  border: `1px solid ${!item.isAnswered ? "var(--clr-border)" : item.isCorrect ? "rgba(52,211,153,0.3)" : "rgba(248,113,113,0.3)"}`,
                                }}
                              >
                                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 10, marginBottom: 6 }}>
                                  <div style={{ fontWeight: 600, fontSize: "0.88rem", flex: 1 }}>
                                    <span style={{ color: "var(--clr-text-muted)", marginRight: 6 }}>Q{qIdx + 1}:</span>
                                    {item.question}
                                  </div>
                                  <span
                                    className={`badge ${!item.isAnswered ? "badge-muted" : item.isCorrect ? "badge-success" : "badge-danger"}`}
                                    style={{ fontSize: "0.72rem", flexShrink: 0 }}
                                  >
                                    {!item.isAnswered ? "⚠️ Not Answered" : item.isCorrect ? "✅ Correct" : "❌ Incorrect"}
                                  </span>
                                </div>

                                <div style={{ fontSize: "0.82rem", display: "flex", flexDirection: "column", gap: 4 }}>
                                  <div style={{ color: item.isCorrect ? "var(--clr-success)" : "var(--clr-danger)" }}>
                                    <b>Student's Answer:</b> {item.chosenOptionId !== null ? `Option ${String.fromCharCode(65 + item.chosenOptionId)} — ${item.chosenOptionText}` : "None"}
                                  </div>

                                  {!item.isCorrect && (
                                    <div style={{ color: "var(--clr-success)" }}>
                                      <b>Correct Answer:</b> Option {String.fromCharCode(65 + item.correctOptionId)} — {item.correctOptionText}
                                    </div>
                                  )}

                                  {item.explanation && (
                                    <div style={{ marginTop: 4, fontSize: "0.76rem", color: "var(--clr-text-muted)", background: "rgba(0,0,0,0.15)", padding: "4px 8px", borderRadius: 4 }}>
                                      💡 {item.explanation}
                                    </div>
                                  )}
                                </div>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* ── TAB 2: Question Performance & Item Analysis ── */}
        {resultsTab === "questions" && (
          <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            {viewResults.questionAnalytics.length === 0 ? (
              <div className="empty-state">
                <div className="empty-state-icon">📊</div>
                <h3>No question analytics</h3>
                <p>Question analysis will be computed automatically once students take the exam.</p>
              </div>
            ) : (
              viewResults.questionAnalytics.map((q, qIdx) => {
                const diffColor = q.difficulty === "EASY" ? "var(--clr-success)" : q.difficulty === "MEDIUM" ? "var(--clr-warning)" : "var(--clr-danger)";
                const isSaving = savingQuestionIdx === q.index;

                return (
                  <div key={qIdx} className="card" style={{ padding: "18px 20px" }}>
                    {/* Header */}
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 10, marginBottom: 12, flexWrap: "wrap" }}>
                      <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                        <span className="badge badge-brand" style={{ fontSize: "0.78rem" }}>
                          Question #{qIdx + 1}
                        </span>
                        <span
                          className="badge"
                          style={{
                            background: `${diffColor}22`,
                            color: diffColor,
                            border: `1px solid ${diffColor}44`,
                            fontSize: "0.72rem",
                          }}
                        >
                          {q.difficulty === "EASY" ? "🟢 Easy (سهل)" : q.difficulty === "MEDIUM" ? "🟡 Medium (متوسط)" : "🔴 Hard (صعب)"}
                        </span>
                        <span style={{ fontSize: "0.76rem", color: "var(--clr-text-muted)" }}>
                          {q.correctCount} of {q.totalAnswered} answered correctly ({q.successRate}%)
                        </span>
                      </div>

                      <button
                        className="btn btn-ghost btn-sm"
                        style={{ border: "1px solid var(--clr-border)", fontSize: "0.76rem" }}
                        onClick={() => saveQuestionToLibrary(q)}
                        disabled={isSaving}
                        title="Save this question to your Question Library so you can reuse or send it anytime"
                      >
                        {isSaving ? "Saving…" : "💾 Save to Question Library"}
                      </button>
                    </div>

                    {/* Question Text */}
                    <div style={{ fontWeight: 600, fontSize: "0.95rem", lineHeight: 1.45, marginBottom: 14 }}>
                      {q.question}
                    </div>

                    {/* Options Distribution Bars */}
                    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                      {q.options.map((opt, optIdx) => {
                        const count = q.optionCounts[optIdx] || 0;
                        const pct = q.totalAnswered > 0 ? Math.round((count / q.totalAnswered) * 100) : 0;
                        const isCorrect = optIdx === q.correctOptionId;

                        return (
                          <div key={optIdx} style={{ position: "relative" }}>
                            {/* Background Bar */}
                            <div
                              style={{
                                position: "absolute",
                                left: 0,
                                top: 0,
                                bottom: 0,
                                width: `${pct}%`,
                                borderRadius: "var(--radius-sm)",
                                background: isCorrect ? "rgba(52,211,153,0.15)" : "rgba(255,255,255,0.04)",
                                transition: "width 0.4s var(--ease-out)",
                              }}
                            />

                            {/* Option Content */}
                            <div
                              style={{
                                position: "relative",
                                display: "flex",
                                justifyContent: "space-between",
                                alignItems: "center",
                                padding: "8px 12px",
                                borderRadius: "var(--radius-sm)",
                                border: `1px solid ${isCorrect ? "rgba(52,211,153,0.4)" : "var(--clr-border)"}`,
                                fontSize: "0.84rem",
                              }}
                            >
                              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                                <span style={{ fontWeight: 700, color: isCorrect ? "var(--clr-success)" : "var(--clr-text-muted)" }}>
                                  {String.fromCharCode(65 + optIdx)}.
                                </span>
                                <span style={{ color: isCorrect ? "var(--clr-success)" : "var(--clr-text-primary)" }}>
                                  {opt}
                                </span>
                                {isCorrect && (
                                  <span className="badge badge-success" style={{ fontSize: "0.65rem", padding: "1px 6px" }}>
                                    ✓ Correct Answer
                                  </span>
                                )}
                              </div>

                              <div style={{ fontWeight: 700, fontSize: "0.82rem", color: isCorrect ? "var(--clr-success)" : "var(--clr-text-muted)" }}>
                                {pct}% <span style={{ fontWeight: 400, fontSize: "0.72rem" }}>({count})</span>
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>

                    {/* Trap Detection Warning */}
                    {q.mostCommonMistake && (
                      <div
                        style={{
                          marginTop: 12,
                          padding: "8px 12px",
                          borderRadius: "var(--radius-sm)",
                          background: "rgba(245,158,11,0.08)",
                          border: "1px solid rgba(245,158,11,0.3)",
                          display: "flex",
                          alignItems: "center",
                          gap: 8,
                          fontSize: "0.78rem",
                          color: "var(--clr-warning)",
                        }}
                      >
                        <span>⚠️</span>
                        <div>
                          <b>Common Distractor / Trap:</b> {q.mostCommonMistake.percentage}% of students mistakenly selected{" "}
                          <b>
                            Option {String.fromCharCode(65 + q.mostCommonMistake.optionIndex)} ("{q.mostCommonMistake.optionText}")
                          </b>.
                        </div>
                      </div>
                    )}

                    {/* Explanation */}
                    {q.explanation && (
                      <div style={{ marginTop: 10, fontSize: "0.78rem", color: "var(--clr-text-muted)", padding: "6px 10px", background: "rgba(0,0,0,0.15)", borderRadius: 6 }}>
                        💡 <b>Explanation:</b> {q.explanation}
                      </div>
                    )}
                  </div>
                );
              })
            )}
          </div>
        )}
      </div>
    );
  }

  // ── Exam form (create / edit) ─────────────────────────────────────────────
  const isEditing = mode === "edit";
  if (mode === "create" || mode === "edit") return (
    <div>
      {toast && <div className="toast-container"><div className={`toast toast-${toast.type}`}>{toast.msg}</div></div>}
      <div className="section-header animate-fade-up">
        <div><h1>{isEditing ? `Edit: ${editingExam?.title}` : "Create New Exam"}</h1></div>
        <button className="btn btn-ghost" onClick={() => { resetForm(); setMode("list"); }}>✕ Cancel</button>
      </div>

      <div className="card animate-fade-up" style={{ marginBottom: 20 }}>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 12 }}>
          <div className="input-wrapper" style={{ marginBottom: 0 }}>
            <label className="input-label">Title *</label>
            <input className="input" placeholder="Midterm Exam" value={title} onChange={e => setTitle(e.target.value)} />
          </div>
          <div className="input-wrapper" style={{ marginBottom: 0 }}>
            <label className="input-label">Description</label>
            <input className="input" placeholder="Optional intro…" value={desc} onChange={e => setDesc(e.target.value)} />
          </div>
          <div className="input-wrapper" style={{ marginBottom: 0 }}>
            <label className="input-label">Time Limit (minutes, 0 = none)</label>
            <input className="input" type="number" min="0" placeholder="30" value={timeLimit} onChange={e => setTimeLimit(e.target.value)} />
          </div>
          <div className="input-wrapper" style={{ marginBottom: 0 }}>
            <label className="input-label">Passing Score (%)</label>
            <input className="input" type="number" min="1" max="100" value={passingScore} onChange={e => setPassingScore(e.target.value)} />
          </div>
          <div className="input-wrapper" style={{ marginBottom: 0, gridColumn: topics.length > 0 ? undefined : "1/-1" }}>
            <label className="input-label">📂 Send announcement to topic (optional)</label>
            <select className="select" value={topicId} onChange={e => {
              const val = e.target.value ? Number(e.target.value) : "";
              setTopicId(val);
              setTopicName(val ? (topics.find(t => t.message_thread_id === val)?.name || "") : "");
            }}>
              <option value="">📌 General (no topic)</option>
              {topics.map(t => <option key={t.message_thread_id} value={t.message_thread_id}>📂 {t.name}</option>)}
            </select>
          </div>
        </div>

        <div>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
            <h5 style={{ margin: 0 }}>Questions ({questions.length})</h5>
            <button className="btn btn-secondary btn-sm" onClick={() => setQuestions(p => [...p, emptyQ()])}>+ Add Question</button>
          </div>
          {questions.map((q, qi) => (
            <div key={qi} style={{ background: "var(--clr-bg-elevated)", borderRadius: 8, padding: 12, marginBottom: 10, border: "1px solid var(--clr-border)" }}>
              <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 8 }}>
                <span style={{ fontSize: "0.8rem", fontWeight: 700, color: "var(--clr-text-muted)" }}>Q{qi + 1}</span>
                <div style={{ display: "flex", gap: 6 }}>
                  {qi > 0 && <button className="btn btn-ghost btn-sm" style={{ padding: "0 6px" }} title="Move up" onClick={() => setQuestions(p => { const a = [...p]; [a[qi-1], a[qi]] = [a[qi], a[qi-1]]; return a; })}>↑</button>}
                  {qi < questions.length - 1 && <button className="btn btn-ghost btn-sm" style={{ padding: "0 6px" }} title="Move down" onClick={() => setQuestions(p => { const a = [...p]; [a[qi], a[qi+1]] = [a[qi+1], a[qi]]; return a; })}>↓</button>}
                  {questions.length > 1 && <button className="btn btn-ghost btn-sm" style={{ color: "var(--clr-danger)", padding: "0 6px" }} onClick={() => setQuestions(p => p.filter((_, i) => i !== qi))}>✕</button>}
                </div>
              </div>
              <input className="input" style={{ marginBottom: 8, fontSize: "0.85rem" }} placeholder="Question text…" value={q.question} onChange={e => setQ(qi, "question", e.target.value)} />
              <div style={{ display: "flex", flexDirection: "column", gap: 6, marginBottom: 8 }}>
                {q.options.map((opt, oi) => (
                  <div key={oi} style={{ display: "flex", gap: 6, alignItems: "center" }}>
                    <input type="radio" name={`correct-${qi}`} checked={q.correctOptionId === oi} onChange={() => setQ(qi, "correctOptionId", oi)} style={{ flexShrink: 0 }} title="Mark as correct answer" />
                    <input className="input" style={{ flex: 1, fontSize: "0.82rem" }} placeholder={`Option ${String.fromCharCode(65 + oi)}`} value={opt} onChange={e => { const opts = [...q.options]; opts[oi] = e.target.value; setQ(qi, "options", opts); }} />
                    {q.options.length > 2 && (
                      <button
                        className="btn btn-ghost btn-sm"
                        style={{ color: "var(--clr-danger)", padding: "0 4px", flexShrink: 0 }}
                        onClick={() => {
                          const opts = q.options.filter((_, i) => i !== oi);
                          let newCorrect = q.correctOptionId;
                          if (q.correctOptionId === oi) {
                            newCorrect = 0;
                          } else if (q.correctOptionId > oi) {
                            newCorrect = q.correctOptionId - 1;
                          }
                          setQuestions(p => p.map((qq, idx) => idx === qi ? { ...qq, options: opts, correctOptionId: newCorrect } : qq));
                        }}
                      >
                        ✕
                      </button>
                    )}
                  </div>
                ))}
                {q.options.length < 10 && (
                  <button className="btn btn-ghost btn-sm" style={{ alignSelf: "flex-start" }} onClick={() => setQ(qi, "options", [...q.options, ""])}>+ Option</button>
                )}
              </div>
              <input className="input" style={{ fontSize: "0.8rem" }} placeholder="Explanation (optional — shown after answering)" value={q.explanation || ""} onChange={e => setQ(qi, "explanation", e.target.value)} />
            </div>
          ))}
        </div>

        <div style={{ display: "flex", gap: 10, marginTop: 4 }}>
          <button className="btn btn-primary" onClick={isEditing ? handleSaveEdit : handleCreate} disabled={saving}>
            {saving ? (isEditing ? "Saving…" : "Creating…") : (isEditing ? "💾 Save Changes" : "Create Exam")}
          </button>
          {isEditing && editingExam && !editingExam.isPublished && (
            <button className="btn btn-secondary" disabled={saving} onClick={async () => { await handleSaveEdit(); await handlePublish({ ...editingExam, title, passingScore: parseInt(passingScore) } as Exam); }}>
              💾 Save & Launch
            </button>
          )}
        </div>
      </div>
    </div>
  );

  // ── Exam list view ────────────────────────────────────────────────────────
  return (
    <div>
      {toast && <div className="toast-container"><div className={`toast toast-${toast.type}`}>{toast.msg}</div></div>}
      <div className="section-header animate-fade-up">
        <div><h1>Exams</h1><p>Telegram-native exam system · {exams.length} exam{exams.length !== 1 ? "s" : ""}</p></div>
        <button className="btn btn-primary" onClick={openCreate}>+ New Exam</button>
      </div>

      {loading ? (
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          {[1, 2].map(i => <div key={i} className="skeleton" style={{ height: 90, borderRadius: 12 }} />)}
        </div>
      ) : exams.length === 0 ? (
        <div className="empty-state animate-fade-up">
          <div className="empty-state-icon">📋</div>
          <h3>No exams yet</h3>
          <p>Create an exam — students take it via Telegram DM when they click the Start button</p>
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          {exams.map(exam => (
            <div key={exam.id} className="card animate-fade-up" style={{ padding: "var(--space-4)" }}>
              <div style={{ display: "flex", gap: 12, alignItems: "flex-start", flexWrap: "wrap" }}>
                <div style={{ flex: 1, minWidth: 150 }}>
                  <div style={{ fontWeight: 700, fontSize: "0.95rem", marginBottom: 6, display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                    {exam.title}
                    {exam.isPublished
                      ? <span className="badge badge-success" style={{ fontSize: "0.65rem" }}>✅ Live</span>
                      : <span className="badge badge-muted" style={{ fontSize: "0.65rem" }}>Draft</span>}
                  </div>
                  {exam.description && <p style={{ fontSize: "0.8rem", color: "var(--clr-text-muted)", margin: "0 0 6px" }}>{exam.description}</p>}
                  <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                    <span className="badge badge-muted" style={{ fontSize: "0.68rem" }}>📊 {(exam.questions as Question[]).length} questions</span>
                    {exam.timeLimit && <span className="badge badge-muted" style={{ fontSize: "0.68rem" }}>⏱ {Math.floor(exam.timeLimit / 60)}m</span>}
                    <span className="badge badge-muted" style={{ fontSize: "0.68rem" }}>✅ Pass: {exam.passingScore}%</span>
                    <span className="badge badge-brand" style={{ fontSize: "0.68rem" }}>👥 {exam._count.results} result{exam._count.results !== 1 ? "s" : ""}</span>
                    <span className="badge badge-muted" style={{ fontSize: "0.68rem" }}>🕐 {timeAgo(exam.createdAt)}</span>
                    {exam.createdBy && <span className="badge badge-muted" style={{ fontSize: "0.68rem" }}>👤 {exam.createdBy.firstName}</span>}
                  </div>
                </div>
                <div style={{ display: "flex", gap: 6, flexShrink: 0, flexWrap: "wrap" }}>
                  {exam._count.results > 0 && (
                    <button className="btn btn-secondary btn-sm" onClick={() => loadResults(exam)}>📊 Results</button>
                  )}
                  {!exam.isPublished && (
                    <button className="btn btn-ghost btn-sm" onClick={() => openEdit(exam)}>✏️ Edit</button>
                  )}
                  <button className="btn btn-primary btn-sm" onClick={() => handlePublish(exam)}>
                    {exam.isPublished ? "🔄 Re-send" : "🚀 Launch"}
                  </button>
                  <button className="btn btn-ghost btn-sm" style={{ color: "var(--clr-danger)" }} onClick={() => handleDelete(exam.id)}>
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/></svg>
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
