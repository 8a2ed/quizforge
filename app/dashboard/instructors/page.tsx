"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";

interface Instructor {
  id: string;
  username: string;
  createdAt: string;
  user: { id: string; firstName: string; username: string | null; createdAt: string };
}

interface Group {
  id: string;
  title: string;
}

export default function InstructorsPage() {
  const router = useRouter();
  const [instructors, setInstructors] = useState<Instructor[]>([]);
  const [groups, setGroups] = useState<Group[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  // Create form state
  const [showForm, setShowForm] = useState(false);
  const [formUsername, setFormUsername] = useState("");
  const [formPassword, setFormPassword] = useState("");
  const [formFirstName, setFormFirstName] = useState("");
  const [formGroupId, setFormGroupId] = useState("");
  const [formLoading, setFormLoading] = useState(false);
  const [formError, setFormError] = useState("");

  // Reset password state
  const [resetUserId, setResetUserId] = useState<string | null>(null);
  const [resetPassword, setResetPassword] = useState("");
  const [resetLoading, setResetLoading] = useState(false);

  useEffect(() => {
    fetchAll();
  }, []);

  const fetchAll = async () => {
    setLoading(true);
    try {
      const [iRes, gRes] = await Promise.all([
        fetch("/api/instructors"),
        fetch("/api/groups"),
      ]);
      if (iRes.status === 403) {
        setError("You must be a group owner to manage instructors.");
        setLoading(false);
        return;
      }
      const iData = await iRes.json();
      const gData = await gRes.json();
      setInstructors(iData.credentials || []);
      setGroups(gData.groups || []);
    } catch {
      setError("Failed to load. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError("");
    setFormLoading(true);
    try {
      const res = await fetch("/api/instructors", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          username: formUsername,
          password: formPassword,
          firstName: formFirstName,
          groupId: formGroupId || undefined,
        }),
      });
      const data = await res.json();
      if (data.ok) {
        setFormUsername(""); setFormPassword(""); setFormFirstName(""); setFormGroupId("");
        setShowForm(false);
        fetchAll();
      } else {
        setFormError(data.error || "Failed to create instructor");
      }
    } catch {
      setFormError("Network error");
    } finally {
      setFormLoading(false);
    }
  };

  const handleDelete = async (userId: string, name: string) => {
    if (!confirm(`Delete instructor "${name}"? This cannot be undone.`)) return;
    await fetch("/api/instructors", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ instructorUserId: userId }),
    });
    fetchAll();
  };

  const handleResetPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!resetUserId) return;
    setResetLoading(true);
    try {
      const res = await fetch("/api/instructors", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ instructorUserId: resetUserId, newPassword: resetPassword }),
      });
      const data = await res.json();
      if (data.ok) {
        setResetUserId(null);
        setResetPassword("");
        alert("Password updated successfully!");
      } else {
        alert(data.error || "Failed to reset password");
      }
    } finally {
      setResetLoading(false);
    }
  };

  return (
    <div className="page-container">
      {/* Header */}
      <div className="page-header">
        <div>
          <div className="breadcrumb" style={{ marginBottom: 4 }}>
            <Link href="/dashboard" className="breadcrumb-link">Dashboard</Link>
            <span className="breadcrumb-sep">›</span>
            <span>Instructor Accounts</span>
          </div>
          <h1 className="page-title">Instructor Accounts</h1>
          <p className="page-subtitle">Manage username/password logins for instructors</p>
        </div>
        <button className="btn btn-primary" id="add-instructor-btn" onClick={() => setShowForm(true)}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
            <path d="M12 5v14M5 12h14" strokeLinecap="round"/>
          </svg>
          Add Instructor
        </button>
      </div>

      {loading && <div className="empty-state"><div className="spinner" /></div>}
      {error && <div className="alert alert-error">{error}</div>}

      {/* Create form modal */}
      {showForm && (
        <div className="modal-overlay" onClick={() => setShowForm(false)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h2 className="modal-title">New Instructor Account</h2>
              <button className="modal-close" onClick={() => setShowForm(false)}>✕</button>
            </div>
            <form onSubmit={handleCreate}>
              <div className="form-group">
                <label className="form-label">Full Name *</label>
                <input className="form-input" placeholder="e.g. Ahmed Ramy" value={formFirstName}
                  onChange={e => setFormFirstName(e.target.value)} required />
              </div>
              <div className="form-group" style={{ marginTop: "var(--space-4)" }}>
                <label className="form-label">Username *</label>
                <input className="form-input" placeholder="e.g. ahmed.ramy" value={formUsername}
                  onChange={e => setFormUsername(e.target.value)} required autoComplete="off" />
                <p className="form-hint">Lowercase, no spaces. Used to log in.</p>
              </div>
              <div className="form-group" style={{ marginTop: "var(--space-4)" }}>
                <label className="form-label">Password * (min 6 chars)</label>
                <input type="password" className="form-input" placeholder="••••••••" value={formPassword}
                  onChange={e => setFormPassword(e.target.value)} required minLength={6} autoComplete="new-password" />
              </div>
              <div className="form-group" style={{ marginTop: "var(--space-4)" }}>
                <label className="form-label">Add to Group (optional)</label>
                <select className="form-select" value={formGroupId} onChange={e => setFormGroupId(e.target.value)}>
                  <option value="">— No group —</option>
                  {groups.map(g => (
                    <option key={g.id} value={g.id}>{g.title}</option>
                  ))}
                </select>
                <p className="form-hint">Instructor will be added as ADMIN to this group.</p>
              </div>

              {formError && (
                <div className="alert alert-error" style={{ marginTop: "var(--space-3)" }}>{formError}</div>
              )}

              <div style={{ display: "flex", gap: "var(--space-3)", marginTop: "var(--space-6)" }}>
                <button type="button" className="btn btn-secondary" onClick={() => setShowForm(false)} style={{ flex: 1 }}>
                  Cancel
                </button>
                <button type="submit" className="btn btn-primary" disabled={formLoading} style={{ flex: 1, justifyContent: "center" }}>
                  {formLoading ? "Creating…" : "Create Account"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Reset password modal */}
      {resetUserId && (
        <div className="modal-overlay" onClick={() => setResetUserId(null)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h2 className="modal-title">Reset Password</h2>
              <button className="modal-close" onClick={() => setResetUserId(null)}>✕</button>
            </div>
            <form onSubmit={handleResetPassword}>
              <div className="form-group">
                <label className="form-label">New Password (min 6 chars)</label>
                <input type="password" className="form-input" placeholder="••••••••" value={resetPassword}
                  onChange={e => setResetPassword(e.target.value)} required minLength={6} autoComplete="new-password" />
              </div>
              <div style={{ display: "flex", gap: "var(--space-3)", marginTop: "var(--space-5)" }}>
                <button type="button" className="btn btn-secondary" onClick={() => setResetUserId(null)} style={{ flex: 1 }}>
                  Cancel
                </button>
                <button type="submit" className="btn btn-primary" disabled={resetLoading} style={{ flex: 1, justifyContent: "center" }}>
                  {resetLoading ? "Saving…" : "Update Password"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Instructor list */}
      {!loading && !error && (
        <>
          {instructors.length === 0 ? (
            <div className="empty-state">
              <div className="empty-icon">🔐</div>
              <h3>No instructor accounts yet</h3>
              <p>Create accounts for instructors who don&apos;t use Telegram.</p>
              <button className="btn btn-primary" onClick={() => setShowForm(true)}>Add First Instructor</button>
            </div>
          ) : (
            <div className="card">
              <table style={{ width: "100%", borderCollapse: "collapse" }}>
                <thead>
                  <tr style={{ borderBottom: "1px solid var(--clr-border)" }}>
                    <th style={{ textAlign: "left", padding: "var(--space-3) var(--space-4)", color: "var(--clr-text-muted)", fontSize: "0.8rem", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.05em" }}>Name</th>
                    <th style={{ textAlign: "left", padding: "var(--space-3) var(--space-4)", color: "var(--clr-text-muted)", fontSize: "0.8rem", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.05em" }}>Username</th>
                    <th style={{ textAlign: "left", padding: "var(--space-3) var(--space-4)", color: "var(--clr-text-muted)", fontSize: "0.8rem", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.05em" }}>Created</th>
                    <th style={{ textAlign: "right", padding: "var(--space-3) var(--space-4)" }}></th>
                  </tr>
                </thead>
                <tbody>
                  {instructors.map(inst => (
                    <tr key={inst.id} style={{ borderBottom: "1px solid var(--clr-border-subtle)" }}>
                      <td style={{ padding: "var(--space-4)", color: "var(--clr-text-primary)", fontWeight: 500 }}>
                        {inst.user.firstName}
                      </td>
                      <td style={{ padding: "var(--space-4)", color: "var(--clr-text-secondary)", fontFamily: "monospace", fontSize: "0.9rem" }}>
                        @{inst.username}
                      </td>
                      <td style={{ padding: "var(--space-4)", color: "var(--clr-text-muted)", fontSize: "0.85rem" }}>
                        {new Date(inst.createdAt).toLocaleDateString()}
                      </td>
                      <td style={{ padding: "var(--space-4)", textAlign: "right" }}>
                        <div style={{ display: "flex", gap: "var(--space-2)", justifyContent: "flex-end" }}>
                          <button
                            className="btn btn-secondary btn-sm"
                            onClick={() => { setResetUserId(inst.user.id); setResetPassword(""); }}
                          >
                            Reset Password
                          </button>
                          <button
                            className="btn btn-danger btn-sm"
                            onClick={() => handleDelete(inst.user.id, inst.user.firstName)}
                          >
                            Delete
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </div>
  );
}
