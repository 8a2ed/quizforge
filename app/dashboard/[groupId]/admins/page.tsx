"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";

interface Admin {
  telegramId: string;
  firstName: string;
  username: string | null;
  telegramStatus: string;
  inDashboard: boolean;
  dashboardRole: string | null;
  approved: boolean | null;
  userId: string | null;
}

export default function AdminsPage() {
  const params = useParams();
  const groupId = params.groupId as string;
  const [admins, setAdmins] = useState<Admin[]>([]);
  const [loading, setLoading] = useState(true);
  const [groupTitle, setGroupTitle] = useState("");
  const [toast, setToast] = useState("");

  useEffect(() => {
    fetch(`/api/groups/${groupId}/admins`)
      .then((r) => r.json())
      .then((d) => {
        setAdmins(d.admins || []);
        setGroupTitle(d.groupTitle || "");
        setLoading(false);
      });
  }, [groupId]);

  const showToast = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(""), 3000);
  };

  const handleToggle = async (admin: Admin, approved: boolean) => {
    if (!admin.userId) return showToast("User not registered yet — they must log in first");
    const res = await fetch(`/api/groups/${groupId}/admins`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ targetUserId: admin.userId, approved }),
    });
    if (res.ok) {
      setAdmins((prev) => prev.map((a) => a.telegramId === admin.telegramId ? { ...a, approved } : a));
      showToast(approved ? `✓ ${admin.firstName} can now access the dashboard` : `${admin.firstName} access revoked`);
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
          <div className="toast toast-info">{toast}</div>
        </div>
      )}

      <div className="section-header animate-fade-up">
        <div>
          <h1>Admin Management</h1>
          <p>Control who can use the QuizForge dashboard for {groupTitle}</p>
        </div>
      </div>

      {/* Info box */}
      <div className="card animate-fade-up animate-delay-1" style={{ background: "var(--clr-brand-muted)", borderColor: "rgba(79,127,255,0.25)", marginBottom: "var(--space-6)" }}>
        <div style={{ display: "flex", gap: "var(--space-3)", alignItems: "flex-start" }}>
          <span style={{ fontSize: "1.2rem", flexShrink: 0 }}>ℹ️</span>
          <div>
            <p style={{ color: "var(--clr-text-primary)", fontWeight: 600, marginBottom: 4 }}>How access works</p>
            <p style={{ fontSize: "0.875rem", color: "var(--clr-text-secondary)", margin: 0 }}>
              This shows all admins from your Telegram group. Admins must <strong>log into QuizForge first</strong> before you can manage their access.
              The group owner (creator) always has full access.
            </p>
          </div>
        </div>
      </div>

      {/* Admins table */}
      {loading ? (
        <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-3)" }}>
          {[1,2,3].map((i) => <div key={i} className="skeleton" style={{ height: 72, borderRadius: "var(--radius-md)" }} />)}
        </div>
      ) : admins.length === 0 ? (
        <div className="empty-state">
          <div className="empty-state-icon">👥</div>
          <h3>No admins found</h3>
          <p>Could not fetch group admins from Telegram</p>
        </div>
      ) : (
        <div className="table-wrapper animate-fade-up animate-delay-2">
          <table>
            <thead>
              <tr>
                <th>Admin</th>
                <th>Telegram Role</th>
                <th>Dashboard Status</th>
                <th>Dashboard Access</th>
                <th>Action</th>
              </tr>
            </thead>
            <tbody>
              {admins.map((admin) => (
                <tr key={admin.telegramId}>
                  <td>
                    <div style={{ display: "flex", alignItems: "center", gap: "var(--space-3)" }}>
                      <div className="avatar" style={{ background: "var(--grad-brand)" }}>
                        {admin.firstName.charAt(0).toUpperCase()}
                      </div>
                      <div>
                        <div style={{ fontWeight: 600 }}>{admin.firstName}</div>
                        {admin.username && (
                          <div style={{ fontSize: "0.78rem", color: "var(--clr-text-muted)" }}>@{admin.username}</div>
                        )}
                      </div>
                    </div>
                  </td>
                  <td>
                    <span className="badge" style={{
                      background: statusColor[admin.telegramStatus] ? `${statusColor[admin.telegramStatus]}20` : "var(--clr-bg-hover)",
                      color: statusColor[admin.telegramStatus] || "var(--clr-text-muted)",
                    }}>
                      {admin.telegramStatus}
                    </span>
                  </td>
                  <td>
                    {admin.inDashboard ? (
                      <span className="badge badge-success">✓ Registered</span>
                    ) : (
                      <span className="badge badge-muted">Not registered</span>
                    )}
                  </td>
                  <td>
                    {admin.approved === null ? (
                      <span style={{ color: "var(--clr-text-muted)", fontSize: "0.85rem" }}>—</span>
                    ) : admin.approved ? (
                      <span className="badge badge-success">Allowed</span>
                    ) : (
                      <span className="badge badge-danger">Revoked</span>
                    )}
                  </td>
                  <td>
                    {admin.telegramStatus === "creator" ? (
                      <span style={{ color: "var(--clr-warning)", fontSize: "0.8rem", fontWeight: 600 }}>Group Owner</span>
                    ) : !admin.inDashboard ? (
                      <span style={{ color: "var(--clr-text-muted)", fontSize: "0.8rem" }}>Awaiting login</span>
                    ) : admin.approved !== false ? (
                      <button
                        className="btn btn-danger btn-sm"
                        onClick={() => handleToggle(admin, false)}
                      >
                        Revoke Access
                      </button>
                    ) : (
                      <button
                        className="btn btn-sm"
                        style={{ background: "var(--clr-success-muted)", color: "var(--clr-success)", border: "1px solid rgba(52,211,153,0.3)" }}
                        onClick={() => handleToggle(admin, true)}
                      >
                        Restore Access
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
