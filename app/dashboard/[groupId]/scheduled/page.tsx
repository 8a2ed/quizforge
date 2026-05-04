"use client";
import { useEffect, useState, useCallback } from "react";
import { useParams } from "next/navigation";

interface ScheduledQuiz {
  id: string;
  question: string;
  options: string[];
  type: string;
  isAnonymous: boolean;
  topicName: string | null;
  scheduledAt: string;
  recurrence: string | null;
  tags: string[];
}

const RECURRENCE_LABELS: Record<string, string> = { daily: "🔁 Daily", weekly: "📅 Weekly", biweekly: "📆 Biweekly", monthly: "🗓 Monthly" };

export default function ScheduledPage() {
  const { groupId } = useParams() as { groupId: string };
  const [quizzes, setQuizzes] = useState<ScheduledQuiz[]>([]);
  const [loading, setLoading] = useState(true);
  const [toast, setToast] = useState<{ type: string; msg: string } | null>(null);
  const [editId, setEditId] = useState<string | null>(null);
  const [editTime, setEditTime] = useState("");

  const showToast = (type: string, msg: string) => { setToast({ type, msg }); setTimeout(() => setToast(null), 3500); };

  const load = useCallback(() => {
    setLoading(true);
    fetch(`/api/groups/${groupId}/scheduled`)
      .then(r => r.json()).then(d => { setQuizzes(d.quizzes || []); setLoading(false); })
      .catch(() => setLoading(false));
  }, [groupId]);

  useEffect(() => { load(); }, [load]);

  const handleCancel = async (id: string) => {
    if (!confirm("Cancel this scheduled quiz?")) return;
    const res = await fetch(`/api/groups/${groupId}/scheduled`, { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id }) });
    if (res.ok) { showToast("success", "Scheduled quiz cancelled"); setQuizzes(p => p.filter(q => q.id !== id)); }
    else showToast("error", "Failed to cancel");
  };

  const handleReschedule = async (id: string) => {
    if (!editTime) return;
    const res = await fetch(`/api/groups/${groupId}/scheduled`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id, scheduledAt: new Date(editTime).toISOString() }) });
    if (res.ok) { showToast("success", "Rescheduled"); setEditId(null); load(); }
    else showToast("error", "Failed to reschedule");
  };

  const fmt = (iso: string) => {
    const d = new Date(iso);
    const now = new Date();
    const diff = d.getTime() - now.getTime();
    if (diff < 0) return { label: "Overdue", color: "#f87171" };
    const mins = Math.round(diff / 60000);
    if (mins < 60) return { label: `in ${mins}m`, color: "#fbbf24" };
    const hrs = Math.round(diff / 3600000);
    if (hrs < 24) return { label: `in ${hrs}h`, color: "#4f7fff" };
    return { label: d.toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }), color: "var(--clr-text-muted)" };
  };

  return (
    <div>
      {toast && <div className="toast-container"><div className={`toast toast-${toast.type}`}>{toast.msg}</div></div>}

      <div className="section-header animate-fade-up">
        <div><h1>Scheduled Quizzes</h1><p>{quizzes.length} pending</p></div>
        <button className="btn btn-secondary" onClick={load} disabled={loading}>↻ Refresh</button>
      </div>

      {loading ? (
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          {[1,2,3].map(i => <div key={i} className="skeleton" style={{ height: 80, borderRadius: 12 }} />)}
        </div>
      ) : quizzes.length === 0 ? (
        <div className="empty-state animate-fade-up">
          <div className="empty-state-icon">🗓</div>
          <h3>No scheduled quizzes</h3>
          <p>Schedule a quiz from the Create page to see it here</p>
        </div>
      ) : (
        <div className="card animate-fade-up animate-delay-1" style={{ padding: 0, overflow: "hidden" }}>
          {quizzes.map((q, idx) => {
            const { label, color } = fmt(q.scheduledAt);
            return (
              <div key={q.id} style={{ padding: "var(--space-4)", borderBottom: idx < quizzes.length - 1 ? "1px solid var(--clr-border)" : "none" }}>
                <div style={{ display: "flex", gap: "var(--space-3)", alignItems: "flex-start", flexWrap: "wrap" }}>
                  {/* Time badge */}
                  <div style={{ textAlign: "center", flexShrink: 0, minWidth: 70 }}>
                    <div style={{ fontSize: "0.72rem", fontWeight: 700, color, background: `${color}18`, border: `1px solid ${color}40`, borderRadius: 8, padding: "3px 8px" }}>{label}</div>
                    {q.recurrence && <div style={{ fontSize: "0.65rem", color: "var(--clr-text-muted)", marginTop: 3 }}>{RECURRENCE_LABELS[q.recurrence] || q.recurrence}</div>}
                  </div>

                  {/* Content */}
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontWeight: 600, fontSize: "0.9rem", marginBottom: 4, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{q.question}</div>
                    <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                      <span className={`badge ${q.type === "QUIZ" ? "badge-brand" : "badge-accent"}`} style={{ fontSize: "0.68rem" }}>{q.type === "QUIZ" ? "🎯 Quiz" : "📊 Poll"}</span>
                      {q.topicName && <span className="badge badge-muted" style={{ fontSize: "0.68rem" }}>📂 {q.topicName}</span>}
                      {q.isAnonymous && <span className="badge badge-muted" style={{ fontSize: "0.68rem" }}>👤 Anon</span>}
                      <span className="badge badge-muted" style={{ fontSize: "0.68rem" }}>{q.options.length} options</span>
                    </div>
                    {/* Reschedule input */}
                    {editId === q.id && (
                      <div style={{ marginTop: 10, display: "flex", gap: 8, flexWrap: "wrap" }}>
                        <input type="datetime-local" className="input" style={{ flex: 1, minWidth: 180, fontSize: "0.82rem" }}
                          value={editTime} onChange={e => setEditTime(e.target.value)} />
                        <button className="btn btn-primary btn-sm" onClick={() => handleReschedule(q.id)}>Save</button>
                        <button className="btn btn-secondary btn-sm" onClick={() => setEditId(null)}>Cancel</button>
                      </div>
                    )}
                  </div>

                  {/* Actions */}
                  <div style={{ display: "flex", gap: 6, flexShrink: 0 }}>
                    <button className="btn btn-secondary btn-sm" title="Reschedule"
                      onClick={() => { setEditId(editId === q.id ? null : q.id); setEditTime(q.scheduledAt.slice(0, 16)); }}>
                      ✏️
                    </button>
                    <button className="btn btn-ghost btn-sm" style={{ color: "var(--clr-danger)" }} title="Cancel" onClick={() => handleCancel(q.id)}>
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/></svg>
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      <div className="card animate-fade-up animate-delay-2" style={{ marginTop: "var(--space-5)", background: "var(--clr-brand-muted)", borderColor: "rgba(79,127,255,0.2)", padding: "var(--space-3) var(--space-4)" }}>
        <div style={{ display: "flex", gap: 10, alignItems: "flex-start" }}>
          <span>⏰</span>
          <div style={{ fontSize: "0.82rem", color: "var(--clr-text-secondary)", lineHeight: 1.7 }}>
            <strong>How scheduling works:</strong> The cron job checks every minute for due quizzes and sends them automatically. Make sure <code style={{ background: "var(--clr-bg-hover)", padding: "1px 5px", borderRadius: 4 }}>CRON_SECRET</code> is set and the cron is running via PM2.
          </div>
        </div>
      </div>
    </div>
  );
}
