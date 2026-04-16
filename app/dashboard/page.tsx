"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

interface Group {
  id: string;
  chatId: string;
  title: string;
  username?: string;
  photoUrl?: string;
  isForum: boolean;
  quizCount: number;
  role: string;
}

function AddGroupModal({ onClose, onAdd }: { onClose: () => void; onAdd: (g: Group) => void }) {
  const [chatId, setChatId] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [devWarning, setDevWarning] = useState("");

  const BOT = process.env.NEXT_PUBLIC_BOT_USERNAME || "agridmu_bot";

  const handleAdd = async () => {
    setError("");
    setDevWarning("");
    setLoading(true);
    try {
      const res = await fetch("/api/groups", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chatId: chatId.trim() }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to add group");
      if (data.devWarning) setDevWarning(data.devWarning);
      onAdd(data.group);
      if (!data.devWarning) onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unknown error");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{
      position: "fixed", inset: 0, zIndex: 100,
      background: "rgba(0,0,0,0.7)", backdropFilter: "blur(8px)",
      display: "flex", alignItems: "center", justifyContent: "center", padding: "var(--space-6)"
    }}>
      <div className="card" style={{ width: "100%", maxWidth: 500, animation: "fadeUp 0.3s var(--ease-out)" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "var(--space-6)" }}>
          <h3>Add Your Group</h3>
          <button className="btn btn-ghost btn-icon" onClick={onClose}>✕</button>
        </div>

        {/* Steps */}
        <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-3)", marginBottom: "var(--space-5)" }}>
          {[
            { step: "1", text: <>Add <code style={{ background: "rgba(79,127,255,0.2)", padding: "2px 6px", borderRadius: 4 }}>@{BOT}</code> to your Telegram group</> },
            { step: "2", text: <>Give it <strong>Admin</strong> rights (so it can send messages)</> },
            { step: "3", text: <>Paste the Group Chat ID below and hit Add</> },
          ].map(({ step, text }) => (
            <div key={step} style={{ display: "flex", gap: "var(--space-3)", alignItems: "flex-start" }}>
              <div style={{ width: 24, height: 24, borderRadius: "50%", background: "var(--clr-brand-muted)", border: "1px solid var(--clr-brand)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: "0.75rem", fontWeight: 700, color: "var(--clr-brand)", flexShrink: 0 }}>{step}</div>
              <p style={{ color: "var(--clr-text-secondary)", fontSize: "0.875rem", margin: 0, paddingTop: 3 }}>{text}</p>
            </div>
          ))}
        </div>

        <div className="input-wrapper" style={{ marginBottom: "var(--space-4)" }}>
          <label className="input-label">Telegram Group Chat ID</label>
          <input
            className="input"
            placeholder="-1001234567890"
            value={chatId}
            onChange={(e) => setChatId(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleAdd()}
          />
          <p style={{ fontSize: "0.78rem", color: "var(--clr-text-muted)", marginTop: 6 }}>
            Forward any group message to <strong>@userinfobot</strong> on Telegram to get the Chat ID instantly.
          </p>
        </div>

        {error && (
          <div style={{ background: "var(--clr-danger-muted)", border: "1px solid rgba(248,113,113,0.3)", borderRadius: "var(--radius-md)", padding: "var(--space-3)", marginBottom: "var(--space-4)", color: "var(--clr-danger)", fontSize: "0.875rem" }}>
            ❌ {error}
          </div>
        )}

        {devWarning && (
          <div style={{ background: "rgba(251,191,36,0.1)", border: "1px solid rgba(251,191,36,0.4)", borderRadius: "var(--radius-md)", padding: "var(--space-3)", marginBottom: "var(--space-4)", color: "#fbbf24", fontSize: "0.85rem" }}>
            {devWarning}
            <br /><br />
            <button className="btn btn-primary btn-sm" onClick={onClose}>Continue to Dashboard →</button>
          </div>
        )}

        {!devWarning && (
          <div style={{ display: "flex", gap: "var(--space-3)", justifyContent: "flex-end" }}>
            <button className="btn btn-secondary" onClick={onClose}>Cancel</button>
            <button className="btn btn-primary" onClick={handleAdd} disabled={!chatId.trim() || loading}>
              {loading ? (
                <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ animation: "spin 1s linear infinite" }}>
                    <path d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z" opacity="0.25"/><path d="M21 12a9 9 0 00-9-9"/>
                  </svg>
                  Verifying…
                </span>
              ) : "Add Group"}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

export default function DashboardPage() {
  const [groups, setGroups] = useState<Group[]>([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [manageMode, setManageMode] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [confirmGroup, setConfirmGroup] = useState<Group | null>(null);
  const [user, setUser] = useState<{ firstName: string } | null>(null);

  useEffect(() => {
    Promise.all([
      fetch("/api/groups").then((r) => r.json()),
      fetch("/api/auth/me").then((r) => r.json()),
    ]).then(([groupsData, userData]) => {
      setGroups(groupsData.groups || []);
      setUser(userData.user);
      setLoading(false);
    }).catch(() => setLoading(false));
  }, []);

  const handleDeleteGroup = async (group: Group, deleteAll: boolean) => {
    setDeletingId(group.id);
    try {
      const res = await fetch(`/api/groups/${group.id}`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ deleteGroup: deleteAll }),
      });
      if (res.ok) {
        setGroups(prev => prev.filter(g => g.id !== group.id));
        setConfirmGroup(null);
      } else {
        const d = await res.json();
        alert(d.error || "Failed to remove group");
      }
    } finally {
      setDeletingId(null);
    }
  };

  const roleColor: Record<string, string> = {
    OWNER: "var(--clr-warning)",
    ADMIN: "var(--clr-brand)",
    VIEWER: "var(--clr-text-muted)",
  };

  return (
    <div>
      {/* Page header */}
      <div className="section-header animate-fade-up">
        <div>
          <h1>My Groups</h1>
          {user && <p style={{ marginTop: 4 }}>Welcome back, <strong style={{ color: "var(--clr-text-primary)" }}>{user.firstName}</strong></p>}
        </div>
        <div style={{ display: "flex", gap: "var(--space-2)" }}>
          {groups.length > 0 && (
            <button
              className={`btn ${manageMode ? "btn-danger" : "btn-ghost"} btn-sm`}
              onClick={() => setManageMode(!manageMode)}
            >
              {manageMode ? "✕ Done" : "⚙ Manage"}
            </button>
          )}
          <button className="btn btn-primary" onClick={() => setShowModal(true)}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M12 5v14M5 12h14"/>
            </svg>
            Add Group
          </button>
        </div>
      </div>

      {/* Groups grid */}
      {loading ? (
        <div className="group-grid">
          {[1,2,3].map((i) => (
            <div key={i} className="group-card" style={{ cursor: "default" }}>
              <div className="skeleton" style={{ height: 48, width: 48, borderRadius: "50%" }} />
              <div>
                <div className="skeleton" style={{ height: 20, width: "60%", marginBottom: 8 }} />
                <div className="skeleton" style={{ height: 14, width: "40%" }} />
              </div>
            </div>
          ))}
        </div>
      ) : groups.length === 0 ? (
        <div className="empty-state animate-fade-up">
          <div className="empty-state-icon">
            <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
              <path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2M23 21v-2a4 4 0 00-3-3.87M16 3.13a4 4 0 010 7.75M9 7a4 4 0 100 8 4 4 0 000-8z"/>
            </svg>
          </div>
          <h3>No groups yet</h3>
          <p>Add your first Telegram group to start creating quizzes</p>
          <button className="btn btn-primary" onClick={() => setShowModal(true)}>
            Add Your First Group
          </button>
        </div>
      ) : (
        <div className="group-grid animate-fade-up">
          {groups.map((group, i) => (
            <div key={group.id} style={{ position: "relative" }}>
              <Link
                href={manageMode ? "#" : `/dashboard/${group.id}`}
                className="group-card"
                style={{ animationDelay: `${i * 0.05}s`, opacity: manageMode ? 0.7 : 1, pointerEvents: manageMode ? "none" : "auto" }}
                onClick={e => manageMode && e.preventDefault()}
              >
                {/* Group avatar */}
                <div style={{ display: "flex", alignItems: "center", gap: "var(--space-4)" }}>
                  <div className="avatar lg" style={{ flexShrink: 0, background: group.photoUrl ? "transparent" : "var(--grad-brand)" }}>
                    {group.photoUrl ? (
                      <img src={group.photoUrl} alt={group.title} />
                    ) : (
                      group.title.charAt(0).toUpperCase()
                    )}
                  </div>
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <div style={{ fontFamily: "var(--font-display)", fontWeight: 700, fontSize: "1rem", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {group.title}
                    </div>
                    {group.username && (
                      <div style={{ color: "var(--clr-text-muted)", fontSize: "0.8rem" }}>@{group.username}</div>
                    )}
                  </div>
                </div>

                {/* Badges */}
                <div style={{ display: "flex", gap: "var(--space-2)", flexWrap: "wrap" }}>
                  <span className="badge badge-brand" style={{ color: roleColor[group.role] }}>
                    {group.role}
                  </span>
                  {group.isForum && (
                    <span className="badge badge-accent">Topics</span>
                  )}
                  <span style={{ fontSize: "0.75rem", color: "var(--clr-text-muted)", marginLeft: "auto" }}>
                    {group.quizCount} quizzes
                  </span>
                </div>

                {/* Stats */}
                <div style={{ display: "flex", gap: "var(--space-4)", paddingTop: "var(--space-3)", borderTop: "1px solid var(--clr-border)" }}>
                  <div style={{ fontFamily: "var(--font-display)", fontWeight: 700, fontSize: "1.25rem", color: "var(--clr-text-primary)" }}>
                    {group.quizCount}
                  </div>
                  <div style={{ fontSize: "0.75rem", color: "var(--clr-text-muted)", paddingTop: 6 }}>Quizzes sent</div>
                  {!manageMode && (
                    <div style={{ marginLeft: "auto", display: "flex", alignItems: "flex-end" }}>
                      <span style={{ color: "var(--clr-brand)", fontSize: "0.8rem", fontWeight: 600 }}>Open dashboard →</span>
                    </div>
                  )}
                </div>
              </Link>

              {/* Manage Mode Controls */}
              {manageMode && (
                <div style={{
                  position: "absolute", inset: 0, borderRadius: "var(--radius-lg)",
                  display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
                  gap: "var(--space-3)", background: "rgba(10,14,26,0.85)", backdropFilter: "blur(4px)",
                  zIndex: 2,
                }}>
                  <div style={{ fontWeight: 700, color: "white", fontSize: "0.95rem", textAlign: "center" }}>{group.title}</div>
                  <Link
                    href={`/dashboard/${group.id}`}
                    className="btn btn-secondary btn-sm"
                    onClick={() => setManageMode(false)}
                  >
                    ⚙ Open Settings
                  </Link>
                  <button
                    className="btn btn-sm"
                    style={{ background: "rgba(248,113,113,0.18)", color: "var(--clr-danger)", border: "1px solid rgba(248,113,113,0.35)" }}
                    onClick={() => setConfirmGroup(group)}
                    disabled={deletingId === group.id}
                  >
                    {deletingId === group.id ? "Removing..." : group.role === "OWNER" ? "🗑 Delete Group" : "🚪 Leave Group"}
                  </button>
                </div>
              )}
            </div>
          ))}

          {/* Add group card */}
          <button
            className="group-card"
            onClick={() => setShowModal(true)}
            style={{
              background: "transparent",
              border: "2px dashed var(--clr-border)",
              alignItems: "center",
              justifyContent: "center",
              minHeight: 160,
              cursor: "pointer",
              color: "var(--clr-text-muted)",
              flexDirection: "row",
              gap: "var(--space-3)",
            }}
          >
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M12 5v14M5 12h14"/>
            </svg>
            <span style={{ fontFamily: "var(--font-display)", fontWeight: 600 }}>Add Group</span>
          </button>
        </div>
      )}

      {/* Add Group Modal */}
      {showModal && (
        <AddGroupModal
          onClose={() => setShowModal(false)}
          onAdd={(g) => setGroups((prev) => [...prev, g as Group])}
        />
      )}

      {/* Delete/Leave Confirmation Modal */}
      {confirmGroup && (
        <div style={{
          position: "fixed", inset: 0, zIndex: 200,
          background: "rgba(0,0,0,0.8)", backdropFilter: "blur(8px)",
          display: "flex", alignItems: "center", justifyContent: "center", padding: "var(--space-6)",
        }}>
          <div className="card" style={{ maxWidth: 420, width: "100%", animation: "fadeUp 0.2s var(--ease-out)" }}>
            <h3 style={{ marginBottom: "var(--space-4)", color: "var(--clr-danger)" }}>
              {confirmGroup.role === "OWNER" ? "🗑 Delete Group" : "🚪 Leave Group"}
            </h3>
            <p style={{ color: "var(--clr-text-secondary)", marginBottom: "var(--space-5)" }}>
              {confirmGroup.role === "OWNER"
                ? <>Are you sure you want to <strong style={{ color: "var(--clr-danger)" }}>permanently delete</strong> <strong>{confirmGroup.title}</strong>? This will remove all quizzes, history, and settings. This cannot be undone.
                  <br/><br/>
                  <strong>You will still keep the Telegram group</strong> — only the QuizForge dashboard data is deleted.
                  </>
                : <>You will be removed from the <strong>{confirmGroup.title}</strong> dashboard. You can always re-add yourself later.</>
              }
            </p>
            <div style={{ display: "flex", gap: "var(--space-3)", justifyContent: "flex-end" }}>
              <button className="btn btn-secondary" onClick={() => setConfirmGroup(null)}>Cancel</button>
              {confirmGroup.role === "OWNER" && (
                <button
                  className="btn btn-ghost"
                  style={{ color: "var(--clr-text-muted)" }}
                  onClick={() => handleDeleteGroup(confirmGroup, false)}
                  disabled={!!deletingId}
                >
                  Just Leave
                </button>
              )}
              <button
                className="btn btn-primary"
                style={{ background: "var(--clr-danger)" }}
                onClick={() => handleDeleteGroup(confirmGroup, confirmGroup.role === "OWNER")}
                disabled={!!deletingId}
              >
                {deletingId ? "Working..." : confirmGroup.role === "OWNER" ? "Delete Everything" : "Leave Group"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
