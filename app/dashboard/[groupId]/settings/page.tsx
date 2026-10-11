"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";

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

interface AISettingsData {
  geminiApiKey?: string;
  defaultModel: string;
  defaultDifficulty: "mixed" | "easy" | "medium" | "hard";
  defaultCount: number;
  strictGrounding: boolean;
  systemInstruction?: string;
}

export default function SettingsPage() {
  const params = useParams();
  const groupId = params.groupId as string;
  const [config, setConfig] = useState<BotConfig | null>(null);
  const [botInfo, setBotInfo] = useState<BotInfo | null>(null);
  const [webhookStatus, setWebhookStatus] = useState<Record<string, unknown> | null>(null);
  const [aiSettings, setAiSettings] = useState<AISettingsData | null>(null);
  const [showApiKey, setShowApiKey] = useState(false);
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
        if (d.aiSettings) setAiSettings(d.aiSettings);
        setLoading(false);
      });
  }, [groupId]);

  const handleSave = async () => {
    if (!config) return;
    setSaving(true);
    const res = await fetch(`/api/groups/${groupId}/settings`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ...config,
        aiSettings: aiSettings || undefined,
      }),
    });
    if (res.ok) {
      const data = await res.json().catch(() => null);
      if (data?.config) setConfig(data.config);
      if (data?.aiSettings) setAiSettings(data.aiSettings);
      showToast("success", "Settings saved!");
    } else {
      showToast("error", "Failed to save settings.");
    }
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

  const webhookUrl = webhookStatus?.url as string | undefined;
  const isWebhookSet = webhookUrl && webhookUrl.length > 0;

  return (
    <div style={{ maxWidth: "min(720px, 100%)" }}>
      {toast && (
        <div className="toast-container">
          <div className={`toast toast-${toast.type}`}>{toast.msg}</div>
        </div>
      )}

      <div className="section-header animate-fade-up">
        <div>
          <h1>Settings</h1>
          <p>Configure your bot and default quiz behaviour</p>
        </div>
        <button className="btn btn-primary" onClick={handleSave} disabled={saving || !config}>
          {saving ? "Saving…" : "Save Changes"}
        </button>
      </div>

      {/* Bot Info */}
      {botInfo && (
        <div className="card animate-fade-up animate-delay-1" style={{ marginBottom: "var(--space-5)" }}>
          <h3 style={{ marginBottom: "var(--space-4)" }}>Bot Information</h3>
          <div style={{ display: "flex", alignItems: "flex-start", gap: "var(--space-4)", flexWrap: "wrap" }}>
            <div className="avatar xl" style={{ background: "var(--grad-brand)", fontSize: "1.4rem", flexShrink: 0 }}>
              🤖
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontFamily: "var(--font-display)", fontWeight: 700, fontSize: "1.1rem" }}>
                {botInfo.first_name}
              </div>
              <div style={{ color: "var(--clr-brand)", marginBottom: 4 }}>@{botInfo.username}</div>
              <div style={{ fontSize: "0.8rem", color: "var(--clr-text-muted)" }}>ID: {botInfo.id}</div>
            </div>
            <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 8, flexShrink: 0 }}>
              <button className="btn btn-secondary btn-sm" onClick={handleTestConnection}>
                Test Connection
              </button>
              {testResult && (
                <div style={{ fontSize: "0.875rem", color: testResult.startsWith("✅") ? "var(--clr-success)" : "var(--clr-danger)", textAlign: "end" }}>
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
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: "var(--space-3)", marginBottom: "var(--space-4)" }}>
            <div>
              <h3>Webhook Status</h3>
              <p style={{ fontSize: "0.8rem", marginTop: 4 }}>
                {isWebhookSet
                  ? <span style={{ color: "var(--clr-success)" }}>✓ Active</span>
                  : <span style={{ color: "var(--clr-warning)" }}>⚠ Not registered</span>}
              </p>
            </div>
            <button className="btn btn-secondary btn-sm" onClick={handleSetWebhook}>
              {isWebhookSet ? "Re-register Webhook" : "Register Webhook"}
            </button>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: "var(--space-4)" }}>
            {[
              ["URL", webhookUrl || "Not set"],
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

            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: "var(--space-4)", marginTop: "var(--space-2)" }}>
              <div className="input-wrapper">
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

              <div className="input-wrapper">
                <label className="input-label">Default Duration (seconds, 0 = infinite)</label>
                <input
                  type="number"
                  className="input"
                  min={0}
                  max={600}
                  value={config.defaultOpenPeriod || 0}
                  onChange={(e) => setConfig({ ...config, defaultOpenPeriod: Number(e.target.value) })}
                />
              </div>
            </div>
          </div>
        </div>
      )}

      {/* AI & Curriculum Settings Card */}
      {aiSettings && (
        <div className="card animate-fade-up animate-delay-4" style={{ marginTop: "var(--space-5)" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: "var(--space-3)", marginBottom: "var(--space-4)" }}>
            <div>
              <h3 style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <span>🤖 إعدادات الذكاء الاصطناعي والمناهج (AI & Curriculum)</span>
              </h3>
              <p style={{ fontSize: "0.82rem", color: "var(--clr-text-muted)", marginTop: 4 }}>
                ضبط نموذج التوليد ومفتاح Gemini ومستوى صعوبة الأسئلة المعتمدة للبوت ولوحة التحكم
              </p>
            </div>
            <Link
              href={`/dashboard/${groupId}/curriculum`}
              className="btn btn-secondary btn-sm"
              style={{ display: "flex", alignItems: "center", gap: 6 }}
            >
              📚 فتح إدارة المناهج
            </Link>
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-4)" }}>
            {/* API Key */}
            <div className="input-wrapper">
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
                <label className="input-label" style={{ margin: 0 }}>Google Gemini API Key</label>
                <button
                  type="button"
                  onClick={() => setShowApiKey(!showApiKey)}
                  style={{ background: "none", border: "none", color: "var(--clr-brand)", fontSize: "0.75rem", cursor: "pointer" }}
                >
                  {showApiKey ? "إخفاء 🙈" : "إظهار المفتاح 👁️"}
                </button>
              </div>
              <input
                type={showApiKey ? "text" : "password"}
                className="input"
                placeholder="AIzaSy... (مفتاح API الخاص بـ Google AI Studio)"
                value={aiSettings.geminiApiKey || ""}
                onChange={(e) => setAiSettings({ ...aiSettings, geminiApiKey: e.target.value })}
              />
              <div style={{ fontSize: "0.75rem", color: "var(--clr-text-muted)", marginTop: 4 }}>
                {aiSettings.geminiApiKey ? "✅ مفتاح التوليد مضبوط ويعمل للنظام وتليجرام" : "⚠️ لم يتم إدخال مفتاح Gemini بعد"}
              </div>
            </div>

            {/* Default Model & Difficulty */}
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: "var(--space-4)" }}>
              <div className="input-wrapper">
                <label className="input-label">النموذج الافتراضي (Default Model)</label>
                <select
                  className="select"
                  value={aiSettings.defaultModel || "gemini-3.8-flash"}
                  onChange={(e) => setAiSettings({ ...aiSettings, defaultModel: e.target.value })}
                >
                  <option value="gemini-3.8-flash">gemini-3.8-flash (الأسرع والأحدث)</option>
                  <option value="gemini-2.5-flash">gemini-2.5-flash (مستقر وسريع)</option>
                  <option value="gemini-2.0-flash">gemini-2.0-flash (كلاسيكي)</option>
                </select>
              </div>

              <div className="input-wrapper">
                <label className="input-label">مستوى الصعوبة الافتراضي</label>
                <select
                  className="select"
                  value={aiSettings.defaultDifficulty || "mixed"}
                  onChange={(e) => setAiSettings({ ...aiSettings, defaultDifficulty: e.target.value as any })}
                >
                  <option value="mixed">متوازن ومتدرج (Mixed)</option>
                  <option value="easy">سهل ومباشر (Easy)</option>
                  <option value="medium">متوسط وفهم (Medium)</option>
                  <option value="hard">متقدم ومهارات عليا (Hard)</option>
                </select>
              </div>

              <div className="input-wrapper">
                <label className="input-label">العدد الافتراضي للأسئلة</label>
                <select
                  className="select"
                  value={aiSettings.defaultCount || 5}
                  onChange={(e) => setAiSettings({ ...aiSettings, defaultCount: Number(e.target.value) })}
                >
                  <option value={3}>3 أسئلة (سريع)</option>
                  <option value={5}>5 أسئلة (قياسي)</option>
                  <option value={10}>10 أسئلة (شامل)</option>
                  <option value={15}>15 سؤالاً</option>
                  <option value={20}>20 سؤالاً</option>
                </select>
              </div>
            </div>

            {/* Strict Grounding Toggle */}
            <label className="toggle-group" style={{ marginTop: "var(--space-2)" }}>
              <div className="toggle-info">
                <div className="toggle-title">الالتزام الصارم بالمنهج (Zero-Hallucination Grounding)</div>
                <div className="toggle-desc">منع الذكاء الاصطناعي من إضافة أي معلومات غير مذكورة نصاً في الكتاب أو المحتوى المرفوع</div>
              </div>
              <div className="toggle-switch">
                <input
                  type="checkbox"
                  checked={aiSettings.strictGrounding}
                  onChange={(e) => setAiSettings({ ...aiSettings, strictGrounding: e.target.checked })}
                />
                <span className="toggle-slider" />
              </div>
            </label>
          </div>
        </div>
      )}
    </div>
  );
}
