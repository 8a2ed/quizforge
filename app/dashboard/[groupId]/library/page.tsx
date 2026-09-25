"use client";

import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";

interface Template {
  id: string; question: string; options: string[];
  type: "QUIZ" | "POLL"; isAnonymous: boolean;
  correctOptionId: number | null; explanation: string | null;
  allowsMultiple: boolean; allowAddingOptions: boolean; allowRevoting: boolean;
  openPeriod: number | null; tags?: string[];
  topicId?: number | null; topicName?: string | null;
  createdAt: string;
  collectionIds?: string[];
}

interface Collection {
  id: string; name: string; emoji: string; color: string; quizCount: number; createdAt: string;
}

type SortKey = "newest" | "oldest" | "az" | "type";

function timeAgo(iso: string): string {
  const s = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return new Date(iso).toLocaleDateString();
}

interface Topic { message_thread_id: number; name: string; }

interface SendProgress {
  active: boolean;
  total: number;
  sent: number;
  failed: number;
  errors: { id: string; question: string; msg: string }[];
  startTime: number;
  statuses: ("pending" | "sending" | "sent" | "failed")[];
}

const DELAY_MS = 3200; // 3.2s between sends to respect Telegram rate limits

export default function LibraryPage() {
  const { groupId } = useParams<{ groupId: string }>();

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
  const [sortKey, setSortKey] = useState<SortKey>("newest");
  const [tagFilter, setTagFilter] = useState("");
  const [perQuizTopic, setPerQuizTopic] = useState<Record<string, number | "">>({});
  const [typeFilter, setTypeFilter] = useState<"" | "QUIZ" | "POLL">("");
  const [toast, setToast] = useState<{ type: "success" | "error"; msg: string } | null>(null);
  const [progress, setProgress] = useState<SendProgress | null>(null);
  const cancelRef = useRef(false);

  // Collections state
  const [collections, setCollections] = useState<Collection[]>([]);
  const [activeCollection, setActiveCollection] = useState<string | null>(null);
  const [showNewColl, setShowNewColl] = useState(false);
  const [editColl, setEditColl] = useState<Collection | null>(null);
  const [collForm, setCollForm] = useState({ name: "", emoji: "📁", color: "#6366f1" });
  const [showAddToColl, setShowAddToColl] = useState(false);
  const [collLoading, setCollLoading] = useState(false);

  // Live timer tick — re-renders once per second while broadcasting
  const [, setTick] = useState(0);
  useEffect(() => {
    if (!progress?.active) return;
    const id = setInterval(() => setTick(t => t + 1), 1000);
    return () => clearInterval(id);
  }, [progress?.active]);

  const showToast = (type: "success" | "error", msg: string) => {
    setToast({ type, msg });
    setTimeout(() => setToast(null), 4500);
  };

  const load = useCallback(() => {
    setLoading(true);
    fetch("/api/templates")
      .then(async r => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      })
      .then(d => { setTemplates(d.templates || []); setLoading(false); })
      .catch(e => { setLoading(false); showToast("error", `Failed to load library: ${e.message}`); });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    fetch(`/api/groups/${groupId}/topics`).then(r => r.json()).then(d => setTopics(d.topics || [])).catch(() => {});
  }, [groupId]);

  const loadCollections = useCallback(() => {
    fetch("/api/collections")
      .then(r => r.json())
      .then(d => setCollections(d.collections || []))
      .catch(() => {});
  }, []);
  useEffect(() => { loadCollections(); }, [loadCollections]);

  // ── Derived state (memoized) ────────────────────────────────────────
  const allTags = useMemo(() => [...new Set(templates.flatMap(t => t.tags || []))].sort(), [templates]);

  const filtered = useMemo(() => templates
    .filter(t => {
      if (!showSent && sentIds.has(t.id)) return false;
      if (activeCollection && !t.collectionIds?.includes(activeCollection)) return false;
      if (tagFilter && !t.tags?.includes(tagFilter)) return false;
      if (typeFilter && t.type !== typeFilter) return false;
      if (!search) return true;
      const term = search.toLowerCase();
      return (
        t.question.toLowerCase().includes(term) ||
        t.tags?.some(tag => tag.toLowerCase().includes(term)) ||
        t.options?.some(opt => opt.toLowerCase().includes(term))
      );
    })
    .sort((a, b) => {
      if (sortKey === "oldest") return new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
      if (sortKey === "az") return a.question.localeCompare(b.question);
      if (sortKey === "type") return a.type.localeCompare(b.type);
      return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
    }), [templates, showSent, sentIds, activeCollection, tagFilter, typeFilter, search, sortKey]);

  const visibleSelected = useMemo(() => [...selected].filter(id => filtered.some(t => t.id === id)), [selected, filtered]);

  // ── Selection ─────────────────────────────────────────────────────
  const toggleSelect = useCallback((id: string) =>
    setSelected(prev => { const s = new Set(prev); s.has(id) ? s.delete(id) : s.add(id); return s; }), []);
  const selectAll = () => setSelected(new Set(filtered.map(t => t.id)));
  const selectNone = () => setSelected(new Set());

  // ── Export library ────────────────────────────────────────────────
  const handleExportJSON = () => {
    const toExport = visibleSelected.length > 0
      ? templates.filter(t => selected.has(t.id))
      : filtered;
    if (toExport.length === 0) {
      showToast("error", "No templates to export.");
      return;
    }
    const blob = new Blob([JSON.stringify(toExport, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `quiz-templates-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1500);
    showToast("success", `Exported ${toExport.length} template(s) to JSON ✓`);
  };

  // ── Sequential sender ─────────────────────────────────────────────
  const sendSequentially = async (toSend: Template[]) => {
    if (toSend.length === 0) return;
    cancelRef.current = false;

    setProgress({ active: true, total: toSend.length, sent: 0, failed: 0, errors: [], startTime: Date.now(), statuses: Array(toSend.length).fill("pending") });

    for (let i = 0; i < toSend.length; i++) {
      if (cancelRef.current) break;

      // Mark current as sending
      setProgress(prev => prev ? { ...prev, statuses: prev.statuses.map((s, j) => j === i ? "sending" : s) } : prev);

      const t = toSend[i];
      try {
        const qTopicId = perQuizTopic[t.id] !== undefined && perQuizTopic[t.id] !== ""
          ? perQuizTopic[t.id]
          : t.topicId !== undefined && t.topicId !== null
          ? t.topicId
          : sendTopicId;
        const qTopicName = topics.find(tp => tp.message_thread_id === qTopicId)?.name || (qTopicId === t.topicId ? (t.topicName || undefined) : undefined);
        
        const payload = {
          question: t.question,
          options: t.options,
          type: t.type === "QUIZ" ? "quiz" : "poll",
          correctOptionId: t.type === "QUIZ" ? (t.correctOptionId ?? 0) : undefined,
          explanation: t.type === "QUIZ" ? (t.explanation || undefined) : undefined,
          isAnonymous: t.isAnonymous,
          allowsMultiple: t.type === "POLL" ? Boolean(t.allowsMultiple) : false,
          allowAddingOptions: t.type === "POLL" ? Boolean(t.allowAddingOptions) : false,
          allowRevoting: t.type === "POLL" ? Boolean(t.allowRevoting) : false,
          openPeriod: t.openPeriod || undefined,
          tags: t.tags || [],
          topicId: qTopicId || undefined,
          topicName: qTopicName || undefined,
          collectionIds: t.collectionIds || [],
        };

        let res = await fetch(`/api/groups/${groupId}/quiz/send`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });

        // If rate-limited by Telegram (429), pause and retry once
        if (res.status === 429 && !cancelRef.current) {
          const errData = await res.json().catch(() => ({}));
          const waitSec = Number(errData.retryAfter) || 5;
          await new Promise(r => setTimeout(r, waitSec * 1000));
          if (!cancelRef.current) {
            res = await fetch(`/api/groups/${groupId}/quiz/send`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(payload),
            });
          }
        }

        if (res.ok) {
          setSentIds(prev => new Set([...prev, t.id]));
          setSelected(prev => { const s = new Set(prev); s.delete(t.id); return s; });
          setProgress(prev => prev ? { ...prev, sent: prev.sent + 1, statuses: prev.statuses.map((s, j) => j === i ? "sent" : s) } : prev);
        } else {
          const data = await res.json().catch(() => ({}));
          setProgress(prev => prev ? {
            ...prev,
            failed: prev.failed + 1,
            statuses: prev.statuses.map((s, j) => j === i ? "failed" : s),
            errors: [...prev.errors, { id: t.id, question: t.question.slice(0, 60), msg: data.error || "Broadcast error" }],
          } : prev);
        }
      } catch {
        setProgress(prev => prev ? {
          ...prev,
          failed: prev.failed + 1,
          statuses: prev.statuses.map((s, j) => j === i ? "failed" : s),
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

  // ── Duplicate ──────────────────────────────────────────────────────
  const duplicateOne = async (t: Template) => {
    const copySuffix = " (copy)";
    const maxQ = 300 - copySuffix.length;
    const cleanQ = (t.question.length > maxQ ? t.question.slice(0, maxQ) : t.question) + copySuffix;

    try {
      const res = await fetch("/api/templates", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          question: cleanQ,
          options: t.options,
          type: t.type,
          isAnonymous: t.isAnonymous,
          correctOptionId: t.type === "QUIZ" ? t.correctOptionId : null,
          explanation: t.explanation,
          allowsMultiple: t.allowsMultiple,
          allowAddingOptions: t.allowAddingOptions,
          allowRevoting: t.allowRevoting,
          openPeriod: t.openPeriod,
          tags: t.tags || [],
          topicId: t.topicId,
          topicName: t.topicName,
          collectionIds: t.collectionIds || [],
        }),
      });
      const data = await res.json();
      if (res.ok) {
        showToast("success", "Duplicated ✓");
        load();
      } else {
        showToast("error", data.error || "Failed to duplicate");
      }
    } catch {
      showToast("error", "Network error duplicating template");
    }
  };

  // ── Delete ─────────────────────────────────────────────────────────
  const deleteOne = async (id: string) => {
    if (!confirm("Delete this template?")) return;
    try {
      const res = await fetch(`/api/templates/${id}`, { method: "DELETE" });
      if (res.ok) {
        setTemplates(prev => prev.filter(t => t.id !== id));
        setSelected(prev => { const s = new Set(prev); s.delete(id); return s; });
        showToast("success", "Deleted");
      } else {
        const data = await res.json().catch(() => ({}));
        showToast("error", data.error || "Failed to delete");
      }
    } catch {
      showToast("error", "Network error deleting template");
    }
  };

  const deleteSelected = async () => {
    if (visibleSelected.length === 0) return;
    if (!confirm(`Delete ${visibleSelected.length} template(s)?`)) return;
    const toDelete = [...visibleSelected];
    try {
      const res = await fetch("/api/templates", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids: toDelete }),
      });
      if (res.ok) {
        setTemplates(prev => prev.filter(t => !toDelete.includes(t.id)));
        setSelected(prev => {
          const s = new Set(prev);
          toDelete.forEach(id => s.delete(id));
          return s;
        });
        showToast("success", `Deleted ${toDelete.length} templates`);
      } else {
        const data = await res.json().catch(() => ({}));
        showToast("error", data.error || "Failed to delete templates");
      }
    } catch {
      showToast("error", "Network error deleting templates");
    }
  };

  // ── Edit ───────────────────────────────────────────────────────────
  const startEdit = (t: Template) => {
    setEditingId(t.id);
    setEditDraft({
      ...t,
      options: [...t.options],
      tags: t.tags ? [...t.tags] : [],
      collectionIds: t.collectionIds ? [...t.collectionIds] : [],
      topicId: t.topicId,
      topicName: t.topicName,
    });
  };
  const cancelEdit = () => setEditingId(null);

  const saveEdit = async () => {
    if (!editingId) return;

    const q = (editDraft.question || "").trim();
    if (!q) {
      showToast("error", "Question cannot be empty.");
      return;
    }
    if (q.length > 300) {
      showToast("error", `Question cannot exceed 300 characters (currently ${q.length}).`);
      return;
    }

    const rawOpts = editDraft.options || [];
    const cleanOpts = rawOpts.map(o => o.trim()).filter(Boolean);
    if (cleanOpts.length < 2) {
      showToast("error", "At least 2 non-empty options are required.");
      return;
    }
    if (cleanOpts.length > 10) {
      showToast("error", "Maximum 10 options allowed.");
      return;
    }
    if (cleanOpts.some(o => o.length > 100)) {
      showToast("error", "Each option must be 100 characters or less.");
      return;
    }

    const lowerOpts = cleanOpts.map(o => o.toLowerCase());
    if (new Set(lowerOpts).size !== lowerOpts.length) {
      showToast("error", "Options must be unique (duplicate options detected).");
      return;
    }

    if (editDraft.type === "QUIZ") {
      if (
        editDraft.correctOptionId === null ||
        editDraft.correctOptionId === undefined ||
        editDraft.correctOptionId < 0 ||
        editDraft.correctOptionId >= cleanOpts.length
      ) {
        showToast("error", "Please select a valid correct answer for the quiz.");
        return;
      }
    }

    const exp = (editDraft.explanation || "").trim();
    if (exp.length > 200) {
      showToast("error", `Explanation cannot exceed 200 characters (currently ${exp.length}).`);
      return;
    }

    const payload = {
      ...editDraft,
      question: q,
      options: cleanOpts,
      explanation: exp || null,
      correctOptionId: editDraft.type === "QUIZ" ? editDraft.correctOptionId : null,
      allowsMultiple: editDraft.type === "POLL" ? Boolean(editDraft.allowsMultiple) : false,
      allowAddingOptions: editDraft.type === "POLL" ? Boolean(editDraft.allowAddingOptions) : false,
      allowRevoting: editDraft.type === "POLL" ? Boolean(editDraft.allowRevoting) : false,
      topicId: editDraft.topicId !== undefined ? editDraft.topicId : null,
      topicName: editDraft.topicName || null,
      collectionIds: editDraft.collectionIds || [],
    };

    try {
      const res = await fetch(`/api/templates/${editingId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (res.ok) {
        showToast("success", "Saved ✓");
        setEditingId(null);
        load();
      } else {
        showToast("error", data.error || "Failed to save");
      }
    } catch {
      showToast("error", "Network error saving template");
    }
  };

  const updateOpt = (i: number, v: string) => {
    const o = [...(editDraft.options || [])]; o[i] = v;
    setEditDraft(d => ({ ...d, options: o }));
  };

  // ── Collection handlers ────────────────────────────────────────────
  const createCollection = async () => {
    if (!collForm.name.trim()) return;
    setCollLoading(true);
    try {
      const res = await fetch("/api/collections", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify(collForm),
      });
      if (res.ok) { showToast("success", `Collection "${collForm.name}" created!`); setShowNewColl(false); setCollForm({ name: "", emoji: "📁", color: "#6366f1" }); loadCollections(); }
      else { const d = await res.json().catch(() => ({})); showToast("error", d.error || "Failed to create collection"); }
    } catch { showToast("error", "Network error creating collection"); }
    finally { setCollLoading(false); }
  };

  const saveCollEdit = async () => {
    if (!editColl) return;
    setCollLoading(true);
    try {
      const res = await fetch(`/api/collections/${editColl.id}`, {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify(collForm),
      });
      if (res.ok) { showToast("success", "Collection updated!"); setEditColl(null); setCollForm({ name: "", emoji: "📁", color: "#6366f1" }); loadCollections(); }
      else { const d = await res.json().catch(() => ({})); showToast("error", d.error || "Failed to update"); }
    } catch { showToast("error", "Network error updating collection"); }
    finally { setCollLoading(false); }
  };

  const deleteCollection = async (c: Collection) => {
    if (!confirm(`Delete collection "${c.name}"? Quizzes will NOT be deleted.`)) return;
    try {
      const res = await fetch(`/api/collections/${c.id}`, { method: "DELETE" });
      if (res.ok) {
        if (activeCollection === c.id) setActiveCollection(null);
        showToast("success", `"${c.name}" deleted`);
        loadCollections();
        load();
      } else {
        const d = await res.json().catch(() => ({}));
        showToast("error", d.error || "Failed to delete collection");
      }
    } catch { showToast("error", "Network error deleting collection"); }
  };

  const addSelectedToCollection = async (collId: string) => {
    if (visibleSelected.length === 0) return;
    try {
      const res = await fetch(`/api/collections/${collId}/quizzes`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ quizIds: visibleSelected }),
      });
      if (res.ok) { showToast("success", `Added ${visibleSelected.length} quiz(zes) to collection!`); setShowAddToColl(false); load(); loadCollections(); }
      else { const d = await res.json().catch(() => ({})); showToast("error", d.error || "Failed to add to collection"); }
    } catch { showToast("error", "Network error adding to collection"); }
  };

  const removeFromCollection = async (quizId: string, collId: string) => {
    try {
      const res = await fetch(`/api/collections/${collId}/quizzes`, {
        method: "DELETE", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ quizIds: [quizId] }),
      });
      if (res.ok) { showToast("success", "Removed from collection"); load(); loadCollections(); }
      else { const d = await res.json().catch(() => ({})); showToast("error", d.error || "Failed to remove from collection"); }
    } catch { showToast("error", "Network error removing from collection"); }
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

      {/* ── Collection form modal (create / edit) ── */}
      {(showNewColl || editColl) && (
        <div style={{ position: "fixed", inset: 0, zIndex: 1000, background: "rgba(0,0,0,0.6)", display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }}
          onClick={() => { setShowNewColl(false); setEditColl(null); setCollForm({ name: "", emoji: "📁", color: "#6366f1" }); }}>
          <div style={{ background: "var(--clr-bg-card)", borderRadius: 16, padding: 28, width: "100%", maxWidth: 420, boxShadow: "0 24px 64px rgba(0,0,0,0.5)", display: "flex", flexDirection: "column", gap: 16 }}
            onClick={e => e.stopPropagation()}>
            <h3 style={{ margin: 0 }}>{editColl ? "✏️ Edit Collection" : "📁 New Collection"}</h3>
            <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
              <input className="input" placeholder="Emoji" value={collForm.emoji} maxLength={2}
                onChange={e => setCollForm(f => ({ ...f, emoji: e.target.value }))}
                style={{ width: 60, textAlign: "center", fontSize: "1.4rem", padding: "4px 0" }} />
              <input className="input" placeholder="Collection name…" value={collForm.name} style={{ flex: 1 }}
                onChange={e => setCollForm(f => ({ ...f, name: e.target.value }))}
                onKeyDown={e => e.key === "Enter" && (editColl ? saveCollEdit() : createCollection())} autoFocus />
            </div>
            <div>
              <label className="input-label">Color</label>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                {["#6366f1","#0ea5e9","#10b981","#f59e0b","#ef4444","#a855f7","#ec4899","#64748b"].map(c => (
                  <button key={c} onClick={() => setCollForm(f => ({ ...f, color: c }))}
                    style={{ width: 28, height: 28, borderRadius: "50%", background: c, border: `3px solid ${collForm.color === c ? "white" : "transparent"}`, cursor: "pointer", outline: collForm.color === c ? `2px solid ${c}` : "none", outlineOffset: 2 }} />
                ))}
              </div>
            </div>
            <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
              <button className="btn btn-ghost" onClick={() => { setShowNewColl(false); setEditColl(null); setCollForm({ name: "", emoji: "📁", color: "#6366f1" }); }}>Cancel</button>
              <button className="btn btn-primary" onClick={editColl ? saveCollEdit : createCollection} disabled={collLoading || !collForm.name.trim()}>
                {collLoading ? "Saving…" : editColl ? "Save Changes" : "Create"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Add to Collection modal ── */}
      {showAddToColl && (
        <div style={{ position: "fixed", inset: 0, zIndex: 1000, background: "rgba(0,0,0,0.6)", display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }}
          onClick={() => setShowAddToColl(false)}>
          <div style={{ background: "var(--clr-bg-card)", borderRadius: 16, padding: 24, width: "100%", maxWidth: 380, boxShadow: "0 24px 64px rgba(0,0,0,0.5)" }}
            onClick={e => e.stopPropagation()}>
            <h3 style={{ margin: "0 0 16px" }}>📁 Add {visibleSelected.length} quiz{visibleSelected.length !== 1 ? "zes" : ""} to…</h3>
            {collections.length === 0 ? (
              <div style={{ textAlign: "center", color: "var(--clr-text-muted)", padding: "20px 0" }}>
                No collections yet. Create one first.
              </div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {collections.map(c => (
                  <button key={c.id} onClick={() => addSelectedToCollection(c.id)}
                    style={{ display: "flex", alignItems: "center", gap: 12, padding: "10px 14px", background: "var(--clr-bg-elevated)", border: "1px solid var(--clr-border)", borderRadius: 10, cursor: "pointer", textAlign: "left" }}
                    onMouseEnter={e => (e.currentTarget.style.borderColor = c.color)}
                    onMouseLeave={e => (e.currentTarget.style.borderColor = "var(--clr-border)")}>
                    <span style={{ width: 32, height: 32, borderRadius: 8, background: c.color + "33", display: "flex", alignItems: "center", justifyContent: "center", fontSize: "1.1rem", flexShrink: 0 }}>{c.emoji}</span>
                    <div>
                      <div style={{ fontWeight: 600, fontSize: "0.9rem" }}>{c.name}</div>
                      <div style={{ fontSize: "0.72rem", color: "var(--clr-text-muted)" }}>{c.quizCount} quizzes</div>
                    </div>
                  </button>
                ))}
              </div>
            )}
            <button className="btn btn-ghost btn-sm" onClick={() => setShowAddToColl(false)} style={{ marginTop: 12, width: "100%", justifyContent: "center" }}>Cancel</button>
          </div>
        </div>
      )}

      {/* Header */}
      <div className="section-header animate-fade-up">
        <div>
          <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
            <h1 style={{ margin: 0 }}>Question Library</h1>
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
              <Link href={`/dashboard/${groupId}/bulk`} className="btn btn-ghost btn-sm" style={{ fontSize: "0.78rem", padding: "4px 10px" }}>
                📥 Bulk Import
              </Link>
              <Link href={`/dashboard/${groupId}/quiz/new`} className="btn btn-ghost btn-sm" style={{ fontSize: "0.78rem", padding: "4px 10px" }}>
                ➕ New Quiz
              </Link>
              <Link href={`/dashboard/${groupId}/topics`} className="btn btn-ghost btn-sm" style={{ fontSize: "0.78rem", padding: "4px 10px" }}>
                🏷️ Topics
              </Link>
              <Link href={`/dashboard/${groupId}/analytics`} className="btn btn-ghost btn-sm" style={{ fontSize: "0.78rem", padding: "4px 10px" }}>
                📊 Analytics
              </Link>
            </div>
          </div>
          <p style={{ marginTop: 4 }}>
            {templates.length} template{templates.length !== 1 ? "s" : ""}
            {sentIds.size > 0 && <span style={{ color: "var(--clr-success)", marginLeft: 10 }}>· {sentIds.size} sent this session</span>}
          </p>
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
          {visibleSelected.length > 0 && !progress?.active && (
            <>
              <button className="btn btn-ghost btn-sm" style={{ border: "1px solid var(--clr-border)" }} onClick={() => setShowAddToColl(true)}>
                📁 Add to Collection
              </button>
              <button className="btn btn-ghost" style={{ color: "var(--clr-danger)" }} onClick={deleteSelected}>
                🗑 Delete {visibleSelected.length}
              </button>
              <button className="btn btn-primary" onClick={handleSendSelected}>
                🚀 Send {visibleSelected.length} Selected
              </button>
            </>
          )}
          <button className="btn btn-ghost btn-sm" style={{ border: "1px solid var(--clr-border)" }} onClick={handleExportJSON} title="Download templates as JSON">
            📥 Export JSON
          </button>
        </div>
      </div>

      {/* ── Collections tab bar ── */}
      <div style={{ display: "flex", gap: 6, overflowX: "auto", paddingBottom: 4, marginBottom: 16, scrollbarWidth: "none" }}>
        <button onClick={() => setActiveCollection(null)}
          className="btn btn-ghost btn-sm"
          style={{ flexShrink: 0, border: `1px solid ${!activeCollection ? "var(--clr-brand)" : "var(--clr-border)"}`, color: !activeCollection ? "var(--clr-brand)" : "var(--clr-text-muted)", fontSize: "0.8rem", whiteSpace: "nowrap" }}>
          🗂 All ({templates.length})
        </button>
        {collections.map(c => (
          <div key={c.id} style={{ display: "flex", flexShrink: 0, position: "relative" }}>
            <button onClick={() => setActiveCollection(c.id)}
              className="btn btn-ghost btn-sm"
              style={{ border: `1px solid ${activeCollection === c.id ? c.color : "var(--clr-border)"}`, color: activeCollection === c.id ? c.color : "var(--clr-text-muted)", fontSize: "0.8rem", whiteSpace: "nowrap", paddingRight: 28 }}>
              {c.emoji} {c.name} ({c.quizCount})
            </button>
            {activeCollection === c.id && (
              <div style={{ position: "absolute", right: 4, top: "50%", transform: "translateY(-50%)", display: "flex", gap: 2 }}>
                <button onClick={e => { e.stopPropagation(); setEditColl(c); setCollForm({ name: c.name, emoji: c.emoji, color: c.color }); }}
                  style={{ background: "none", border: "none", cursor: "pointer", fontSize: "0.65rem", padding: "2px 3px", color: "var(--clr-text-muted)", lineHeight: 1 }} title="Rename">✏️</button>
                <button onClick={e => { e.stopPropagation(); deleteCollection(c); }}
                  style={{ background: "none", border: "none", cursor: "pointer", fontSize: "0.65rem", padding: "2px 3px", color: "var(--clr-danger)", lineHeight: 1 }} title="Delete">🗑</button>
              </div>
            )}
          </div>
        ))}
        <button onClick={() => { setShowNewColl(true); setCollForm({ name: "", emoji: "📁", color: "#6366f1" }); }}
          className="btn btn-ghost btn-sm"
          style={{ flexShrink: 0, border: "1px dashed var(--clr-border)", color: "var(--clr-text-muted)", fontSize: "0.8rem" }}>
          + New Collection
        </button>
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
            {progress.statuses.map((status, i) => (
              <div key={i} style={{
                width: 10, height: 10, borderRadius: "var(--radius-full)",
                background: status === "sent" ? "var(--clr-success)" : status === "failed" ? "var(--clr-danger)" :
                  status === "sending" ? "var(--clr-brand)" : "var(--clr-bg-hover)",
                transition: "background 0.3s",
                animation: status === "sending" ? "glow-pulse 1s infinite" : undefined,
                }} />
            ))}
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
          <div style={{ position: "relative", flex: "1 1 160px", minWidth: 0 }}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ position: "absolute", left: 10, top: "50%", transform: "translateY(-50%)", color: "var(--clr-text-muted)", pointerEvents: "none" }}><circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/></svg>
            <input className="input" style={{ paddingLeft: 32 }} placeholder="Search questions…" value={search} onChange={e => setSearch(e.target.value)} />
          </div>
          <select className="select" style={{ flex: "0 1 170px", minWidth: 0 }} value={sendTopicId} onChange={e => setSendTopicId(e.target.value ? Number(e.target.value) : "")}>
            <option value="">📌 Default: General</option>
            {topics.map(t => <option key={t.message_thread_id} value={t.message_thread_id}>📂 {t.name}</option>)}
          </select>
          {allTags.length > 0 && (
            <select className="select" style={{ flex: "0 1 140px", minWidth: 0 }} value={tagFilter} onChange={e => setTagFilter(e.target.value)}>
              <option value="">🏷 All tags</option>
              {allTags.map(tag => <option key={tag} value={tag}>#{tag}</option>)}
            </select>
          )}
          <select className="select" style={{ flex: "0 1 130px", minWidth: 0 }} value={sortKey} onChange={e => setSortKey(e.target.value as SortKey)}>
            <option value="newest">🕐 Newest</option>
            <option value="oldest">🕐 Oldest</option>
            <option value="az">🔤 A→Z</option>
            <option value="type">📊 By Type</option>
          </select>
          <button className="btn btn-ghost btn-sm" onClick={visibleSelected.length === filtered.length && filtered.length > 0 ? selectNone : selectAll}>
            {visibleSelected.length === filtered.length && filtered.length > 0 ? "Deselect All" : `Select All (${filtered.length})`}
          </button>
          <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: "0.84rem", cursor: "pointer", whiteSpace: "nowrap" }}>
            <div className="toggle-switch" style={{ transform: "scale(0.85)" }}>
              <input type="checkbox" checked={showSent} onChange={e => setShowSent(e.target.checked)} />
              <span className="toggle-slider" />
            </div>
            Show sent ({sentIds.size})
          </label>
        </div>
        {(tagFilter || search || typeFilter) && (
          <div style={{ marginTop: 10, display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
            <span style={{ fontSize: "0.78rem", color: "var(--clr-text-muted)" }}>{filtered.length} of {templates.length} shown</span>
            {tagFilter && <button className="badge badge-muted" style={{ cursor: "pointer", border: "none" }} onClick={() => setTagFilter("")}>#{tagFilter} ✕</button>}
            {search && <button className="badge badge-muted" style={{ cursor: "pointer", border: "none" }} onClick={() => setSearch("")}>"{search}" ✕</button>}
            {typeFilter && <button className="badge badge-muted" style={{ cursor: "pointer", border: "none" }} onClick={() => setTypeFilter("")}>Type: {typeFilter} ✕</button>}
          </div>
        )}
        {/* Type filter pills */}
        <div style={{ display: "flex", gap: 6, marginTop: 10 }}>
          {(["", "QUIZ", "POLL"] as const).map(val => (
            <button key={val} onClick={() => setTypeFilter(val)}
              className="btn btn-ghost btn-sm"
              style={{ border: `1px solid ${typeFilter === val ? "var(--clr-brand)" : "var(--clr-border)"}`, color: typeFilter === val ? "var(--clr-brand)" : "var(--clr-text-muted)", fontSize: "0.75rem" }}>
              {val === "" ? "🗂 All" : val === "QUIZ" ? "✅ Quiz only" : "📊 Poll only"}
            </button>
          ))}
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
                  boxShadow: isSelected ? "0 4px 20px rgba(99, 102, 241, 0.18)" : undefined,
                  transition: "all 0.18s ease",
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
                    {t.topicName && <span className="badge badge-muted" style={{ fontSize: "0.68rem" }}>📍 {t.topicName}</span>}
                    {t.collectionIds?.map(cid => {
                      const col = collections.find(c => c.id === cid);
                      if (!col) return null;
                      return (
                        <span key={cid} className="badge" style={{ fontSize: "0.68rem", background: col.color + "22", color: col.color, border: `1px solid ${col.color}44`, cursor: "pointer" }}
                          onClick={e => { e.stopPropagation(); setActiveCollection(activeCollection === cid ? null : cid); }}
                          title={`Filter by ${col.name}`}>
                          {col.emoji} {col.name}
                        </span>
                      );
                    })}
                    {t.tags?.map(tag => <span key={tag} className="badge badge-muted" style={{ fontSize: "0.68rem", cursor: "pointer" }} onClick={e => { e.stopPropagation(); setTagFilter(tag); }}>#{tag}</span>)}
                  </div>
                  <div style={{ display: "flex", gap: 6 }} onClick={e => e.stopPropagation()}>
                    {!isEditing && (
                      <>
                        <button className="btn btn-ghost btn-sm" title="Edit" style={{ fontSize: "0.82rem", padding: "4px 8px" }} onClick={() => startEdit(t)}>✏️</button>
                        <button className="btn btn-ghost btn-sm" title="Duplicate" style={{ fontSize: "0.82rem", padding: "4px 8px" }} onClick={() => duplicateOne(t)}>⧉</button>
                        <button className="btn btn-ghost btn-sm" title="Open in Quiz Creator"
                          style={{ fontSize: "0.82rem", padding: "4px 8px" }}
                          onClick={() => {
                            const draft = { question: t.question, options: t.options, type: t.type === "QUIZ" ? "quiz" : "poll", correctOptionId: t.correctOptionId, explanation: t.explanation, isAnonymous: t.isAnonymous, allowsMultiple: t.allowsMultiple, openPeriod: t.openPeriod, tags: t.tags, topicId: t.topicId, topicName: t.topicName, collectionIds: t.collectionIds };
                            try { sessionStorage.setItem("quiz-draft", JSON.stringify(draft)); } catch { /* storage full — ignore */ }
                            window.open(`/dashboard/${groupId}/quiz/new?fromLibrary=1`, "_blank");
                          }}>🔗</button>
                        {!isSent && (
                          <button className="btn btn-ghost btn-sm" title="Send now" style={{ color: "var(--clr-success)", fontSize: "0.82rem", padding: "4px 8px" }}
                            onClick={() => handleSendOne(t)} disabled={!!progress?.active}>🚀</button>
                        )}
                        <button className="btn btn-ghost btn-sm" title="Delete" style={{ color: "var(--clr-danger)", fontSize: "0.82rem", padding: "4px 8px" }} onClick={() => deleteOne(t.id)}>🗑</button>
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
                    {/* Question */}
                    <div>
                      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 3 }}>
                        <label className="input-label" style={{ margin: 0 }}>Question</label>
                        <span style={{ fontSize: "0.72rem", color: (editDraft.question || "").trim().length > 300 ? "var(--clr-danger)" : "var(--clr-text-muted)" }}>
                          {(editDraft.question || "").trim().length}/300
                        </span>
                      </div>
                      <textarea
                        className="input"
                        rows={2}
                        placeholder="Question text…"
                        value={editDraft.question || ""}
                        style={{
                          width: "100%",
                          borderColor: (editDraft.question || "").trim().length > 300 ? "var(--clr-danger)" : undefined,
                        }}
                        onChange={e => setEditDraft(d => ({ ...d, question: e.target.value }))}
                      />
                    </div>

                    {/* Options */}
                    <div>
                      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
                        <label className="input-label" style={{ margin: 0 }}>
                          Options ({editDraft.options?.length || 0}/10)
                        </label>
                        {(() => {
                          const rawOpts = editDraft.options || [];
                          const clean = rawOpts.map(o => o.trim().toLowerCase()).filter(Boolean);
                          const hasDupes = new Set(clean).size !== clean.length;
                          return hasDupes ? (
                            <span style={{ fontSize: "0.72rem", color: "var(--clr-danger)", fontWeight: 600 }}>
                              ⚠️ Duplicate options detected
                            </span>
                          ) : null;
                        })()}
                      </div>
                      <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
                        {(() => {
                          const rawOpts = editDraft.options || [];
                          const cleanOpts = rawOpts.map(o => o.trim().toLowerCase());
                          const dupes = new Set(cleanOpts.filter((v, idx, arr) => v && arr.indexOf(v) !== idx));

                          return rawOpts.map((opt, i) => {
                            const isDupe = opt.trim() && dupes.has(opt.trim().toLowerCase());
                            const isOver = opt.length > 100;
                            return (
                              <div key={i} style={{ display: "flex", gap: 6, alignItems: "center" }}>
                                {editDraft.type === "QUIZ" && (
                                  <input
                                    type="radio"
                                    name={`e-${t.id}`}
                                    checked={editDraft.correctOptionId === i}
                                    onChange={() => setEditDraft(d => ({ ...d, correctOptionId: i }))}
                                    title="Mark as correct answer"
                                  />
                                )}
                                <span style={{ fontSize: "0.78rem", fontWeight: 600, color: "var(--clr-text-muted)", width: 18 }}>
                                  {String.fromCharCode(65 + i)}.
                                </span>
                                <div style={{ flex: 1, position: "relative", display: "flex", alignItems: "center" }}>
                                  <input
                                    className="input"
                                    value={opt}
                                    style={{
                                      width: "100%",
                                      borderColor: isDupe || isOver ? "var(--clr-danger)" : undefined,
                                      paddingRight: opt.length > 70 ? 45 : undefined,
                                    }}
                                    onChange={e => updateOpt(i, e.target.value)}
                                  />
                                  {opt.length > 70 && (
                                    <span style={{ position: "absolute", right: 8, fontSize: "0.68rem", color: isOver ? "var(--clr-danger)" : "var(--clr-text-muted)" }}>
                                      {opt.length}/100
                                    </span>
                                  )}
                                </div>
                                {rawOpts.length > 2 && (
                                  <button
                                    className="btn btn-ghost btn-sm"
                                    style={{ color: "var(--clr-danger)", padding: "0 6px" }}
                                    title="Remove option"
                                    onClick={() => {
                                      const curOpts = editDraft.options || [];
                                      const newOpts = curOpts.filter((_, j) => j !== i);
                                      const curCorrect = editDraft.correctOptionId ?? 0;
                                      let newCorrect = curCorrect;
                                      if (curCorrect === i) {
                                        newCorrect = 0;
                                      } else if (curCorrect > i) {
                                        newCorrect = curCorrect - 1;
                                      }
                                      newCorrect = Math.max(0, Math.min(newCorrect, newOpts.length - 1));
                                      setEditDraft(d => ({
                                        ...d,
                                        options: newOpts,
                                        correctOptionId: editDraft.type === "QUIZ" ? newCorrect : null,
                                      }));
                                    }}
                                  >
                                    ✕
                                  </button>
                                )}
                              </div>
                            );
                          });
                        })()}
                        {(editDraft.options || []).length < 10 && (
                          <button
                            className="btn btn-ghost btn-sm"
                            style={{ alignSelf: "flex-start" }}
                            onClick={() => setEditDraft(d => ({ ...d, options: [...(d.options || []), ""] }))}
                          >
                            + Option
                          </button>
                        )}
                      </div>
                    </div>

                    {/* Explanation (Quiz only in Telegram) */}
                    {editDraft.type === "QUIZ" && (
                      <div>
                        <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 3 }}>
                          <label className="input-label" style={{ margin: 0 }}>💡 Explanation (optional)</label>
                          <span style={{ fontSize: "0.72rem", color: (editDraft.explanation || "").trim().length > 200 ? "var(--clr-danger)" : "var(--clr-text-muted)" }}>
                            {(editDraft.explanation || "").trim().length}/200
                          </span>
                        </div>
                        <input
                          className="input"
                          placeholder="Shown when answer is revealed (max 200 chars)"
                          value={editDraft.explanation || ""}
                          style={{ borderColor: (editDraft.explanation || "").trim().length > 200 ? "var(--clr-danger)" : undefined }}
                          onChange={e => setEditDraft(d => ({ ...d, explanation: e.target.value }))}
                        />
                      </div>
                    )}

                    {/* Tags */}
                    <div>
                      <label className="input-label" style={{ marginBottom: 3 }}>Tags</label>
                      <input
                        className="input"
                        placeholder="e.g. math, algebra, chapter1 (comma-separated)"
                        value={(editDraft.tags || []).join(", ")}
                        onChange={e =>
                          setEditDraft(d => ({
                            ...d,
                            tags: e.target.value.split(",").map(x => x.trim()).filter(Boolean),
                          }))
                        }
                      />
                    </div>

                    {/* Forum Topic */}
                    <div>
                      <label className="input-label" style={{ marginBottom: 3 }}>Forum Topic</label>
                      <select
                        className="select"
                        value={editDraft.topicId !== undefined && editDraft.topicId !== null ? editDraft.topicId : ""}
                        onChange={e => {
                          const val = e.target.value;
                          const found = topics.find(tp => tp.message_thread_id === Number(val));
                          setEditDraft(d => ({
                            ...d,
                            topicId: val ? Number(val) : null,
                            topicName: found?.name || null,
                          }));
                        }}
                      >
                        <option value="">📌 General (Main chat)</option>
                        {topics.map(tp => (
                          <option key={tp.message_thread_id} value={tp.message_thread_id}>
                            📂 {tp.name}
                          </option>
                        ))}
                      </select>
                    </div>

                    {/* Categories / Collections */}
                    <div>
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
                        <label className="input-label" style={{ margin: 0 }}>Categories / Collections</label>
                        <button
                          type="button"
                          className="btn btn-ghost btn-sm"
                          style={{ fontSize: "0.72rem", padding: "1px 6px" }}
                          onClick={() => { setShowNewColl(true); setCollForm({ name: "", emoji: "📁", color: "#6366f1" }); }}
                        >
                          + New Collection
                        </button>
                      </div>
                      {collections.length === 0 ? (
                        <div style={{ fontSize: "0.75rem", color: "var(--clr-text-muted)" }}>No collections created yet.</div>
                      ) : (
                        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                          {collections.map(c => {
                            const isAssigned = (editDraft.collectionIds || []).includes(c.id);
                            return (
                              <button
                                key={c.id}
                                type="button"
                                onClick={() => {
                                  setEditDraft(d => {
                                    const cur = d.collectionIds || [];
                                    const next = isAssigned ? cur.filter(id => id !== c.id) : [...cur, c.id];
                                    return { ...d, collectionIds: next };
                                  });
                                }}
                                className="btn btn-sm"
                                style={{
                                  fontSize: "0.74rem",
                                  padding: "3px 8px",
                                  height: "auto",
                                  borderRadius: "var(--radius-sm)",
                                  background: isAssigned ? c.color + "33" : "var(--clr-bg-surface)",
                                  border: `1px solid ${isAssigned ? c.color : "var(--clr-border)"}`,
                                  color: isAssigned ? c.color : "var(--clr-text-muted)",
                                  fontWeight: isAssigned ? 600 : 400,
                                }}
                              >
                                {isAssigned ? "✓ " : ""}{c.emoji} {c.name}
                              </button>
                            );
                          })}
                        </div>
                      )}
                    </div>

                    {/* Grid: Type + openPeriod */}
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                      <div>
                        <label className="input-label">Type</label>
                        <select
                          className="select"
                          value={editDraft.type}
                          onChange={e => {
                            const newType = e.target.value as "QUIZ" | "POLL";
                            setEditDraft(d => ({
                              ...d,
                              type: newType,
                              correctOptionId: newType === "POLL" ? null : (d.correctOptionId ?? 0),
                              allowsMultiple: newType === "POLL" ? d.allowsMultiple : false,
                              allowAddingOptions: newType === "POLL" ? d.allowAddingOptions : false,
                              allowRevoting: newType === "POLL" ? d.allowRevoting : false,
                            }));
                          }}
                        >
                          <option value="QUIZ">Quiz (has correct answer)</option>
                          <option value="POLL">Poll (open vote)</option>
                        </select>
                      </div>
                      <div>
                        <label className="input-label">⏱ Auto-close (Telegram 5s–10m)</label>
                        <select
                          className="select"
                          value={editDraft.openPeriod ?? 0}
                          onChange={e => setEditDraft(d => ({ ...d, openPeriod: Number(e.target.value) || null }))}
                        >
                          <option value={0}>No limit</option>
                          <option value={15}>15 seconds</option>
                          <option value={30}>30 seconds</option>
                          <option value={45}>45 seconds</option>
                          <option value={60}>1 minute</option>
                          <option value={120}>2 minutes</option>
                          <option value={300}>5 minutes</option>
                          <option value={600}>10 minutes (Telegram max)</option>
                        </select>
                      </div>
                    </div>

                    {/* Toggle row */}
                    <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                      <button
                        title="Hide voter names"
                        onClick={() => setEditDraft(d => ({ ...d, isAnonymous: !d.isAnonymous }))}
                        className="btn btn-ghost btn-sm"
                        style={{
                          border: `1px solid ${editDraft.isAnonymous ? "var(--clr-brand)" : "var(--clr-border)"}`,
                          color: editDraft.isAnonymous ? "var(--clr-brand)" : "var(--clr-text-muted)",
                          fontSize: "0.75rem",
                        }}
                      >
                        🔒 Anonymous
                      </button>

                      {editDraft.type === "POLL" && (
                        <>
                          <button
                            title="Allow multiple selections"
                            onClick={() => setEditDraft(d => ({ ...d, allowsMultiple: !d.allowsMultiple }))}
                            className="btn btn-ghost btn-sm"
                            style={{
                              border: `1px solid ${editDraft.allowsMultiple ? "var(--clr-brand)" : "var(--clr-border)"}`,
                              color: editDraft.allowsMultiple ? "var(--clr-brand)" : "var(--clr-text-muted)",
                              fontSize: "0.75rem",
                            }}
                          >
                            ☑ Multi-answer
                          </button>
                          <button
                            title="Voters can suggest options"
                            onClick={() => setEditDraft(d => ({ ...d, allowAddingOptions: !d.allowAddingOptions }))}
                            className="btn btn-ghost btn-sm"
                            style={{
                              border: `1px solid ${editDraft.allowAddingOptions ? "var(--clr-brand)" : "var(--clr-border)"}`,
                              color: editDraft.allowAddingOptions ? "var(--clr-brand)" : "var(--clr-text-muted)",
                              fontSize: "0.75rem",
                            }}
                          >
                            ✍ Add options
                          </button>
                          <button
                            title="Voters can change answer"
                            onClick={() => setEditDraft(d => ({ ...d, allowRevoting: !d.allowRevoting }))}
                            className="btn btn-ghost btn-sm"
                            style={{
                              border: `1px solid ${editDraft.allowRevoting ? "var(--clr-brand)" : "var(--clr-border)"}`,
                              color: editDraft.allowRevoting ? "var(--clr-brand)" : "var(--clr-text-muted)",
                              fontSize: "0.75rem",
                            }}
                          >
                            ↩ Revoting
                          </button>
                        </>
                      )}
                    </div>
                  </div>
                ) : (
                  /* View mode */
                  <>
                    <div style={{ fontWeight: 500, marginBottom: 10, lineHeight: 1.5, wordBreak: "break-word", fontSize: "0.92rem" }}>{t.question}</div>
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6 }}>
                      {t.options.map((o, i) => (
                        <div key={i} style={{
                          padding: "6px 12px", borderRadius: "var(--radius-sm)", fontSize: "0.82rem",
                          display: "flex", alignItems: "center", gap: 8,
                          background: t.correctOptionId === i ? "var(--clr-success-muted)" : "var(--clr-bg-elevated)",
                          border: `1px solid ${t.correctOptionId === i ? "var(--clr-success)" : "var(--clr-border)"}`,
                          color: t.correctOptionId === i ? "var(--clr-success)" : "var(--clr-text-secondary)",
                          transition: "all 0.15s",
                        }}>
                          <span style={{
                            width: 22, height: 22, borderRadius: "var(--radius-full)",
                            display: "flex", alignItems: "center", justifyContent: "center",
                            fontSize: "0.72rem", fontWeight: 700, flexShrink: 0,
                            background: t.correctOptionId === i ? "var(--clr-success)" : "var(--clr-bg-hover)",
                            color: t.correctOptionId === i ? "white" : "var(--clr-text-muted)",
                          }}>
                            {String.fromCharCode(65 + i)}
                          </span>
                          <span style={{ flex: 1 }}>{o}</span>
                          {t.correctOptionId === i && <span style={{ fontSize: "0.72rem" }}>✓</span>}
                        </div>
                      ))}
                    </div>
                    {t.explanation && (
                      <div style={{ marginTop: 10, fontSize: "0.78rem", color: "var(--clr-text-muted)", padding: "8px 12px", background: "var(--clr-bg-elevated)", borderRadius: "var(--radius-sm)", borderLeft: "3px solid var(--clr-brand)" }}>
                        💡 {t.explanation}
                      </div>
                    )}
                    <div style={{ marginTop: 10 }} onClick={e => e.stopPropagation()}>
                      <select
                        className="select"
                        style={{ fontSize: "0.75rem", padding: "3px 8px", height: 28, width: "100%", maxWidth: 240 }}
                        value={perQuizTopic[t.id] !== undefined ? perQuizTopic[t.id] : (t.topicId !== undefined && t.topicId !== null ? t.topicId : sendTopicId)}
                        onChange={e => setPerQuizTopic(prev => ({ ...prev, [t.id]: e.target.value ? Number(e.target.value) : "" }))}
                      >
                        <option value="">📌 General {t.topicId === null || t.topicId === undefined ? "(default)" : ""}</option>
                        {topics.map(tp => <option key={tp.message_thread_id} value={tp.message_thread_id}>📂 {tp.name} {t.topicId === tp.message_thread_id ? "(saved)" : ""}</option>)}
                      </select>
                    </div>
                    <div style={{ marginTop: 8, display: "flex", gap: 8, flexWrap: "wrap", fontSize: "0.73rem", color: "var(--clr-text-muted)", alignItems: "center", paddingTop: 8, borderTop: "1px solid var(--clr-border)" }}>
                      {t.isAnonymous && <span style={{ display: "inline-flex", alignItems: "center", gap: 3, padding: "2px 8px", borderRadius: 20, background: "var(--clr-bg-elevated)" }}>🔒 Anon</span>}
                      {t.openPeriod ? <span style={{ display: "inline-flex", alignItems: "center", gap: 3, padding: "2px 8px", borderRadius: 20, background: "var(--clr-bg-elevated)" }}>⏱ {t.openPeriod}s</span> : null}
                      {t.allowsMultiple && <span style={{ display: "inline-flex", alignItems: "center", gap: 3, padding: "2px 8px", borderRadius: 20, background: "var(--clr-bg-elevated)" }}>☑ Multi</span>}
                      {t.topicName && <span style={{ display: "inline-flex", alignItems: "center", gap: 3, padding: "2px 8px", borderRadius: 20, background: "var(--clr-bg-elevated)" }}>📂 {t.topicName}</span>}
                      {/* Collection badges */}
                      {t.collectionIds && t.collectionIds.length > 0 && t.collectionIds.map(cid => {
                        const col = collections.find(c => c.id === cid);
                        if (!col) return null;
                        return (
                          <span key={cid} style={{ display: "inline-flex", alignItems: "center", gap: 3, padding: "2px 8px", borderRadius: 20, background: col.color + "22", color: col.color, border: `1px solid ${col.color}44`, fontSize: "0.68rem", fontWeight: 500 }}>
                            {col.emoji} {col.name}
                            {activeCollection === cid && (
                              <button onClick={e => { e.stopPropagation(); removeFromCollection(t.id, cid); }}
                                style={{ background: "none", border: "none", cursor: "pointer", color: col.color, padding: "0 0 0 2px", lineHeight: 1, fontSize: "0.65rem" }} title="Remove from collection">✕</button>
                            )}
                          </span>
                        );
                      })}
                      <span style={{ marginLeft: "auto" }} title={new Date(t.createdAt).toLocaleString()}>🕐 {timeAgo(t.createdAt)}</span>
                    </div>
                  </>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* ── Floating selection bar ── */}
      {visibleSelected.length > 0 && !progress?.active && (
        <div style={{
          position: "fixed",
          bottom: 24,
          left: "50%",
          transform: "translateX(-50%)",
          zIndex: 900,
          background: "var(--clr-bg-card)",
          border: "1px solid var(--clr-brand)",
          boxShadow: "0 16px 40px rgba(0, 0, 0, 0.5), 0 0 0 1px var(--clr-brand)",
          borderRadius: "var(--radius-full)",
          padding: "8px 16px",
          display: "flex",
          alignItems: "center",
          gap: 10,
          backdropFilter: "blur(16px)",
          WebkitBackdropFilter: "blur(16px)",
          animation: "fadeUp 0.25s ease-out",
        }}>
          <span style={{ fontWeight: 600, fontSize: "0.85rem", color: "var(--clr-text-primary)", display: "flex", alignItems: "center", gap: 6, whiteSpace: "nowrap" }}>
            <span style={{ width: 22, height: 22, borderRadius: "50%", background: "var(--clr-brand)", color: "white", display: "inline-flex", alignItems: "center", justifyContent: "center", fontSize: "0.75rem", fontWeight: 700 }}>
              {visibleSelected.length}
            </span>
            <span>selected</span>
          </span>
          <div style={{ width: 1, height: 18, background: "var(--clr-border)" }} />
          <button className="btn btn-ghost btn-sm" style={{ fontSize: "0.8rem", padding: "4px 10px", whiteSpace: "nowrap" }} onClick={() => setShowAddToColl(true)}>
            📁 Collection
          </button>
          <button className="btn btn-ghost btn-sm" style={{ color: "var(--clr-danger)", fontSize: "0.8rem", padding: "4px 10px", whiteSpace: "nowrap" }} onClick={deleteSelected}>
            🗑 Delete
          </button>
          <button className="btn btn-primary btn-sm" style={{ fontSize: "0.8rem", padding: "5px 16px", borderRadius: "var(--radius-full)", whiteSpace: "nowrap" }} onClick={handleSendSelected}>
            🚀 Send {visibleSelected.length}
          </button>
          <button className="btn btn-ghost btn-sm" style={{ fontSize: "0.75rem", padding: "2px 6px", color: "var(--clr-text-muted)" }} onClick={selectNone} title="Deselect all">
            ✕
          </button>
        </div>
      )}
    </div>
  );
}
