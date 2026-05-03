"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { useParams } from "next/navigation";

interface Template {
  id: string;
  question: string;
  options: string[];
  type: "QUIZ" | "POLL";
  isAnonymous: boolean;
  correctOptionId: number | null;
  explanation: string | null;
  allowsMultiple: boolean;
  openPeriod: number | null;
  tags?: string[];
  createdAt: string;
}

interface Topic { message_thread_id: number; name: string; }

interface SendProgress {
  active: boolean;
  total: number;
  sent: number;
  failed: number;
  errors: { id: string; question: string; msg: string }[];
  startTime: number;
}

const DELAY_MS = 3200; // 3.2s between sends to respect Telegram rate limits

export default function LibraryPage() {
  const { groupId } = useParams() as { groupId: string };

  const [templates, setTemplates] = useState<Template[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [sentIds, setSentIds] = useState<Set<string>>(new Set());
  const [showSent, setShowSent] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState<Partial<Template>>({});
  const [topics, setTopics] = useState<Topic[]>([]);
  const [sendTopicId, setSendTopicId] = useState<number | "">("");
  const [search, setSearch] = useState("");
  const [toast, setToast] = useState<{ type: "success" | "error"; msg: string } | null>(null);
  const [progress, setProgress] = useState<SendProgress | null>(null);
  const cancelRef = useRef(false);

  const showToast = (type: "success" | "error", msg: string) => {
    setToast({ type, msg });
    setTimeout(() => setToast(null), 4500);
  };

  const load = useCallback(() => {
    setLoading(true);
    fetch("/api/templates")
      .then(r => r.json())
      .then(d => { setTemplates(d.templates || []); setLoading(false); })
      .catch(() => setLoading(false));
  }, []);

  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    fetch(`/api/groups/${groupId}/topics`).then(r => r.json()).then(d => setTopics(d.topics || [])).catch(() => {});
  }, [groupId]);

  // ── Derived state ─────────────────────────────────────────────────
  const topicName = topics.find(t => t.message_thread_id === sendTopicId)?.name;

  const filtered = templates.filter(t => {
    if (!showSent && sentIds.has(t.id)) return false;
    if (!search) return true;
    return t.question.toLowerCase().includes(search.toLowerCase()) ||
      t.tags?.some(tag => tag.toLowerCase().includes(search.toLowerCase()));
  });

  const visibleSelected = [...selected].filter(id => filtered.some(t => t.id === id));

  // ── Selection ─────────────────────────────────────────────────────
  const toggleSelect = (id: string) =>
    setSelected(prev => { const s = new Set(prev); s.has(id) ? s.delete(id) : s.add(id); return s; });
  const selectAll = () => setSelected(new Set(filtered.map(t => t.id)));
  const selectNone = () => setSelected(new Set());

  // ── Sequential sender ─────────────────────────────────────────────
  const sendSequentially = async (toSend: Template[]) => {
    if (toSend.length === 0) return;
    cancelRef.current = false;

    setProgress({ active: true, total: toSend.length, sent: 0, failed: 0, errors: [], startTime: Date.now() });

    for (let i = 0; i < toSend.length; i++) {
      if (cancelRef.current) break;

      const t = toSend[i];
      try {
        const res = await fetch(`/api/groups/${groupId}/quiz/send`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            question: t.question,
            options: t.options,
            type: t.type === "QUIZ" ? "quiz" : "poll",
            correctOptionId: t.correctOptionId,
            explanation: t.explanation,
            isAnonymous: t.isAnonymous,
            allowsMultiple: t.allowsMultiple,
            openPeriod: t.openPeriod,
            tags: t.tags,
            topicId: sendTopicId || undefined,
            topicName: topicName || undefined,
          }),
        });

        if (res.ok) {
          setSentIds(prev => new Set([...prev, t.id]));
          setSelected(prev => { const s = new Set(prev); s.delete(t.id); return s; });
          setProgress(prev => prev ? { ...prev, sent: prev.sent + 1 } : prev);
        } else {
          const data = await res.json();
          setProgress(prev => prev ? {
            ...prev,
            failed: prev.failed + 1,
            errors: [...prev.errors, { id: t.id, question: t.question.slice(0, 60), msg: data.error || "Unknown error" }],
          } : prev);
        }
      } catch {
        setProgress(prev => prev ? {
          ...prev,
          failed: prev.failed + 1,
          errors: [...prev.errors, { id: t.id, question: t.question.slice(0, 60), msg: "Network error" }],
        } : prev);
      }

      // Rate-limit delay between sends
      if (i < toSend.length - 1 && !cancelRef.current) {
        await new Promise(r => setTimeout(r, DELAY_MS));
      }
    }

    setProgress(prev => prev ? { ...prev, active: false } : prev);
  };

  const handleSendSelected = () => {
    const toSend = templates.filter(t => selected.has(t.id));
    sendSequentially(toSend);
  };

  const handleSendOne = (t: Template) => {
    sendSequentially([t]);
  };

  // ── Delete ─────────────────────────────────────────────────────────
  const deleteOne = async (id: string) => {
    if (!confirm("Delete this template?")) return;
    await fetch(`/api/templates/${id}`, { method: "DELETE" });
    setTemplates(prev => prev.filter(t => t.id !== id));
    setSelected(prev => { const s = new Set(prev); s.delete(id); return s; });
    showToast("success", "Deleted");
  };

  const deleteSelected = async () => {
    if (!confirm(`Delete ${visibleSelected.length} template(s)?`)) return;
    await Promise.all(visibleSelected.map(id => fetch(`/api/templates/${id}`, { method: "DELETE" })));
    setTemplates(prev => prev.filter(t => !visibleSelected.includes(t.id)));
    setSelected(new Set());
    showToast("success", `Deleted ${visibleSelected.length} templates`);
  };

  // ── Edit ───────────────────────────────────────────────────────────
  const startEdit = (t: Template) => { setEditingId(t.id); setEditDraft({ ...t }); };
  const cancelEdit = () => setEditingId(null);

  const saveEdit = async () => {
    if (!editingId) return;
    const res = await fetch(`/api/templates/${editingId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(editDraft),
    });
    if (res.ok) {
      showToast("success", "Saved");
      setEditingId(null);
      load();
    } else showToast("error", "Failed to save");
  };

  const updateOpt = (i: number, v: string) => {
    const o = [...(editDraft.options || [])]; o[i] = v;
    setEditDraft(d => ({ ...d, options: o }));
  };

  // ── Progress helpers ───────────────────────────────────────────────
  const pct = progress ? Math.round(((progress.sent + progress.failed) / progress.total) * 100) : 0;
  const elapsed = progress ? Math.floor((Date.now() - progress.startTime) / 1000) : 0;
  const perQuiz = elapsed > 0 && progress ? elapsed / (progress.sent + progress.failed || 1) : DELAY_MS / 1000;
  const remaining = progress ? Math.max(0, Math.round((progress.total - progress.sent - progress.failed) * perQuiz)) : 0;

  const fmtTime = (s: number) => s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${s % 60}s`;

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
          <h1>Question Library</h1>
          <p style={{ marginTop: 4 }}>
            {templates.length} template{templates.length !== 1 ? "s" : ""}
            {sentIds.size > 0 && <span style={{ color: "var(--clr-success)", marginLeft: 10 }}>· {sentIds.size} sent this session</span>}
          </p>
        </div>
        {visibleSelected.length > 0 && !progress?.active && (
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <button className="btn btn-ghost" style={{ color: "var(--clr-danger)" }} onClick={deleteSelected}>
              🗑 Delete {visibleSelected.length}
            </button>
            <button className="btn btn-primary" onClick={handleSendSelected}>
              🚀 Send {visibleSelected.length} Selected
            </button>
          </div>
        )}
      </div>

      {/* Progress Panel */}
      {progress && (
        <div className="card animate-fade-up" style={{
          marginBottom: "var(--space-5)",
          border: `1px solid ${progress.active ? "var(--clr-brand)" : progress.failed > 0 ? "var(--clr-warning)" : "var(--clr-success)"}`,
          background: "var(--clr-bg-card)",
        }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12, flexWrap: "wrap", gap: 8 }}>
            <div>
              <div style={{ fontWeight: 700, fontSize: "1rem" }}>
                {progress.active ? "📡 Broadcasting…" : progress.failed > 0 ? "⚠️ Completed with errors" : "✅ All sent!"}
              </div>
              <div style={{ fontSize: "0.82rem", color: "var(--clr-text-muted)", marginTop: 4 }}>
                {progress.sent} sent · {progress.failed} failed · {progress.total - progress.sent - progress.failed} remaining
                {progress.active && <span style={{ marginLeft: 8 }}>· ETA {fmtTime(remaining)}</span>}
              </div>
            </div>
            <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <span style={{ fontWeight: 700, fontSize: "1.2rem", color: "var(--clr-brand)" }}>{pct}%</span>
              {progress.active && (
                <button className="btn btn-ghost btn-sm" style={{ color: "var(--clr-danger)" }}
                  onClick={() => { cancelRef.current = true; setProgress(p => p ? { ...p, active: false } : p); }}>
                  Cancel
                </button>
              )}
              {!progress.active && (
                <button className="btn btn-ghost btn-sm" onClick={() => setProgress(null)}>Dismiss</button>
              )}
            </div>
          </div>

          {/* Progress bar */}
          <div style={{ height: 8, borderRadius: "var(--radius-full)", background: "var(--clr-bg-elevated)", overflow: "hidden", marginBottom: 10 }}>
            <div style={{
              height: "100%", borderRadius: "var(--radius-full)",
              width: `${pct}%`,
              background: progress.failed > 0 ? "linear-gradient(90deg, var(--clr-success) 0%, var(--clr-warning) 100%)" : "var(--grad-brand)",
              transition: "width 0.5s var(--ease-out)",
            }} />
          </div>

          {/* Per-quiz progress */}
          <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
            {Array.from({ length: progress.total }, (_, i) => {
              const sentArr = [...sentIds];
              const errIds = progress.errors.map(e => e.id);
              const allProcessedIds = [...sentArr, ...errIds];
              const isErr = i < progress.failed + progress.sent && errIds.length > 0 && i >= progress.sent;
              const isDone = i < progress.sent;
              const isFailed = progress.errors.length > 0 && i >= progress.sent && i < progress.sent + progress.failed;
              return (
                <div key={i} style={{
                  width: 10, height: 10, borderRadius: "var(--radius-full)",
                  background: isDone ? "var(--clr-success)" : isFailed ? "var(--clr-danger)" :
                    progress.active && i === progress.sent + progress.failed ? "var(--clr-brand)" : "var(--clr-bg-hover)",
                  transition: "background 0.3s",
                }} />
              );
            })}
          </div>

          {/* Errors */}
          {progress.errors.length > 0 && (
            <div style={{ marginTop: 12, padding: "var(--space-3)", background: "var(--clr-danger-muted)", borderRadius: "var(--radius-md)" }}>
              <div style={{ fontSize: "0.8rem", fontWeight: 600, color: "var(--clr-danger)", marginBottom: 6 }}>Failed:</div>
              {progress.errors.map((e, i) => (
                <div key={i} style={{ fontSize: "0.78rem", color: "var(--clr-danger)", marginBottom: 2 }}>
                  • {e.question} — {e.msg}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Controls */}
      <div className="card animate-fade-up animate-delay-1" style={{ marginBottom: "var(--space-5)", padding: "var(--space-4)" }}>
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
          {/* Search */}
          <div style={{ position: "relative", flex: "1 1 180px", minWidth: 0 }}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
              style={{ position: "absolute", left: 10, top: "50%", transform: "translateY(-50%)", color: "var(--clr-text-muted)", pointerEvents: "none" }}>
              <circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/>
            </svg>
            <input className="input" style={{ paddingLeft: 32 }} placeholder="Search…"
              value={search} onChange={e => setSearch(e.target.value)} />
          </div>

          {/* Topic */}
          <select className="select" style={{ flex: "0 1 180px", minWidth: 0 }}
            value={sendTopicId} onChange={e => setSendTopicId(e.target.value ? Number(e.target.value) : "")}>
            <option value="">📌 General</option>
            {topics.map(t => <option key={t.message_thread_id} value={t.message_thread_id}>{t.name}</option>)}
          </select>

          {/* Selection */}
          <div style={{ display: "flex", gap: 6 }}>
            <button className="btn btn-ghost btn-sm" onClick={filtered.length === selected.size ? selectNone : selectAll}>
              {filtered.length > 0 && [...selected].filter(id => filtered.some(t => t.id === id)).length === filtered.length ? "Deselect All" : "Select All"}
            </button>
          </div>

          {/* Show sent toggle */}
          <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: "0.84rem", cursor: "pointer", whiteSpace: "nowrap" }}>
            <div className="toggle-switch" style={{ transform: "scale(0.85)" }}>
              <input type="checkbox" checked={showSent} onChange={e => setShowSent(e.target.checked)} />
              <span className="toggle-slider" />
            </div>
            Show sent ({sentIds.size})
          </label>
        </div>
      </div>

      {/* List */}
      {loading ? (
        <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-3)" }}>
          {[1,2,3].map(i => <div key={i} className="skeleton" style={{ height: 110, borderRadius: "var(--radius-md)" }} />)}
        </div>
      ) : filtered.length === 0 ? (
        <div className="empty-state">
          <div className="empty-state-icon">📚</div>
          <h3>{search ? "No matches" : sentIds.size === templates.length && !showSent ? "All sent!" : "Library is empty"}</h3>
          <p>{search ? `No templates match "${search}"` : sentIds.size === templates.length && !showSent ? "Toggle 'Show sent' to review sent quizzes" : "Use Bulk Import to save quizzes to your library"}</p>
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-3)" }}>
          {filtered.map((t, idx) => {
            const isSent = sentIds.has(t.id);
            const isSelected = selected.has(t.id);
            const isEditing = editingId === t.id;

            return (
              <div
                key={t.id}
                className="card"
                style={{
                  padding: "var(--space-4)",
                  border: `1px solid ${isSent ? "var(--clr-success)" : isSelected ? "var(--clr-brand)" : "var(--clr-border)"}`,
                  background: isSent ? "rgba(52,211,153,0.04)" : isSelected ? "var(--clr-brand-muted)" : "var(--clr-bg-card)",
                  transition: "all 0.15s",
                  cursor: isEditing ? "default" : "pointer",
                  opacity: isSent ? 0.75 : 1,
                }}
                onClick={() => !isEditing && toggleSelect(t.id)}
              >
                {/* Header row */}
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 8, marginBottom: 10, flexWrap: "wrap" }}>
                  <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                    {/* Checkbox */}
                    <div onClick={e => { e.stopPropagation(); toggleSelect(t.id); }}
                      style={{ width: 16, height: 16, borderRadius: 3, flexShrink: 0, border: `2px solid ${isSelected ? "var(--clr-brand)" : "var(--clr-border)"}`, background: isSelected ? "var(--clr-brand)" : "transparent", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer" }}>
                      {isSelected && <svg width="9" height="9" viewBox="0 0 12 12" fill="none"><path d="M2 6l3 3 5-5" stroke="white" strokeWidth="2.5" strokeLinecap="round"/></svg>}
                    </div>
                    <span className={`badge ${t.type === "QUIZ" ? "badge-brand" : "badge-accent"}`} style={{ fontSize: "0.7rem" }}>{t.type}</span>
                    <span style={{ fontSize: "0.75rem", color: "var(--clr-text-muted)" }}>#{idx + 1}</span>
                    {isSent && <span className="badge" style={{ background: "var(--clr-success-muted)", color: "var(--clr-success)", fontSize: "0.7rem" }}>✓ Sent</span>}
                    {t.tags?.map(tag => <span key={tag} className="badge badge-muted" style={{ fontSize: "0.68rem" }}>#{tag}</span>)}
                  </div>
                  <div style={{ display: "flex", gap: 4 }} onClick={e => e.stopPropagation()}>
                    {!isEditing && !isSent && (
                      <>
                        <button className="btn btn-ghost btn-sm" style={{ fontSize: "0.78rem" }} onClick={() => startEdit(t)}>✏️</button>
                        <button className="btn btn-ghost btn-sm" style={{ color: "var(--clr-success)", fontSize: "0.78rem" }}
                          onClick={() => handleSendOne(t)} disabled={!!progress?.active}>🚀</button>
                        <button className="btn btn-ghost btn-sm" style={{ color: "var(--clr-danger)", fontSize: "0.78rem" }} onClick={() => deleteOne(t.id)}>🗑</button>
                      </>
                    )}
                    {!isEditing && isSent && (
                      <button className="btn btn-ghost btn-sm" style={{ color: "var(--clr-danger)", fontSize: "0.78rem" }} onClick={() => deleteOne(t.id)}>🗑</button>
                    )}
                    {isEditing && (
                      <>
                        <button className="btn btn-primary btn-sm" onClick={saveEdit}>Save</button>
                        <button className="btn btn-ghost btn-sm" onClick={cancelEdit}>Cancel</button>
                      </>
                    )}
                  </div>
                </div>

                {/* Edit mode */}
                {isEditing ? (
                  <div style={{ display: "flex", flexDirection: "column", gap: 10 }} onClick={e => e.stopPropagation()}>
                    <textarea className="input" rows={2} value={editDraft.question || ""} onChange={e => setEditDraft(d => ({ ...d, question: e.target.value }))} />
                    <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
                      {(editDraft.options || []).map((opt, i) => (
                        <div key={i} style={{ display: "flex", gap: 6, alignItems: "center" }}>
                          <input type="radio" name={`e-${t.id}`} checked={editDraft.correctOptionId === i}
                            onChange={() => setEditDraft(d => ({ ...d, correctOptionId: i, type: "QUIZ" }))} />
                          <input className="input" value={opt} style={{ flex: 1 }} onChange={e => updateOpt(i, e.target.value)} />
                          {(editDraft.options || []).length > 2 && (
                            <button className="btn btn-ghost btn-sm" style={{ color: "var(--clr-danger)", padding: "0 6px" }}
                              onClick={() => setEditDraft(d => ({ ...d, options: (d.options || []).filter((_, j) => j !== i) }))}>✕</button>
                          )}
                        </div>
                      ))}
                      {(editDraft.options || []).length < 10 && (
                        <button className="btn btn-ghost btn-sm" style={{ alignSelf: "flex-start" }}
                          onClick={() => setEditDraft(d => ({ ...d, options: [...(d.options || []), ""] }))}>+ Option</button>
                      )}
                    </div>
                    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(140px,1fr))", gap: 8 }}>
                      <div><label className="input-label">Type</label>
                        <select className="select" value={editDraft.type} onChange={e => setEditDraft(d => ({ ...d, type: e.target.value as "QUIZ"|"POLL" }))}>
                          <option value="QUIZ">Quiz</option><option value="POLL">Poll</option>
                        </select>
                      </div>
                      <div><label className="input-label">Tags</label>
                        <input className="input" placeholder="math, easy" value={(editDraft.tags || []).join(", ")}
                          onChange={e => setEditDraft(d => ({ ...d, tags: e.target.value.split(",").map(t => t.trim()).filter(Boolean) }))} />
                      </div>
                    </div>
                    <input className="input" placeholder="Explanation (optional)" value={editDraft.explanation || ""}
                      onChange={e => setEditDraft(d => ({ ...d, explanation: e.target.value }))} />
                  </div>
                ) : (
                  /* View mode */
                  <>
                    <div style={{ fontWeight: 500, marginBottom: 8, lineHeight: 1.45, wordBreak: "break-word", fontSize: "0.9rem" }}>{t.question}</div>
                    <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                      {t.options.map((o, i) => (
                        <div key={i} style={{
                          padding: "4px 10px", borderRadius: "var(--radius-sm)", fontSize: "0.82rem",
                          background: t.correctOptionId === i ? "var(--clr-success-muted)" : "rgba(255,255,255,0.02)",
                          border: `1px solid ${t.correctOptionId === i ? "var(--clr-success)" : "transparent"}`,
                          color: t.correctOptionId === i ? "var(--clr-success)" : "var(--clr-text-secondary)",
                        }}>
                          <b>{String.fromCharCode(65 + i)}.</b> {o}
                        </div>
                      ))}
                    </div>
                    {t.explanation && (
                      <div style={{ marginTop: 8, fontSize: "0.76rem", color: "var(--clr-text-muted)", padding: "5px 10px", background: "rgba(0,0,0,0.2)", borderRadius: 6 }}>
                        💡 {t.explanation}
                      </div>
                    )}
                    <div style={{ marginTop: 8, display: "flex", gap: 10, flexWrap: "wrap", fontSize: "0.72rem", color: "var(--clr-text-muted)" }}>
                      {t.isAnonymous && <span>🔒 Anonymous</span>}
                      {t.openPeriod ? <span>⏱ {t.openPeriod}s</span> : null}
                      {t.allowsMultiple && <span>☑ Multi</span>}
                      <span style={{ marginLeft: "auto" }}>{new Date(t.createdAt).toLocaleDateString()}</span>
                    </div>
                  </>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
