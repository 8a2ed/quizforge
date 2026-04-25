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

  // Invite by username
  const [inviteUsername, setInviteUsername] = useState("");
  const [inviting, setInviting] = useState(false);
  const [inviteError, setInviteError] = useState("");
  const [inviteSuccess, setInviteSuccess] = useState("");

  const [toast, setToast] = useState<{ type: string; msg: string } | null>(null);
  const showToast = (type: string, msg: string) => {
    setToast({ type, msg });
    setTimeout(() => setToast(null), 4000);
  };

  const load = useCallback(() => {
    setLoading(true);
    fetch(`/api/groups/${groupId}/admins`)
      .then((r) => r.json())
      .then((d) => {
        setAdmins(d.admins || []);
        setGroupTitle(d.groupTitle || "");
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, [groupId]);

  useEffect(() => { load(); }, [load]);

  const handleToggle = async (admin: Admin, approved: boolean) => {
    if (!admin.userId) return showToast("info", "User hasn't logged in yet — they must log in first");
    const res = await fetch(`/api/groups/${groupId}/admins`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ targetUserId: admin.userId, approved }),
    });
    if (res.ok) {
      setAdmins((prev) =>
        prev.map((a) =>
          (a.userId === admin.userId || a.telegramId === admin.telegramId)
            ? { ...a, approved }
            : a
        )
      );
      showToast("success", approved ? `✓ ${admin.firstName} can now access the dashboard` : `${admin.firstName} access revoked`);
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
      setAdmins((prev) => prev.filter((a) => a.userId !== admin.userId));
      showToast("success", `${admin.firstName} removed`);
    }
  };

  const handleInvite = async (e: React.FormEvent) => {
    e.preventDefault();
    setInviteError("");
    setInviteSuccess("");
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
        if (data.restored) {
          setInviteSuccess(`✓ ${data.user.firstName}'s access has been restored!`);
        } else {
          setInviteSuccess(`✓ ${data.user.firstName} added as Admin!`);
        }
        load();
      } else if (res.status === 409 && data.alreadyMember) {
        setInviteSuccess(`ℹ️ ${data.error} They already have full access.`);
        load();
      } else {
        setInviteError(data.error || "Failed to add user");
      }
    } catch {
      setInviteError("Network error");
    } finally {
      setInviting(false);
    }
  };

  const statusColor: Record<string, string> = {
    creator: "var(--clr-warning)",
    administrator: "var(--clr-brand)",
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
          <p>Control who can use the QuizForge dashboard for {groupTitle}</p>
        </div>
        <button className="btn btn-secondary" onClick={load} disabled={loading}>
          {loading ? "…" : "↻ Refresh"}
        </button>
      </div>

      {/* Invite by Telegram username */}
      <div className="card animate-fade-up animate-delay-1" style={{ marginBottom: "var(--space-5)" }}>
        <h4 style={{ marginBottom: "var(--space-2)" }}>➕ Add Admin by Telegram Username</h4>
        <p style={{ fontSize: "0.85rem", color: "var(--clr-text-muted)", marginBottom: "var(--space-4)" }}>
          The person must first log in at{" "}
          <strong>quiz.agridmulms.me/login</strong> with their Telegram account.
          Then enter their <strong>@username</strong> or <strong>first name</strong> here.
        </p>
        <form onSubmit={handleInvite} style={{ display: "flex", gap: "var(--space-3)", flexWrap: "wrap" }}>
          <div style={{ flex: 1, minWidth: 200 }}>
            <input
              className="input"
              placeholder="@username or first name (e.g. Azza)"
              value={inviteUsername}
              onChange={(e) => { setInviteUsername(e.target.value); setInviteError(""); setInviteSuccess(""); }}
            />
          </div>
          <button className="btn btn-primary" type="submit" disabled={inviting || !inviteUsername.trim()}>
            {inviting ? "Adding…" : "Add Admin"}
          </button>
        </form>
        {inviteError && (
          <div style={{ marginTop: "var(--space-3)", padding: "var(--space-3)", background: "rgba(248,113,113,0.08)", borderRadius: "var(--radius-md)", border: "1px solid rgba(248,113,113,0.25)", fontSize: "0.85rem", color: "var(--clr-danger)" }}>
            ⚠ {inviteError}
          </div>
        )}
        {inviteSuccess && (
          <div style={{ marginTop: "var(--space-3)", padding: "var(--space-3)", background: "rgba(52,211,153,0.08)", borderRadius: "var(--radius-md)", border: "1px solid rgba(52,211,153,0.25)", fontSize: "0.85rem", color: "var(--clr-success)" }}>
            {inviteSuccess}
          </div>
        )}
      </div>

      {/* Info box */}
      <div className="card animate-fade-up animate-delay-2" style={{ background: "var(--clr-brand-muted)", borderColor: "rgba(79,127,255,0.25)", marginBottom: "var(--space-5)" }}>
        <div style={{ display: "flex", gap: "var(--space-3)", alignItems: "flex-start" }}>
          <span style={{ fontSize: "1.2rem", flexShrink: 0 }}>ℹ️</span>
          <div>
            <p style={{ color: "var(--clr-text-primary)", fontWeight: 600, marginBottom: 4 }}>Two ways to give access</p>
            <p style={{ fontSize: "0.85rem", color: "var(--clr-text-secondary)", margin: 0, lineHeight: 1.7 }}>
              <strong>1. Telegram login</strong> — Person logs in at /login with Telegram → you add them above by username.<br />
              <strong>2. Username & Password</strong> — Go to Dashboard → Instructors → create an account for them.
            </p>
          </div>
        </div>
      </div>

      {/* Admins table */}
      {loading ? (
        <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-3)" }}>
          {[1, 2, 3].map((i) => (
            <div key={i} className="skeleton" style={{ height: 72, borderRadius: "var(--radius-md)" }} />
          ))}
        </div>
      ) : admins.length === 0 ? (
        <div className="empty-state animate-fade-up animate-delay-3">
          <div className="empty-state-icon">👥</div>
          <h3>No admins found</h3>
          <p>Add admins using the form above or make sure the bot is an admin in the Telegram group</p>
        </div>
      ) : (
        <div className="card animate-fade-up animate-delay-3" style={{ padding: 0, overflow: "hidden" }}>
          <div style={{ display: "flex", flexDirection: "column" }}>
            {admins.map((admin, idx) => (
              <div
                key={admin.userId || admin.telegramId || idx}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "var(--space-4)",
                  padding: "var(--space-4) var(--space-5)",
                  borderBottom: idx < admins.length - 1 ? "1px solid var(--clr-border)" : "none",
                  flexWrap: "wrap",
                }}
              >
                {/* Avatar + name */}
                <div style={{ display: "flex", alignItems: "center", gap: "var(--space-3)", flex: 1, minWidth: 160 }}>
                  <div className="avatar" style={{ background: "var(--grad-brand)", flexShrink: 0 }}>
                    {admin.firstName.charAt(0).toUpperCase()}
                  </div>
                  <div>
                    <div style={{ fontWeight: 600, fontSize: "0.95rem" }}>{admin.firstName}</div>
                    {admin.username && (
                      <div style={{ fontSize: "0.75rem", color: "var(--clr-text-muted)" }}>@{admin.username}</div>
                    )}
                  </div>
                </div>

                {/* Badges */}
                <div style={{ display: "flex", alignItems: "center", gap: "var(--space-2)", flexWrap: "wrap" }}>
                  {/* Telegram status badge */}
                  {admin.telegramStatus ? (
                    <span className="badge" style={{
                      background: statusColor[admin.telegramStatus] ? `${statusColor[admin.telegramStatus]}20` : "var(--clr-bg-hover)",
                      color: statusColor[admin.telegramStatus] || "var(--clr-text-muted)",
                    }}>
                      {admin.telegramStatus === "creator" ? "⭐ Creator" : admin.telegramStatus}
                    </span>
                  ) : (
                    <span className="badge badge-muted">Dashboard only</span>
                  )}

                  {/* Dashboard account */}
                  {admin.inDashboard
                    ? <span className="badge badge-success">✓ Registered</span>
                    : <span className="badge badge-muted">Not logged in yet</span>
                  }

                  {/* Access status */}
                  {admin.approved === true && <span className="badge badge-brand">✓ Access granted</span>}
                  {admin.approved === false && <span className="badge badge-danger">✗ Revoked</span>}
                </div>

                {/* Actions */}
                <div style={{ display: "flex", gap: "var(--space-2)", marginLeft: "auto", flexShrink: 0 }}>
                  {admin.telegramStatus === "creator" ? (
                    <span style={{ color: "var(--clr-warning)", fontSize: "0.8rem", fontWeight: 600 }}>Group Owner</span>
                  ) : !admin.inDashboard ? (
                    <span style={{ color: "var(--clr-text-muted)", fontSize: "0.8rem" }}>Awaiting login</span>
                  ) : admin.approved !== false ? (
                    <>
                      <button
                        className="btn btn-danger btn-sm"
                        onClick={() => handleToggle(admin, false)}
                      >
                        Revoke
                      </button>
                      {admin.source === "dashboard" && (
                        <button
                          className="btn btn-ghost btn-sm"
                          style={{ color: "var(--clr-danger)" }}
                          title="Remove from group"
                          onClick={() => handleRemove(admin)}
                        >
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            <polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6M14 11v6"/>
                          </svg>
                        </button>
                      )}
                    </>
                  ) : (
                    <button
                      className="btn btn-sm"
                      style={{ background: "var(--clr-success-muted)", color: "var(--clr-success)", border: "1px solid rgba(52,211,153,0.3)" }}
                      onClick={() => handleToggle(admin, true)}
                    >
                      Restore Access
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
