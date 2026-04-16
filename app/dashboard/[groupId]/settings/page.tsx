"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";

interface BotConfig {
  id: string;
  webhookSecret: string;
  defaultAnonymous: boolean;
  defaultOpenPeriod: number;
  defaultType: string;
  allowMultiple: boolean;
}

interface BotInfo {
  first_name: string;
  username: string;
  id: number;
}

export default function SettingsPage() {
  const params = useParams();
  const groupId = params.groupId as string;
  const [config, setConfig] = useState<BotConfig | null>(null);
  const [botInfo, setBotInfo] = useState<BotInfo | null>(null);
  const [webhookStatus, setWebhookStatus] = useState<Record<string, unknown> | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState<{ type: string; msg: string } | null>(null);
  const [testResult, setTestResult] = useState<string | null>(null);

  const showToast = (type: string, msg: string) => {
    setToast({ type, msg });
    setTimeout(() => setToast(null), 4000);
  };

  useEffect(() => {
    fetch(`/api/groups/${groupId}/settings`)
      .then((r) => r.json())
      .then((d) => {
        setConfig(d.config);
        setBotInfo(d.botInfo);
        setWebhookStatus(d.webhookStatus);
        setLoading(false);
      });
  }, [groupId]);

  const handleSave = async () => {
    if (!config) return;
    setSaving(true);
    const res = await fetch(`/api/groups/${groupId}/settings`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(config),
    });
    if (res.ok) showToast("success", "Settings saved!");
    else showToast("error", "Failed to save settings.");
    setSaving(false);
  };

  const handleTestConnection = async () => {
    setTestResult("Testing…");
    try {
      const res = await fetch(`/api/groups/${groupId}/settings/test`);
      const data = await res.json();
      setTestResult(data.ok ? `✅ Connected! Bot: @${data.username}` : `❌ Error: ${data.error}`);
    } catch {
      setTestResult("❌ Network error");
    }
  };

  const handleSetWebhook = async () => {
    const res = await fetch(`/api/groups/${groupId}/settings/webhook`, { method: "POST" });
    const data = await res.json();
    if (data.ok) showToast("success", "Webhook registered with Telegram!");
    else showToast("error", `Failed: ${data.error}`);
  };

  if (loading) {
    return (
      <div>
        <h1 style={{ marginBottom: "var(--space-8)" }}>Settings</h1>
        {[1,2,3].map((i) => <div key={i} className="skeleton" style={{ height: 120, marginBottom: "var(--space-5)", borderRadius: "var(--radius-lg)" }} />)}
      </div>
    );
  }

  return (
    <div style={{ maxWidth: 720 }}>
      {toast && (
        <div className="toast-container">
          <div className={`toast toast-${toast.type}`}>{toast.msg}</div>
        </div>
      )}

      <div className="section-header animate-fade-up">
        <h1>Settings</h1>
        <button className="btn btn-primary" onClick={handleSave} disabled={saving || !config}>
          {saving ? "Saving…" : "Save Changes"}
        </button>
      </div>

      {/* Bot Info */}
      {botInfo && (
        <div className="card animate-fade-up animate-delay-1" style={{ marginBottom: "var(--space-5)" }}>
          <h3 style={{ marginBottom: "var(--space-4)" }}>Bot Information</h3>
          <div style={{ display: "flex", alignItems: "center", gap: "var(--space-4)" }}>
            <div className="avatar xl" style={{ background: "var(--grad-brand)", fontSize: "1.4rem" }}>
              🤖
            </div>
            <div>
              <div style={{ fontFamily: "var(--font-display)", fontWeight: 700, fontSize: "1.1rem" }}>
                {botInfo.first_name}
              </div>
              <div style={{ color: "var(--clr-brand)", marginBottom: 8 }}>@{botInfo.username}</div>
              <div style={{ fontSize: "0.8rem", color: "var(--clr-text-muted)" }}>ID: {botInfo.id}</div>
            </div>
            <div style={{ marginLeft: "auto" }}>
              <button className="btn btn-secondary btn-sm" onClick={handleTestConnection}>
                Test Connection
              </button>
              {testResult && (
                <div style={{ marginTop: 8, fontSize: "0.875rem", color: testResult.startsWith("✅") ? "var(--clr-success)" : "var(--clr-danger)" }}>
                  {testResult}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Webhook Status */}
      {webhookStatus && (
        <div className="card animate-fade-up animate-delay-2" style={{ marginBottom: "var(--space-5)" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "var(--space-4)" }}>
            <h3>Webhook Status</h3>
            <button className="btn btn-secondary btn-sm" onClick={handleSetWebhook}>
              Register Webhook
            </button>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "var(--space-4)" }}>
            {[
              ["URL", (webhookStatus.url as string) || "Not set"],
              ["Pending updates", String(webhookStatus.pending_update_count || 0)],
              ["Last error", (webhookStatus.last_error_message as string) || "None"],
              ["Max connections", String(webhookStatus.max_connections || 40)],
            ].map(([k, v]) => (
              <div key={k}>
                <div style={{ fontSize: "0.75rem", color: "var(--clr-text-muted)", marginBottom: 4 }}>{k}</div>
                <div style={{ fontSize: "0.875rem", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{v}</div>
              </div>
            ))}
          </div>
          <div style={{ marginTop: "var(--space-4)", padding: "var(--space-3)", background: "var(--clr-bg-elevated)", borderRadius: "var(--radius-md)", fontSize: "0.8rem" }}>
            <span style={{ color: "var(--clr-text-muted)" }}>Webhook Secret: </span>
            <code style={{ color: "var(--clr-brand)", fontSize: "0.75rem" }}>
              {config?.webhookSecret?.slice(0, 16)}…
            </code>
          </div>
        </div>
      )}

      {/* Default Settings */}
      {config && (
        <div className="card animate-fade-up animate-delay-3">
          <h3 style={{ marginBottom: "var(--space-5)" }}>Default Quiz Settings</h3>
          <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-3)" }}>
            <label className="toggle-group">
              <div className="toggle-info">
                <div className="toggle-title">Anonymous Polls by Default</div>
                <div className="toggle-desc">New quizzes are anonymous unless overridden</div>
              </div>
              <div className="toggle-switch">
                <input
                  type="checkbox"
                  checked={config.defaultAnonymous}
                  onChange={(e) => setConfig({ ...config, defaultAnonymous: e.target.checked })}
                />
                <span className="toggle-slider" />
              </div>
            </label>

            <label className="toggle-group">
              <div className="toggle-info">
                <div className="toggle-title">Allow Multiple Answers by Default</div>
                <div className="toggle-desc">For polls — users can select more than one option</div>
              </div>
              <div className="toggle-switch">
                <input
                  type="checkbox"
                  checked={config.allowMultiple}
                  onChange={(e) => setConfig({ ...config, allowMultiple: e.target.checked })}
                />
                <span className="toggle-slider" />
              </div>
            </label>

            <div className="input-wrapper" style={{ marginTop: "var(--space-2)" }}>
              <label className="input-label">Default Type</label>
              <select
                className="select"
                value={config.defaultType}
                onChange={(e) => setConfig({ ...config, defaultType: e.target.value })}
              >
                <option value="QUIZ">Quiz (with correct answer)</option>
                <option value="POLL">Poll (no correct answer)</option>
              </select>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
