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
interface Result { id: string; name: string; telegramId?: string; score: number; passed: boolean; duration?: number; completedAt: string; }

const emptyQ = (): Question => ({ question: "", options: ["", "", "", ""], correctOptionId: 0 });

export default function ExamsPage() {
  const { groupId } = useParams() as { groupId: string };
  const [exams, setExams] = useState<Exam[]>([]);
  const [loading, setLoading] = useState(true);
  const [toast, setToast] = useState<{ type: string; msg: string } | null>(null);
  const [creating, setCreating] = useState(false);
  const [viewResults, setViewResults] = useState<{ exam: Exam; results: Result[]; stats: { passCount: number; avgScore: number; totalResults: number } } | null>(null);

  // Form state
  const [title, setTitle] = useState("");
  const [desc, setDesc] = useState("");
  const [timeLimit, setTimeLimit] = useState("");
  const [passingScore, setPassingScore] = useState("60");
  const [questions, setQuestions] = useState<Question[]>([emptyQ()]);
  const [saving, setSaving] = useState(false);

  const showToast = (type: string, msg: string) => { setToast({ type, msg }); setTimeout(() => setToast(null), 4000); };

  const load = useCallback(() => {
    setLoading(true);
    fetch(`/api/groups/${groupId}/exams`)
      .then(r => r.json()).then(d => { setExams(d.exams || []); setLoading(false); })
      .catch(() => setLoading(false));
  }, [groupId]);

  useEffect(() => { load(); }, [load]);

  const handleCreate = async () => {
    if (!title.trim()) return showToast("error", "Title required");
    const validQ = questions.filter(q => q.question.trim() && q.options.filter(o => o.trim()).length >= 2);
    if (validQ.length === 0) return showToast("error", "Add at least 1 valid question");
    setSaving(true);
    const res = await fetch(`/api/groups/${groupId}/exams`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title, description: desc, questions: validQ, timeLimit: timeLimit ? parseInt(timeLimit) * 60 : null, passingScore: parseInt(passingScore) }),
    });
    const data = await res.json();
    setSaving(false);
    if (data.ok) { showToast("success", "Exam created!"); setCreating(false); setTitle(""); setDesc(""); setQuestions([emptyQ()]); load(); }
    else showToast("error", data.error || "Failed");
  };

  const handlePublish = async (exam: Exam) => {
    if (!confirm(`Send exam "${exam.title}" to the Telegram group? Students will see a Start button.`)) return;
    const res = await fetch(`/api/groups/${groupId}/exams`, {
      method: "PATCH", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: exam.id, isPublished: true }),
    });
    if (res.ok) { showToast("success", "✅ Exam launched in Telegram!"); load(); }
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
    const data = await res.json();
    if (data.exam) setViewResults({ exam, results: data.results || [], stats: data.exam });
  };

  const setQ = (i: number, field: keyof Question, val: string | string[] | number) => {
    setQuestions(prev => prev.map((q, idx) => idx === i ? { ...q, [field]: val } : q));
  };

  if (viewResults) return (
    <div>
      {toast && <div className="toast-container"><div className={`toast toast-${toast.type}`}>{toast.msg}</div></div>}
      <div className="section-header animate-fade-up">
        <div><h1>{viewResults.exam.title} — Results</h1><p>{viewResults.stats.totalResults} submissions</p></div>
        <button className="btn btn-secondary" onClick={() => setViewResults(null)}>← Back</button>
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
                <div style={{ width: 36, height: 36, borderRadius: "50%", background: r.passed ? "var(--clr-success-muted)" : "rgba(248,113,113,0.12)", display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 700, fontSize: "0.85rem", color: r.passed ? "var(--clr-success)" : "var(--clr-danger)", flexShrink: 0 }}>{r.score}%</div>
                <div style={{ flex: 1, minWidth: 100 }}>
                  <div style={{ fontWeight: 600, fontSize: "0.88rem" }}>{r.name}</div>
                  <div style={{ fontSize: "0.72rem", color: "var(--clr-text-muted)" }}>{r.telegramId ? `TG: ${r.telegramId}` : ""} · {new Date(r.completedAt).toLocaleString()}{r.duration ? ` · ${Math.floor(r.duration / 60)}m ${r.duration % 60}s` : ""}</div>
                </div>
                <span className={`badge ${r.passed ? "badge-success" : "badge-danger"}`}>{r.passed ? "✓ Passed" : "✗ Failed"}</span>
              </div>
            ))}
          </div>
      }
    </div>
  );

  return (
    <div>
      {toast && <div className="toast-container"><div className={`toast toast-${toast.type}`}>{toast.msg}</div></div>}
      <div className="section-header animate-fade-up">
        <div><h1>Exams</h1><p>Telegram-native exam system</p></div>
        <button className="btn btn-primary" onClick={() => setCreating(c => !c)}>
          {creating ? "✕ Cancel" : "+ New Exam"}
        </button>
      </div>

      {/* Create form */}
      {creating && (
        <div className="card animate-fade-up" style={{ marginBottom: 20 }}>
          <h4 style={{ marginBottom: 16 }}>Create New Exam</h4>
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

          <div style={{ marginBottom: 12 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
              <h5 style={{ margin: 0 }}>Questions ({questions.length})</h5>
              <button className="btn btn-secondary btn-sm" onClick={() => setQuestions(p => [...p, emptyQ()])}>+ Add Question</button>
            </div>
            {questions.map((q, qi) => (
              <div key={qi} style={{ background: "var(--clr-bg-elevated)", borderRadius: 8, padding: 12, marginBottom: 10, border: "1px solid var(--clr-border)" }}>
                <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 8 }}>
                  <span style={{ fontSize: "0.8rem", fontWeight: 700, color: "var(--clr-text-muted)" }}>Q{qi + 1}</span>
                  {questions.length > 1 && <button className="btn btn-ghost btn-sm" style={{ color: "var(--clr-danger)", padding: "0 6px" }} onClick={() => setQuestions(p => p.filter((_, i) => i !== qi))}>✕</button>}
                </div>
                <input className="input" style={{ marginBottom: 8, fontSize: "0.85rem" }} placeholder="Question text…" value={q.question} onChange={e => setQ(qi, "question", e.target.value)} />
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6, marginBottom: 8 }}>
                  {q.options.map((opt, oi) => (
                    <div key={oi} style={{ display: "flex", gap: 4, alignItems: "center" }}>
                      <input type="radio" name={`correct-${qi}`} checked={q.correctOptionId === oi} onChange={() => setQ(qi, "correctOptionId", oi)} style={{ flexShrink: 0 }} />
                      <input className="input" style={{ fontSize: "0.82rem" }} placeholder={`Option ${String.fromCharCode(65 + oi)}`} value={opt} onChange={e => { const opts = [...q.options]; opts[oi] = e.target.value; setQ(qi, "options", opts); }} />
                    </div>
                  ))}
                </div>
                <input className="input" style={{ fontSize: "0.8rem" }} placeholder="Explanation (optional)" value={q.explanation || ""} onChange={e => setQ(qi, "explanation", e.target.value)} />
              </div>
            ))}
          </div>

          <button className="btn btn-primary" onClick={handleCreate} disabled={saving}>{saving ? "Creating…" : "Create Exam"}</button>
        </div>
      )}

      {/* Exam list */}
      {loading ? (
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          {[1,2].map(i => <div key={i} className="skeleton" style={{ height: 90, borderRadius: 12 }} />)}
        </div>
      ) : exams.length === 0 ? (
        <div className="empty-state animate-fade-up">
          <div className="empty-state-icon">📋</div>
          <h3>No exams yet</h3>
          <p>Create an exam above — students take it via Telegram DM when they click the Start button</p>
        </div>
      ) : (
        <div className="card animate-fade-up" style={{ padding: 0, overflow: "hidden" }}>
          {exams.map((exam, idx) => (
            <div key={exam.id} style={{ padding: "var(--space-4)", borderBottom: idx < exams.length - 1 ? "1px solid var(--clr-border)" : "none", display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
              <div style={{ flex: 1, minWidth: 150 }}>
                <div style={{ fontWeight: 700, fontSize: "0.95rem", marginBottom: 4, display: "flex", alignItems: "center", gap: 8 }}>
                  {exam.title}
                  {exam.isPublished
                    ? <span className="badge badge-success" style={{ fontSize: "0.65rem" }}>✅ Live</span>
                    : <span className="badge badge-muted" style={{ fontSize: "0.65rem" }}>Draft</span>}
                </div>
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                  <span className="badge badge-muted" style={{ fontSize: "0.68rem" }}>📊 {(exam.questions as Question[]).length} questions</span>
                  {exam.timeLimit && <span className="badge badge-muted" style={{ fontSize: "0.68rem" }}>⏱ {Math.floor(exam.timeLimit/60)}m</span>}
                  <span className="badge badge-muted" style={{ fontSize: "0.68rem" }}>✅ Pass: {exam.passingScore}%</span>
                  <span className="badge badge-brand" style={{ fontSize: "0.68rem" }}>👥 {exam._count.results} results</span>
                </div>
              </div>
              <div style={{ display: "flex", gap: 6, flexShrink: 0, flexWrap: "wrap" }}>
                {exam._count.results > 0 && (
                  <button className="btn btn-secondary btn-sm" onClick={() => loadResults(exam)}>📊 Results</button>
                )}
                {!exam.isPublished && (
                  <button className="btn btn-primary btn-sm" onClick={() => handlePublish(exam)}>🚀 Launch</button>
                )}
                <button className="btn btn-ghost btn-sm" style={{ color: "var(--clr-danger)" }} onClick={() => handleDelete(exam.id)}>
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/></svg>
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
