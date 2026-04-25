"use client";

import { useEffect, useState, useCallback } from "react";
import { useParams } from "next/navigation";

interface Topic {
  message_thread_id: number;
  name: string;
  icon_color?: number;
  is_closed?: boolean;
}

export default function TopicsPage() {
  const params = useParams();
  const groupId = params.groupId as string;

  const [topics, setTopics] = useState<Topic[]>([]);
  const [loading, setLoading] = useState(true);
  const [fromCache, setFromCache] = useState(false);
  const [telegramError, setTelegramError] = useState<string | null>(null);

  const [newId, setNewId] = useState("");
  const [newName, setNewName] = useState("");
  const [adding, setAdding] = useState(false);
  const [toast, setToast] = useState<{ type: string; msg: string } | null>(null);

  const showToast = (type: string, msg: string) => {
    setToast({ type, msg });
    setTimeout(() => setToast(null), 4000);
  };

  const load = useCallback(() => {
    setLoading(true);
    fetch(`/api/groups/${groupId}/topics`)
      .then((r) => r.json())
      .then((d) => {
        setTopics(d.topics || []);
        setFromCache(d.fromCache || false);
        setTelegramError(d.telegramError || null);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, [groupId]);

  useEffect(() => { load(); }, [load]);

  const handleAdd = async () => {
    if (!newId || !newName.trim()) return;
    setAdding(true);
    try {
      const res = await fetch(`/api/groups/${groupId}/topics`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ topicId: Number(newId), name: newName.trim() }),
      });
      const data = await res.json();
      if (data.ok) {
        setNewId("");
        setNewName("");
        showToast("success", `Topic "${data.topic.name}" saved!`);
        load();
      } else {
        showToast("error", data.error || "Failed to add topic");
      }
    } finally {
      setAdding(false);
    }
  };

  const handleDelete = async (topic: Topic) => {
    if (!confirm(`Remove topic "${topic.name}" from QuizForge?\n(This does NOT delete it from Telegram)`)) return;
    await fetch(`/api/groups/${groupId}/topics`, {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ topicId: topic.message_thread_id }),
    });
    showToast("success", `"${topic.name}" removed`);
    load();
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
          <h1>Forum Topics</h1>
          <p>Manage which topics quizzes can be sent to</p>
        </div>
        <button className="btn btn-secondary" onClick={load} disabled={loading}>
          {loading ? "Refreshing…" : "↻ Refresh from Telegram"}
        </button>
      </div>

      {/* Status banner */}
      {telegramError && (
        <div className="card animate-fade-up animate-delay-1" style={{
          marginBottom: "var(--space-5)",
          background: "rgba(251,191,36,0.08)",
          border: "1px solid rgba(251,191,36,0.3)",
        }}>
          <div style={{ display: "flex", gap: "var(--space-3)", alignItems: "flex-start" }}>
            <span style={{ fontSize: "1.25rem" }}>⚠️</span>
            <div>
              <div style={{ fontWeight: 600, color: "#fbbf24", marginBottom: 4 }}>
                Telegram auto-fetch unavailable for this group
              </div>
              <div style={{ fontSize: "0.85rem", color: "var(--clr-text-muted)", lineHeight: 1.6 }}>
                This is a known Telegram API limitation for certain forum supergroups. 
                Add topics manually below — they&apos;ll be saved and available in Create Quiz immediately.
              </div>
              <div style={{ fontSize: "0.8rem", marginTop: 8, color: "var(--clr-text-muted)" }}>
                💡 <strong>How to find Topic ID:</strong> Open the topic in{" "}
                <a href="https://web.telegram.org" target="_blank" rel="noopener noreferrer" style={{ color: "var(--clr-accent)" }}>
                  Telegram Web
                </a>{" "}
                → the URL ends with <code style={{ background: "var(--clr-bg-hover)", padding: "1px 5px", borderRadius: 3 }}>/topic_id</code>
                {" "}(e.g. <code style={{ background: "var(--clr-bg-hover)", padding: "1px 5px", borderRadius: 3 }}>t.me/agricult1/3677</code> → ID is <strong>3677</strong>)
              </div>
            </div>
          </div>
        </div>
      )}

      {fromCache && !telegramError && (
        <div className="card animate-fade-up animate-delay-1" style={{
          marginBottom: "var(--space-5)",
          background: "rgba(99,102,241,0.08)",
          border: "1px solid rgba(99,102,241,0.2)",
          padding: "var(--space-3) var(--space-4)",
          fontSize: "0.85rem",
          color: "var(--clr-text-muted)",
        }}>
          ℹ️ Showing topics from cache — click <strong>↻ Refresh</strong> to sync with Telegram
        </div>
      )}

      {/* Add topic form */}
      <div className="card animate-fade-up animate-delay-2" style={{ marginBottom: "var(--space-5)" }}>
        <h4 style={{ marginBottom: "var(--space-4)" }}>➕ Add Topic Manually</h4>
        <div style={{ display: "grid", gridTemplateColumns: "120px 1fr auto", gap: "var(--space-3)", alignItems: "end" }}>
          <div className="input-wrapper" style={{ marginBottom: 0 }}>
            <label className="input-label">Topic ID</label>
            <input
              className="input"
              type="number"
              placeholder="3677"
              value={newId}
              onChange={(e) => setNewId(e.target.value.replace(/\D/g, ""))}
              onKeyDown={(e) => e.key === "Enter" && handleAdd()}
            />
          </div>
          <div className="input-wrapper" style={{ marginBottom: 0 }}>
            <label className="input-label">Topic Name</label>
            <input
              className="input"
              placeholder="e.g. علم الحيوان"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleAdd()}
            />
          </div>
          <button
            className="btn btn-primary"
            onClick={handleAdd}
            disabled={adding || !newId || !newName.trim()}
            style={{ marginBottom: 0 }}
          >
            {adding ? "Saving…" : "Save Topic"}
          </button>
        </div>
      </div>

      {/* Topics list */}
      {loading ? (
        <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-3)" }}>
          {[1,2,3].map((i) => <div key={i} className="skeleton" style={{ height: 60, borderRadius: "var(--radius-md)" }} />)}
        </div>
      ) : topics.length === 0 ? (
        <div className="empty-state animate-fade-up animate-delay-3">
          <div className="empty-state-icon">💬</div>
          <h3>No topics yet</h3>
          <p>Add topics manually above to start sending quizzes to specific forum threads</p>
        </div>
      ) : (
        <div className="card animate-fade-up animate-delay-3">
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "var(--space-4)" }}>
            <h4 style={{ margin: 0 }}>{topics.length} topic{topics.length !== 1 ? "s" : ""}</h4>
            <span style={{ fontSize: "0.8rem", color: "var(--clr-text-muted)" }}>
              {fromCache ? "📦 From cache" : "✅ Live from Telegram"}
            </span>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-2)" }}>
            {topics.map((topic) => (
              <div key={topic.message_thread_id} style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                padding: "var(--space-3) var(--space-4)",
                background: "var(--clr-bg-elevated)",
                borderRadius: "var(--radius-md)",
                border: "1px solid var(--clr-border)",
              }}>
                <div style={{ display: "flex", alignItems: "center", gap: "var(--space-3)" }}>
                  {topic.is_closed ? (
                    <span title="Closed">🔒</span>
                  ) : (
                    <span style={{
                      width: 10, height: 10, borderRadius: "50%",
                      background: topic.icon_color ? `#${topic.icon_color.toString(16).padStart(6, "0")}` : "var(--clr-accent)",
                      display: "inline-block", flexShrink: 0,
                    }} />
                  )}
                  <div>
                    <div style={{ fontWeight: 500 }}>{topic.name}</div>
                    <div style={{ fontSize: "0.75rem", color: "var(--clr-text-muted)" }}>
                      ID: {topic.message_thread_id}
                    </div>
                  </div>
                </div>
                <button
                  className="btn btn-ghost btn-sm"
                  title="Remove from QuizForge"
                  style={{ color: "var(--clr-danger)" }}
                  onClick={() => handleDelete(topic)}
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6M14 11v6"/><path d="M9 6V4h6v2"/>
                  </svg>
                </button>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
