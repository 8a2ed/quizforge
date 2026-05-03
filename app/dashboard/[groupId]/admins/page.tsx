"use client";

import { useEffect, useState, useCallback } from "react";
import { useParams } from "next/navigation";

interface Admin {
  telegramId: string | null;
  firstName: string;
  username: string | null;
  telegramStatus: string | null;
  inDashboard: boolean;
  dashboardRole: string | null;
  approved: boolean | null;
  userId: string | null;
  source: "telegram" | "dashboard";
}

export default function AdminsPage() {
  const params = useParams();
  const groupId = params.groupId as string;

  const [admins, setAdmins] = useState<Admin[]>([]);
  const [loading, setLoading] = useState(true);
  const [groupTitle, setGroupTitle] = useState("");
  const [inviteUsername, setInviteUsername] = useState("");
  const [inviting, setInviting] = useState(false);
  const [inviteMsg, setInviteMsg] = useState<{ type: "success" | "error"; text: string } | null>(null);
  const [toast, setToast] = useState<{ type: string; msg: string } | null>(null);
  const [search, setSearch] = useState("");

  const showToast = (type: string, msg: string) => {
    setToast({ type, msg });
    setTimeout(() => setToast(null), 4000);
  };

  const load = useCallback(() => {
    setLoading(true);
    fetch(`/api/groups/${groupId}/admins`)
      .then(r => r.json())
      .then(d => { setAdmins(d.admins || []); setGroupTitle(d.groupTitle || ""); setLoading(false); })
      .catch(() => setLoading(false));
  }, [groupId]);

  useEffect(() => { load(); }, [load]);

  const handleToggle = async (admin: Admin, approved: boolean) => {
    if (!admin.userId) return showToast("info", "User hasn't logged in yet");
    const res = await fetch(`/api/groups/${groupId}/admins`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ targetUserId: admin.userId, approved }),
    });
    if (res.ok) {
      setAdmins(prev => prev.map(a =>
        (a.userId === admin.userId || a.telegramId === admin.telegramId) ? { ...a, approved } : a
      ));
      showToast("success", approved ? `✓ ${admin.firstName} can now access the dashboard` : `${admin.firstName}'s access revoked`);
    }
  };

  const handleRemove = async (admin: Admin) => {
    if (!admin.userId) return;
    if (!confirm(`Remove ${admin.firstName} from this group?`)) return;
    const res = await fetch(`/api/groups/${groupId}/admins`, {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ targetUserId: admin.userId }),
    });
    if (res.ok) {
      setAdmins(prev => prev.filter(a => a.userId !== admin.userId));
      showToast("success", `${admin.firstName} removed`);
    }
  };

  const handleInvite = async (e: React.FormEvent) => {
    e.preventDefault();
    setInviteMsg(null);
    setInviting(true);
    try {
      const res = await fetch(`/api/groups/${groupId}/admins`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ telegramUsername: inviteUsername.replace(/^@/, "") }),
      });
      const data = await res.json();
      if (data.ok) {
        setInviteUsername("");
        setInviteMsg({ type: "success", text: data.restored ? `✓ ${data.user.firstName}'s access restored!` : `✓ ${data.user.firstName} added as Admin!` });
        load();
      } else if (res.status === 409 && data.alreadyMember) {
        setInviteMsg({ type: "success", text: `ℹ️ ${data.error} They already have full access.` });
        load();
      } else {
        setInviteMsg({ type: "error", text: data.error || "Failed to add user" });
      }
    } catch {
      setInviteMsg({ type: "error", text: "Network error" });
    } finally {
      setInviting(false);
    }
  };

  const filtered = admins.filter(a =>
    !search ||
    a.firstName.toLowerCase().includes(search.toLowerCase()) ||
    (a.username && a.username.toLowerCase().includes(search.toLowerCase()))
  );

  const statusPriority: Record<string, number> = { creator: 0, administrator: 1 };
  const sorted = [...filtered].sort((a, b) => {
    const pa = statusPriority[a.telegramStatus || ""] ?? 2;
    const pb = statusPriority[b.telegramStatus || ""] ?? 2;
    return pa - pb;
  });

  const roleColor: Record<string, { bg: string; text: string; label: string }> = {
    creator:       { bg: "rgba(251,191,36,0.12)",  text: "#fbbf24",            label: "⭐ Owner"   },
    administrator: { bg: "rgba(99,102,241,0.12)",   text: "var(--clr-brand)",   label: "🛡 Admin"   },
  };

  const initials = (name: string) => name.split(" ").map(p => p[0]).join("").slice(0, 2).toUpperCase();

  const stats = {
    total:    admins.length,
    active:   admins.filter(a => a.approved && a.inDashboard).length,
    pending:  admins.filter(a => !a.inDashboard).length,
    revoked:  admins.filter(a => a.approved === false).length,
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
          <h1>Admin Management</h1>
          <p>Manage dashboard access for {groupTitle || "this group"}</p>
        </div>
        <button className="btn btn-secondary" onClick={load} disabled={loading}>
          {loading ? "…" : "↻ Refresh"}
        </button>
      </div>

      {/* Stats row */}
      <div className="animate-fade-up animate-delay-1" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(110px, 1fr))", gap: "var(--space-3)", marginBottom: "var(--space-5)" }}>
        {[
          { label: "Total", value: stats.total,   color: "var(--clr-text-primary)" },
          { label: "Active",  value: stats.active,  color: "var(--clr-success)" },
          { label: "Pending", value: stats.pending, color: "var(--clr-warning)" },
          { label: "Revoked", value: stats.revoked, color: "var(--clr-danger)" },
        ].map(s => (
          <div key={s.label} className="card" style={{ padding: "var(--space-3) var(--space-4)", textAlign: "center" }}>
            <div style={{ fontSize: "1.5rem", fontWeight: 800, color: s.color }}>{s.value}</div>
            <div style={{ fontSize: "0.75rem", color: "var(--clr-text-muted)", marginTop: 2 }}>{s.label}</div>
          </div>
        ))}
      </div>

      {/* Invite form */}
      <div className="card animate-fade-up animate-delay-1" style={{ marginBottom: "var(--space-5)" }}>
        <div style={{ display: "flex", gap: "var(--space-3)", alignItems: "center", marginBottom: "var(--space-4)", flexWrap: "wrap" }}>
          <div style={{ width: 36, height: 36, borderRadius: "var(--radius-md)", background: "var(--grad-brand)", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2"><path d="M16 21v-2a4 4 0 00-4-4H6a4 4 0 00-4 4v2M20 8v6M23 11h-6"/><circle cx="9" cy="7" r="4"/></svg>
          </div>
          <div>
            <h4 style={{ margin: 0, fontSize: "0.95rem" }}>Add Admin by Telegram Username</h4>
            <p style={{ margin: 0, fontSize: "0.78rem", color: "var(--clr-text-muted)" }}>
              Person must first log in at <strong>quiz.agridmulms.me/login</strong>
            </p>
          </div>
        </div>
        <form onSubmit={handleInvite} style={{ display: "flex", gap: "var(--space-3)", flexWrap: "wrap" }}>
          <div style={{ flex: 1, minWidth: 180, position: "relative" }}>
            <span style={{ position: "absolute", left: 12, top: "50%", transform: "translateY(-50%)", color: "var(--clr-text-muted)", pointerEvents: "none" }}>@</span>
            <input
              className="input"
              style={{ paddingLeft: 28 }}
              placeholder="username or first name"
              value={inviteUsername}
              onChange={e => { setInviteUsername(e.target.value); setInviteMsg(null); }}
            />
          </div>
          <button className="btn btn-primary" type="submit" disabled={inviting || !inviteUsername.trim()}>
            {inviting ? "Adding…" : "Add Admin"}
          </button>
        </form>
        {inviteMsg && (
          <div style={{
            marginTop: "var(--space-3)", padding: "var(--space-3)", borderRadius: "var(--radius-md)",
            background: inviteMsg.type === "success" ? "rgba(52,211,153,0.08)" : "rgba(248,113,113,0.08)",
            border: `1px solid ${inviteMsg.type === "success" ? "rgba(52,211,153,0.25)" : "rgba(248,113,113,0.25)"}`,
            fontSize: "0.85rem",
            color: inviteMsg.type === "success" ? "var(--clr-success)" : "var(--clr-danger)",
          }}>
            {inviteMsg.text}
          </div>
        )}
      </div>

      {/* Info card */}
      <div className="card animate-fade-up animate-delay-2" style={{ background: "var(--clr-brand-muted)", borderColor: "rgba(79,127,255,0.2)", marginBottom: "var(--space-5)", padding: "var(--space-3) var(--space-4)" }}>
        <div style={{ display: "flex", gap: "var(--space-3)", alignItems: "flex-start" }}>
          <span style={{ fontSize: "1.1rem", flexShrink: 0 }}>ℹ️</span>
          <div style={{ fontSize: "0.83rem", color: "var(--clr-text-secondary)", lineHeight: 1.7 }}>
            <strong>Two ways to give access:</strong><br />
            1. Telegram login → they log in at /login → you add them above.<br />
            2. Username &amp; Password → Instructors page → create credentials for them.
          </div>
        </div>
      </div>

      {/* Search */}
      {admins.length > 3 && (
        <div style={{ position: "relative", marginBottom: "var(--space-4)" }}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
            style={{ position: "absolute", left: 12, top: "50%", transform: "translateY(-50%)", color: "var(--clr-text-muted)", pointerEvents: "none" }}>
            <circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/>
          </svg>
          <input className="input" style={{ paddingLeft: 34 }} placeholder="Search admins…"
            value={search} onChange={e => setSearch(e.target.value)} />
        </div>
      )}

      {/* List */}
      {loading ? (
        <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-3)" }}>
          {[1,2,3].map(i => <div key={i} className="skeleton" style={{ height: 72, borderRadius: "var(--radius-md)" }} />)}
        </div>
      ) : sorted.length === 0 ? (
        <div className="empty-state animate-fade-up animate-delay-3">
          <div className="empty-state-icon">👥</div>
          <h3>{search ? "No match found" : "No admins yet"}</h3>
          <p>{search ? `No admin matches "${search}"` : "Add admins using the form above"}</p>
        </div>
      ) : (
        <div className="card animate-fade-up animate-delay-3" style={{ padding: 0, overflow: "hidden" }}>
          {sorted.map((admin, idx) => {
            const role = roleColor[admin.telegramStatus || ""];
            const isOwner = admin.telegramStatus === "creator";
            const isPending = !admin.inDashboard;

            return (
              <div
                key={admin.userId || admin.telegramId || idx}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "var(--space-3)",
                  padding: "var(--space-3) var(--space-4)",
                  borderBottom: idx < sorted.length - 1 ? "1px solid var(--clr-border)" : "none",
                  flexWrap: "wrap",
                  transition: "background 0.1s",
                }}
                onMouseEnter={e => (e.currentTarget.style.background = "var(--clr-bg-hover)")}
                onMouseLeave={e => (e.currentTarget.style.background = "")}
              >
                {/* Avatar */}
                <div style={{
                  width: 40, height: 40, borderRadius: "var(--radius-full)", flexShrink: 0,
                  background: isOwner ? "linear-gradient(135deg, #f59e0b, #fbbf24)" : "var(--grad-brand)",
                  display: "flex", alignItems: "center", justifyContent: "center",
                  fontWeight: 700, fontSize: "0.85rem", color: "white",
                }}>
                  {initials(admin.firstName)}
                </div>

                {/* Name + username */}
                <div style={{ flex: 1, minWidth: 120 }}>
                  <div style={{ fontWeight: 600, fontSize: "0.92rem", display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                    {admin.firstName}
                    {isOwner && <span style={{ fontSize: "0.68rem", background: "rgba(251,191,36,0.15)", color: "#fbbf24", border: "1px solid rgba(251,191,36,0.3)", borderRadius: "var(--radius-full)", padding: "1px 7px" }}>Owner</span>}
                  </div>
                  {admin.username && (
                    <div style={{ fontSize: "0.75rem", color: "var(--clr-text-muted)" }}>@{admin.username}</div>
                  )}
                </div>

                {/* Status badges */}
                <div style={{ display: "flex", gap: 5, flexWrap: "wrap", alignItems: "center" }}>
                  {role && (
                    <span className="badge" style={{ background: role.bg, color: role.text, fontSize: "0.7rem" }}>
                      {role.label}
                    </span>
                  )}
                  {!admin.telegramStatus && (
                    <span className="badge badge-muted" style={{ fontSize: "0.7rem" }}>Dashboard only</span>
                  )}
                  {admin.inDashboard
                    ? <span className="badge badge-success" style={{ fontSize: "0.7rem" }}>✓ Registered</span>
                    : <span className="badge badge-muted" style={{ fontSize: "0.7rem" }}>Not logged in</span>
                  }
                  {admin.approved === true && !isPending && <span className="badge badge-brand" style={{ fontSize: "0.7rem" }}>✓ Access</span>}
                  {admin.approved === false && <span className="badge badge-danger" style={{ fontSize: "0.7rem" }}>✗ Revoked</span>}
                </div>

                {/* Actions */}
                <div style={{ display: "flex", gap: "var(--space-2)", marginLeft: "auto", flexShrink: 0 }}>
                  {isOwner ? (
                    <span style={{ fontSize: "0.75rem", color: "var(--clr-warning)", fontWeight: 600 }}>Group Owner</span>
                  ) : isPending ? (
                    <span style={{ fontSize: "0.75rem", color: "var(--clr-text-muted)" }}>Awaiting login</span>
                  ) : admin.approved !== false ? (
                    <>
                      <button className="btn btn-danger btn-sm" onClick={() => handleToggle(admin, false)} style={{ fontSize: "0.78rem" }}>
                        Revoke
                      </button>
                      {admin.source === "dashboard" && (
                        <button
                          className="btn btn-ghost btn-sm"
                          style={{ color: "var(--clr-danger)", padding: "0 8px" }}
                          title="Remove from group"
                          onClick={() => handleRemove(admin)}
                        >
                          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            <polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6M14 11v6"/>
                          </svg>
                        </button>
                      )}
                    </>
                  ) : (
                    <button
                      className="btn btn-sm"
                      style={{ background: "var(--clr-success-muted)", color: "var(--clr-success)", border: "1px solid rgba(52,211,153,0.3)", fontSize: "0.78rem" }}
                      onClick={() => handleToggle(admin, true)}
                    >
                      Restore Access
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
