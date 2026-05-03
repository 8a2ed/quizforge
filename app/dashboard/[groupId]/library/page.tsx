"use client";

import { useState, useEffect, useCallback } from "react";
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

export default function LibraryPage() {
  const { groupId } = useParams() as { groupId: string };

  const [templates, setTemplates] = useState<Template[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState<Partial<Template>>({});
  const [topics, setTopics] = useState<Topic[]>([]);
  const [sendTopicId, setSendTopicId] = useState<number | "">("");
  const [sending, setSending] = useState(false);
  const [toast, setToast] = useState<{ type: "success" | "error"; msg: string } | null>(null);
  const [search, setSearch] = useState("");
  const [deleting, setDeleting] = useState<string | null>(null);

  const showToast = (type: "success" | "error", msg: string) => {
    setToast({ type, msg });
    setTimeout(() => setToast(null), 4000);
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
    fetch(`/api/groups/${groupId}/topics`)
      .then(r => r.json())
      .then(d => setTopics(d.topics || []))
      .catch(() => {});
  }, [groupId]);

  // ── Selection helpers ──────────────────────────────────────────────
  const toggleSelect = (id: string) =>
    setSelected(prev => { const s = new Set(prev); s.has(id) ? s.delete(id) : s.add(id); return s; });

  const selectAll = () => setSelected(new Set(filtered.map(t => t.id)));
  const selectNone = () => setSelected(new Set());

  // ── Edit ───────────────────────────────────────────────────────────
  const startEdit = (t: Template) => {
    setEditingId(t.id);
    setEditDraft({ ...t });
  };

  const saveEdit = async () => {
    if (!editingId) return;
    const res = await fetch(`/api/templates/${editingId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(editDraft),
    });
    if (res.ok) {
      showToast("success", "Template updated");
      setEditingId(null);
      load();
    } else {
      showToast("error", "Failed to save");
    }
  };

  const cancelEdit = () => setEditingId(null);

  // ── Delete ─────────────────────────────────────────────────────────
  const deleteOne = async (id: string) => {
    if (!confirm("Delete this template from your library?")) return;
    setDeleting(id);
    const res = await fetch(`/api/templates/${id}`, { method: "DELETE" });
    setDeleting(null);
    if (res.ok) { showToast("success", "Deleted"); load(); setSelected(prev => { const s = new Set(prev); s.delete(id); return s; }); }
    else showToast("error", "Failed to delete");
  };

  const deleteSelected = async () => {
    if (!confirm(`Delete ${selected.size} template(s)?`)) return;
    await Promise.all([...selected].map(id => fetch(`/api/templates/${id}`, { method: "DELETE" })));
    showToast("success", `Deleted ${selected.size} templates`);
    setSelected(new Set());
    load();
  };

  // ── Send ───────────────────────────────────────────────────────────
  const sendSelected = async () => {
    const toSend = templates.filter(t => selected.has(t.id));
    if (toSend.length === 0) return;
    setSending(true);

    const res = await fetch(`/api/groups/${groupId}/bulk`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "send",
        quizzes: toSend.map(t => ({
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
          topicName: sendTopicId ? topics.find(tp => tp.message_thread_id === sendTopicId)?.name : undefined,
        })),
      }),
    });

    const data = await res.json();
    setSending(false);

    if (res.ok) {
      showToast("success", `Sent ${data.processed} quiz${data.processed !== 1 ? "zes" : ""}! ${data.errors?.length ? `(${data.errors.length} failed)` : ""}`);
      setSelected(new Set());
    } else {
      showToast("error", data.error || "Failed to send");
    }
  };

  // ── Filtering ──────────────────────────────────────────────────────
  const filtered = templates.filter(t =>
    !search || t.question.toLowerCase().includes(search.toLowerCase()) ||
    t.tags?.some(tag => tag.toLowerCase().includes(search.toLowerCase()))
  );

  // ── Edit draft helpers ─────────────────────────────────────────────
  const updateOption = (idx: number, val: string) => {
    const opts = [...(editDraft.options || [])];
    opts[idx] = val;
    setEditDraft(d => ({ ...d, options: opts }));
  };
  const addOption = () => setEditDraft(d => ({ ...d, options: [...(d.options || []), ""] }));
  const removeOption = (idx: number) => setEditDraft(d => ({
    ...d,
    options: (d.options || []).filter((_, i) => i !== idx),
    correctOptionId: d.correctOptionId === idx ? null : (d.correctOptionId !== null && d.correctOptionId !== undefined && d.correctOptionId > idx ? d.correctOptionId - 1 : d.correctOptionId),
  }));

  return (
    <div>
      {toast && (
        <div className="toast-container">
          <div className={`toast toast-${toast.type}`}>{toast.msg}</div>
        </div>
      )}

      {/* Header */}
      <div className="section-header animate-fade-up">
        <div>
          <h1>Question Library</h1>
          <p>{templates.length} saved template{templates.length !== 1 ? "s" : ""}</p>
        </div>
        {selected.size > 0 && (
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <button className="btn btn-ghost" style={{ color: "var(--clr-danger)" }} onClick={deleteSelected}>
              🗑 Delete {selected.size}
            </button>
            <button className="btn btn-primary" onClick={sendSelected} disabled={sending}>
              {sending ? `⏳ Sending… (~${selected.size * 3}s)` : `🚀 Send ${selected.size} Selected`}
            </button>
          </div>
        )}
      </div>

      {/* Controls bar */}
      <div className="card animate-fade-up animate-delay-1" style={{ marginBottom: "var(--space-5)", padding: "var(--space-4)" }}>
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
          {/* Search */}
          <div style={{ position: "relative", flex: "1 1 200px", minWidth: 0 }}>
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
              style={{ position: "absolute", left: 10, top: "50%", transform: "translateY(-50%)", color: "var(--clr-text-muted)", pointerEvents: "none" }}>
              <circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/>
            </svg>
            <input className="input" style={{ paddingLeft: 34 }} placeholder="Search by question or tag…"
              value={search} onChange={e => setSearch(e.target.value)} />
          </div>

          {/* Topic selector for send */}
          <div style={{ flex: "0 1 200px", minWidth: 0 }}>
            <select className="select" value={sendTopicId} onChange={e => setSendTopicId(e.target.value ? Number(e.target.value) : "")}>
              <option value="">Send to: General</option>
              {topics.map(t => <option key={t.message_thread_id} value={t.message_thread_id}>{t.name}</option>)}
            </select>
          </div>

          {/* Selection controls */}
          <div style={{ display: "flex", gap: 6 }}>
            <button className="btn btn-ghost btn-sm" onClick={selectAll} disabled={filtered.length === 0}>Select All</button>
            {selected.size > 0 && <button className="btn btn-ghost btn-sm" onClick={selectNone}>Deselect</button>}
          </div>
        </div>
      </div>

      {/* Empty state */}
      {loading ? (
        <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-3)" }}>
          {[1,2,3].map(i => <div key={i} className="skeleton" style={{ height: 100, borderRadius: "var(--radius-md)" }} />)}
        </div>
      ) : filtered.length === 0 ? (
        <div className="empty-state">
          <div className="empty-state-icon">📚</div>
          <h3>{search ? "No matches found" : "Library is empty"}</h3>
          <p>{search ? `No templates match "${search}"` : "Save quizzes from Bulk Import to build your library"}</p>
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-3)" }}>
          {filtered.map((t, idx) => {
            const isSelected = selected.has(t.id);
            const isEditing = editingId === t.id;
            const isDeleting = deleting === t.id;

            return (
              <div
                key={t.id}
                className="card animate-fade-up"
                style={{
                  padding: "var(--space-4)",
                  border: `1px solid ${isSelected ? "var(--clr-brand)" : "var(--clr-border)"}`,
                  background: isSelected ? "var(--clr-brand-muted)" : "var(--clr-bg-card)",
                  transition: "border-color 0.15s, background 0.15s",
                  cursor: isEditing ? "default" : "pointer",
                  overflow: "hidden",
                }}
                onClick={() => !isEditing && toggleSelect(t.id)}
              >
                {/* Card header */}
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 8, marginBottom: 12, flexWrap: "wrap" }}>
                  <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                    {/* Checkbox */}
                    <div
                      onClick={e => { e.stopPropagation(); toggleSelect(t.id); }}
                      style={{
                        width: 18, height: 18, borderRadius: 4, flexShrink: 0,
                        border: `2px solid ${isSelected ? "var(--clr-brand)" : "var(--clr-border)"}`,
                        background: isSelected ? "var(--clr-brand)" : "transparent",
                        display: "flex", alignItems: "center", justifyContent: "center",
                        cursor: "pointer", transition: "all 0.15s",
                      }}
                    >
                      {isSelected && <svg width="10" height="10" viewBox="0 0 12 12" fill="none"><path d="M2 6l3 3 5-5" stroke="white" strokeWidth="2" strokeLinecap="round"/></svg>}
                    </div>
                    <span className={`badge ${t.type === "QUIZ" ? "badge-brand" : "badge-accent"}`}>{t.type}</span>
                    <span style={{ fontSize: "0.78rem", color: "var(--clr-text-muted)" }}>#{idx + 1}</span>
                    {t.tags && t.tags.length > 0 && t.tags.map(tag => (
                      <span key={tag} className="badge badge-muted" style={{ fontSize: "0.7rem" }}>#{tag}</span>
                    ))}
                  </div>
                  <div style={{ display: "flex", gap: 4 }} onClick={e => e.stopPropagation()}>
                    {!isEditing && (
                      <>
                        <button
                          className="btn btn-ghost btn-sm"
                          onClick={() => startEdit(t)}
                          style={{ fontSize: "0.8rem" }}
                        >✏️ Edit</button>
                        <button
                          className="btn btn-ghost btn-sm"
                          style={{ color: "var(--clr-success)" }}
                          onClick={() => { setSelected(new Set([t.id])); sendSelected(); }}
                          disabled={sending}
                        >🚀 Send</button>
                        <button
                          className="btn btn-ghost btn-sm"
                          style={{ color: "var(--clr-danger)" }}
                          onClick={() => deleteOne(t.id)}
                          disabled={isDeleting}
                        >{isDeleting ? "…" : "🗑"}</button>
                      </>
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
                    <div>
                      <label className="input-label">Question</label>
                      <textarea
                        className="input"
                        rows={3}
                        value={editDraft.question || ""}
                        onChange={e => setEditDraft(d => ({ ...d, question: e.target.value }))}
                      />
                    </div>

                    <div>
                      <label className="input-label">Options <span style={{ color: "var(--clr-text-muted)", fontSize: "0.75rem" }}>(click radio = correct)</span></label>
                      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                        {(editDraft.options || []).map((opt, oIdx) => (
                          <div key={oIdx} style={{ display: "flex", gap: 8, alignItems: "center" }}>
                            <input
                              type="radio"
                              name={`edit-correct-${t.id}`}
                              checked={editDraft.correctOptionId === oIdx}
                              onChange={() => setEditDraft(d => ({ ...d, correctOptionId: oIdx, type: "QUIZ" }))}
                              title="Mark as correct answer"
                            />
                            <input
                              className="input"
                              value={opt}
                              style={{ flex: 1 }}
                              onChange={e => updateOption(oIdx, e.target.value)}
                            />
                            {(editDraft.options || []).length > 2 && (
                              <button
                                className="btn btn-ghost btn-sm"
                                style={{ color: "var(--clr-danger)", padding: "0 6px" }}
                                onClick={() => removeOption(oIdx)}
                              >✕</button>
                            )}
                          </div>
                        ))}
                        {(editDraft.options || []).length < 10 && (
                          <button className="btn btn-ghost btn-sm" style={{ alignSelf: "flex-start" }} onClick={addOption}>
                            + Add Option
                          </button>
                        )}
                      </div>
                    </div>

                    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: 10 }}>
                      <div>
                        <label className="input-label">Type</label>
                        <select className="select" value={editDraft.type}
                          onChange={e => setEditDraft(d => ({ ...d, type: e.target.value as "QUIZ" | "POLL" }))}>
                          <option value="QUIZ">Quiz</option>
                          <option value="POLL">Poll</option>
                        </select>
                      </div>
                      <div>
                        <label className="input-label">Duration (sec, 0=∞)</label>
                        <input type="number" className="input" min={0} max={600}
                          value={editDraft.openPeriod || 0}
                          onChange={e => setEditDraft(d => ({ ...d, openPeriod: Number(e.target.value) || null }))} />
                      </div>
                      <div>
                        <label className="input-label">Tags (comma separated)</label>
                        <input className="input" placeholder="math, easy"
                          value={(editDraft.tags || []).join(", ")}
                          onChange={e => setEditDraft(d => ({ ...d, tags: e.target.value.split(",").map(t => t.trim()).filter(Boolean) }))} />
                      </div>
                    </div>

                    <div>
                      <label className="input-label">Explanation</label>
                      <input className="input" placeholder="Optional explanation"
                        value={editDraft.explanation || ""}
                        onChange={e => setEditDraft(d => ({ ...d, explanation: e.target.value }))} />
                    </div>

                    <div style={{ display: "flex", gap: 16, flexWrap: "wrap", fontSize: "0.85rem" }}>
                      <label style={{ display: "flex", alignItems: "center", gap: 6, cursor: "pointer" }}>
                        <input type="checkbox" checked={!!editDraft.isAnonymous}
                          onChange={e => setEditDraft(d => ({ ...d, isAnonymous: e.target.checked }))} />
                        Anonymous
                      </label>
                      {editDraft.type === "POLL" && (
                        <label style={{ display: "flex", alignItems: "center", gap: 6, cursor: "pointer" }}>
                          <input type="checkbox" checked={!!editDraft.allowsMultiple}
                            onChange={e => setEditDraft(d => ({ ...d, allowsMultiple: e.target.checked }))} />
                          Multiple answers
                        </label>
                      )}
                    </div>
                  </div>
                ) : (
                  /* View mode */
                  <>
                    <div style={{ fontWeight: 500, marginBottom: 10, lineHeight: 1.45, wordBreak: "break-word" }}>
                      {t.question}
                    </div>
                    <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
                      {t.options.map((o, i) => (
                        <div key={i} style={{
                          padding: "5px 10px", borderRadius: "var(--radius-sm)", fontSize: "0.84rem",
                          background: t.correctOptionId === i ? "var(--clr-success-muted)" : "rgba(255,255,255,0.02)",
                          border: `1px solid ${t.correctOptionId === i ? "var(--clr-success)" : "transparent"}`,
                          color: t.correctOptionId === i ? "var(--clr-success)" : "var(--clr-text-secondary)",
                        }}>
                          <b>{String.fromCharCode(65 + i)}.</b> {o}
                        </div>
                      ))}
                    </div>
                    {t.explanation && (
                      <div style={{ marginTop: 10, fontSize: "0.78rem", color: "var(--clr-text-muted)", padding: "6px 10px", background: "rgba(0,0,0,0.2)", borderRadius: 6 }}>
                        💡 {t.explanation}
                      </div>
                    )}
                    <div style={{ marginTop: 10, display: "flex", gap: 8, flexWrap: "wrap", fontSize: "0.75rem", color: "var(--clr-text-muted)" }}>
                      {t.isAnonymous && <span>🔒 Anonymous</span>}
                      {t.openPeriod ? <span>⏱ {t.openPeriod}s</span> : null}
                      {t.allowsMultiple && <span>☑ Multi-answer</span>}
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
