"use client";
import { useEffect, useState, useCallback } from "react";
import { useParams } from "next/navigation";

interface Question { question: string; options: string[]; correctOptionId: number; explanation?: string; }
interface Exam {
  id: string; title: string; description?: string;
  questions: Question[]; timeLimit: number | null; passingScore: number;
  isPublished: boolean; launchMsgId?: number | null; createdAt: string;
  _count: { results: number };
  createdBy?: { firstName: string; username?: string | null };
}
interface Result {
  id: string; name: string; telegramId?: string; score: number;
  passed: boolean; duration?: number; completedAt: string;
  answers?: Record<number, number>;
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
  const [viewResults, setViewResults] = useState<{ exam: Exam; results: Result[]; stats: { passCount: number; avgScore: number; totalResults: number } } | null>(null);
  const [editingExam, setEditingExam] = useState<Exam | null>(null);

  // Form state
  const [title, setTitle] = useState("");
  const [desc, setDesc] = useState("");
  const [timeLimit, setTimeLimit] = useState("");
  const [passingScore, setPassingScore] = useState("60");
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

  // Reset form
  const resetForm = () => { setTitle(""); setDesc(""); setTimeLimit(""); setPassingScore("60"); setQuestions([emptyQ()]); setEditingExam(null); };

  const openCreate = () => { resetForm(); setMode("create"); };

  const openEdit = (exam: Exam) => {
    setEditingExam(exam);
    setTitle(exam.title);
    setDesc(exam.description || "");
    setTimeLimit(exam.timeLimit ? String(Math.floor(exam.timeLimit / 60)) : "");
    setPassingScore(String(exam.passingScore));
    setQuestions((exam.questions as Question[]).map(q => ({ ...q, options: [...q.options] })));
    setMode("edit");
  };

  const validateQuestions = () => {
    const valid = questions.filter(q =>
      q.question.trim() && q.options.filter(o => o.trim()).length >= 2 &&
      q.correctOptionId >= 0 && q.correctOptionId < q.options.filter(o => o.trim()).length
    );
    return valid;
  };

  const handleCreate = async () => {
    if (!title.trim()) return showToast("error", "Title required");
    const validQ = validateQuestions();
    if (validQ.length === 0) return showToast("error", "Add at least 1 valid question");
    setSaving(true);
    const res = await fetch(`/api/groups/${groupId}/exams`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title, description: desc, questions: validQ, timeLimit: timeLimit ? parseInt(timeLimit) * 60 : null, passingScore: parseInt(passingScore) }),
    });
    const data = await res.json();
    setSaving(false);
    if (data.ok) { showToast("success", "Exam created!"); resetForm(); setMode("list"); load(); }
    else showToast("error", data.error || "Failed");
  };

  const handleSaveEdit = async () => {
    if (!editingExam) return;
    if (!title.trim()) return showToast("error", "Title required");
    const validQ = validateQuestions();
    if (validQ.length === 0) return showToast("error", "Add at least 1 valid question");
    setSaving(true);
    const res = await fetch(`/api/groups/${groupId}/exams`, {
      method: "PATCH", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: editingExam.id, title, description: desc, questions: validQ, timeLimit: timeLimit ? parseInt(timeLimit) * 60 : null, passingScore: parseInt(passingScore) }),
    });
    setSaving(false);
    if (res.ok) { showToast("success", "Saved!"); resetForm(); setMode("list"); load(); }
    else showToast("error", "Failed to save");
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
    const res = await fetch(`/api/groups/${groupId}/exams/${exam.id}/results`);
    if (!res.ok) return showToast("error", "Failed to load results");
    const data = await res.json();
    if (data.exam) { setViewResults({ exam, results: data.results || [], stats: data.exam }); setMode("results"); }
  };

  const setQ = (i: number, field: keyof Question, val: string | string[] | number) =>
    setQuestions(prev => prev.map((q, idx) => idx === i ? { ...q, [field]: val } : q));

  // ── Results view ──────────────────────────────────────────────────────────
  if (mode === "results" && viewResults) return (
    <div>
      {toast && <div className="toast-container"><div className={`toast toast-${toast.type}`}>{toast.msg}</div></div>}
      <div className="section-header animate-fade-up">
        <div><h1>{viewResults.exam.title} — Results</h1><p>{viewResults.stats.totalResults} submission{viewResults.stats.totalResults !== 1 ? "s" : ""}</p></div>
        <button className="btn btn-secondary" onClick={() => { setViewResults(null); setMode("list"); }}>← Back</button>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(120px,1fr))", gap: 12, marginBottom: 20 }}>
        {[
          { label: "Total", value: viewResults.stats.totalResults, color: "var(--clr-brand)" },
          { label: "Passed", value: viewResults.stats.passCount, color: "var(--clr-success)" },
          { label: "Failed", value: viewResults.stats.totalResults - viewResults.stats.passCount, color: "var(--clr-danger)" },
          { label: "Avg Score", value: `${viewResults.stats.avgScore}%`, color: "var(--clr-warning)" },
        ].map(s => (
          <div key={s.label} className="card" style={{ padding: "var(--space-3) var(--space-4)", textAlign: "center" }}>
            <div style={{ fontSize: "1.4rem", fontWeight: 800, color: s.color }}>{s.value}</div>
            <div style={{ fontSize: "0.72rem", color: "var(--clr-text-muted)", marginTop: 2 }}>{s.label}</div>
          </div>
        ))}
      </div>
      {viewResults.results.length === 0
        ? <div className="empty-state"><div className="empty-state-icon">📋</div><h3>No results yet</h3><p>Results appear here after students complete the exam in Telegram</p></div>
        : <div className="card" style={{ padding: 0, overflow: "hidden" }}>
            {viewResults.results.map((r, i) => (
              <div key={r.id} style={{ display: "flex", alignItems: "center", gap: 12, padding: "var(--space-3) var(--space-4)", borderBottom: i < viewResults.results.length - 1 ? "1px solid var(--clr-border)" : "none", flexWrap: "wrap" }}>
                <div style={{ width: 40, height: 40, borderRadius: "50%", background: r.passed ? "var(--clr-success-muted)" : "rgba(248,113,113,0.12)", display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 700, fontSize: "0.85rem", color: r.passed ? "var(--clr-success)" : "var(--clr-danger)", flexShrink: 0 }}>{r.score}%</div>
                <div style={{ flex: 1, minWidth: 100 }}>
                  <div style={{ fontWeight: 600, fontSize: "0.88rem" }}>{r.name}</div>
                  <div style={{ fontSize: "0.72rem", color: "var(--clr-text-muted)" }}>
                    {r.telegramId ? `@TG:${r.telegramId}` : ""}
                    {r.duration ? ` · ${Math.floor(r.duration / 60)}m ${r.duration % 60}s` : ""}
                    {" · "}{new Date(r.completedAt).toLocaleString()}
                  </div>
                </div>
                <span className={`badge ${r.passed ? "badge-success" : "badge-danger"}`}>{r.passed ? "✓ Passed" : "✗ Failed"}</span>
              </div>
            ))}
          </div>
      }
    </div>
  );

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
                    {q.options.length > 2 && <button className="btn btn-ghost btn-sm" style={{ color: "var(--clr-danger)", padding: "0 4px", flexShrink: 0 }} onClick={() => { const opts = q.options.filter((_, i) => i !== oi); const newCorrect = q.correctOptionId >= opts.length ? opts.length - 1 : q.correctOptionId; setQuestions(p => p.map((qq, idx) => idx === qi ? { ...qq, options: opts, correctOptionId: newCorrect } : qq)); }}>✕</button>}
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
