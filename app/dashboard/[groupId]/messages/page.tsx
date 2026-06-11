"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { useParams } from "next/navigation";

interface Contact {
  telegramId: string;
  firstName: string;
  username: string | null;
  photoUrl: string | null;
  source: "admin" | "respondent";
}

interface SendResult {
  telegramId: string;
  ok: boolean;
  error?: string;
}

interface Button { text: string; url: string; }

type MsgType = "text" | "photo" | "document" | "audio" | "video" | "poll";

const MSG_TYPES: { value: MsgType; label: string; icon: string; desc: string }[] = [
  { value: "text",     label: "Text",     icon: "💬", desc: "Plain or HTML message" },
  { value: "photo",    label: "Photo",    icon: "🖼️", desc: "Image with caption" },
  { value: "document", label: "File",     icon: "📄", desc: "PDF, ZIP, any file" },
  { value: "audio",    label: "Audio",    icon: "🎵", desc: "MP3 or audio file" },
  { value: "video",    label: "Video",    icon: "🎬", desc: "MP4 video" },
  { value: "poll",     label: "Poll",     icon: "📊", desc: "Telegram poll/quiz" },
];

const HTML_TEMPLATES = [
  { label: "Certificate", icon: "🎓", text: `🎓 <b>Certificate of Completion</b>\n\n👤 <b>Name:</b> [Name]\n📝 <b>Course:</b> [Course]\n🏆 <b>Score:</b> <code>[Score]%</code>\n✅ <b>Status:</b> PASSED\n\n<i>Congratulations on your achievement!</i>` },
  { label: "Reminder",    icon: "⏰", text: `⏰ <b>Reminder</b>\n\nDear [Name],\n\nThis is a reminder that <b>[Event]</b> is scheduled for <b>[Date]</b>.\n\nPlease make sure to attend on time.` },
  { label: "Announcement",icon: "📢", text: `📢 <b>Announcement</b>\n\n<b>[Title]</b>\n\n[Body]\n\n<i>Best regards,\nThe Team</i>` },
  { label: "Results",     icon: "📊", text: `📊 <b>Your Results</b>\n\n👤 <b>Name:</b> [Name]\n📝 <b>Quiz:</b> [Quiz]\n✅ <b>Correct:</b> [X]/[Total]\n🏆 <b>Score:</b> <code>[Score]%</code>` },
];

export default function MessagesPage() {
  const { groupId } = useParams() as { groupId: string };

  const [contacts, setContacts] = useState<Contact[]>([]);
  const [loadingContacts, setLoadingContacts] = useState(true);
  const [contactSearch, setContactSearch] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const [msgType, setMsgType] = useState<MsgType>("text");
  const [text, setText] = useState("");
  const [parseMode, setParseMode] = useState<"HTML" | "Markdown">("HTML");
  const [mediaUrl, setMediaUrl] = useState("");
  const [caption, setCaption] = useState("");
  const [buttons, setButtons] = useState<Button[]>([]);
  const [pollQuestion, setPollQuestion] = useState("");
  const [pollOptions, setPollOptions] = useState(["", "", ""]);
  const [pollAnonymous, setPollAnonymous] = useState(true);
  const [delayMs, setDelayMs] = useState(800);

  const [sending, setSending] = useState(false);
  const [results, setResults] = useState<SendResult[] | null>(null);
  const [toast, setToast] = useState<{ type: "success" | "error"; msg: string } | null>(null);
  const [preview, setPreview] = useState(false);
  const cancelRef = useRef(false);

  const showToast = (type: "success" | "error", msg: string) => {
    setToast({ type, msg });
    setTimeout(() => setToast(null), 4000);
  };

  const load = useCallback(() => {
    setLoadingContacts(true);
    fetch(`/api/groups/${groupId}/messages`)
      .then(r => r.json())
      .then(d => { setContacts(d.contacts || []); setLoadingContacts(false); })
      .catch(() => setLoadingContacts(false));
  }, [groupId]);

  useEffect(() => { load(); }, [load]);

  const filtered = contacts.filter(c =>
    !contactSearch ||
    c.firstName.toLowerCase().includes(contactSearch.toLowerCase()) ||
    c.username?.toLowerCase().includes(contactSearch.toLowerCase()) ||
    c.telegramId.includes(contactSearch)
  );

  const toggle = (id: string) => setSelected(prev => {
    const s = new Set(prev); s.has(id) ? s.delete(id) : s.add(id); return s;
  });
  const selectAll = () => setSelected(new Set(filtered.map(c => c.telegramId)));
  const selectNone = () => setSelected(new Set());
  const selectedArr = [...selected];

  const isValid = () => {
    if (!selectedArr.length) return false;
    if (msgType === "text") return text.trim().length > 0;
    if (msgType === "poll") return pollQuestion.trim() && pollOptions.filter(o => o.trim()).length >= 2;
    return mediaUrl.trim().length > 0;
  };

  const handleSend = async () => {
    if (!isValid()) return;
    setSending(true);
    cancelRef.current = false;
    setResults(null);

    try {
      const res = await fetch(`/api/groups/${groupId}/messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          recipients: selectedArr,
          type: msgType,
          text: text || undefined,
          parseMode,
          mediaUrl: mediaUrl || undefined,
          caption: caption || undefined,
          buttons: buttons.length ? [buttons.map(b => ({ text: b.text, url: b.url }))] : undefined,
          pollQuestion: pollQuestion || undefined,
          pollOptions: pollOptions.filter(o => o.trim()),
          pollAnonymous,
          delayMs,
        }),
      });
      const data = await res.json();
      setResults(data.results || []);
      showToast("success", `✅ ${data.sent} sent${data.failed > 0 ? `, ⚠️ ${data.failed} failed` : ""}`);
    } catch {
      showToast("error", "Network error");
    } finally {
      setSending(false);
    }
  };

  const previewHtml = text
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/&lt;b&gt;(.*?)&lt;\/b&gt;/g, "<b>$1</b>")
    .replace(/&lt;i&gt;(.*?)&lt;\/i&gt;/g, "<i>$1</i>")
    .replace(/&lt;code&gt;(.*?)&lt;\/code&gt;/g, "<code>$1</code>")
    .replace(/\n/g, "<br/>");

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-6)" }}>
      {/* Toast */}
      {toast && (
        <div className="toast-container">
          <div className={`toast toast-${toast.type}`}>{toast.msg}</div>
        </div>
      )}

      {/* Header */}
      <div className="section-header animate-fade-up">
        <div>
          <h1>📨 Messaging Center</h1>
          <p style={{ marginTop: 4, color: "var(--clr-text-muted)" }}>
            Send customized Telegram messages to individuals or broadcast to all
          </p>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <button className="btn btn-ghost btn-sm" onClick={load}>↺ Refresh</button>
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "340px 1fr", gap: "var(--space-5)", alignItems: "start" }}>

        {/* ── Left: Contact Picker ── */}
        <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-4)" }}>
          <div className="card animate-fade-up" style={{ padding: "var(--space-4)" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
              <h3 style={{ margin: 0, fontSize: "0.9rem" }}>
                👥 Recipients
                {selected.size > 0 && (
                  <span style={{ marginLeft: 8, padding: "2px 8px", background: "var(--clr-brand)", color: "white", borderRadius: 10, fontSize: "0.72rem", fontWeight: 700 }}>
                    {selected.size}
                  </span>
                )}
              </h3>
              <div style={{ display: "flex", gap: 6 }}>
                <button className="btn btn-ghost btn-sm" style={{ fontSize: "0.72rem" }} onClick={selectAll}>All</button>
                <button className="btn btn-ghost btn-sm" style={{ fontSize: "0.72rem" }} onClick={selectNone}>None</button>
              </div>
            </div>

            {/* Search */}
            <div style={{ position: "relative", marginBottom: 10 }}>
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
                style={{ position: "absolute", left: 9, top: "50%", transform: "translateY(-50%)", color: "var(--clr-text-muted)", pointerEvents: "none" }}>
                <circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/>
              </svg>
              <input className="input" style={{ paddingLeft: 28, fontSize: "0.82rem" }}
                placeholder="Search by name or @username…"
                value={contactSearch} onChange={e => setContactSearch(e.target.value)} />
            </div>

            {/* Source filter pills */}
            <div style={{ display: "flex", gap: 6, marginBottom: 10 }}>
              {[
                { label: "Admins", icon: "🔑", count: contacts.filter(c => c.source === "admin").length, filter: "admin" },
                { label: "Students", icon: "🎓", count: contacts.filter(c => c.source === "respondent").length, filter: "respondent" },
              ].map(p => (
                <button key={p.filter} className="btn btn-ghost btn-sm"
                  style={{ fontSize: "0.72rem", border: "1px solid var(--clr-border)", flex: 1 }}
                  onClick={() => setSelected(new Set(contacts.filter(c => c.source === p.filter).map(c => c.telegramId)))}>
                  {p.icon} {p.label} ({p.count})
                </button>
              ))}
            </div>

            {/* Contact list */}
            <div style={{ maxHeight: 420, overflowY: "auto", display: "flex", flexDirection: "column", gap: 4, scrollbarWidth: "thin" }}>
              {loadingContacts ? (
                [1,2,3,4].map(i => <div key={i} className="skeleton" style={{ height: 48, borderRadius: 8 }} />)
              ) : filtered.length === 0 ? (
                <div style={{ textAlign: "center", color: "var(--clr-text-muted)", padding: "24px 0", fontSize: "0.82rem" }}>
                  No contacts found.<br />
                  <span style={{ fontSize: "0.72rem" }}>Users appear here after answering a quiz.</span>
                </div>
              ) : filtered.map(c => {
                const isSel = selected.has(c.telegramId);
                return (
                  <button key={c.telegramId} onClick={() => toggle(c.telegramId)}
                    style={{
                      display: "flex", alignItems: "center", gap: 10, padding: "8px 10px",
                      background: isSel ? "var(--clr-brand-muted)" : "var(--clr-bg-elevated)",
                      border: `1px solid ${isSel ? "var(--clr-brand)" : "var(--clr-border)"}`,
                      borderRadius: 8, cursor: "pointer", textAlign: "left", transition: "all 0.15s",
                    }}>
                    <div style={{ width: 32, height: 32, borderRadius: "50%", background: "var(--clr-bg-card)", border: `2px solid ${isSel ? "var(--clr-brand)" : "transparent"}`, display: "flex", alignItems: "center", justifyContent: "center", fontSize: "0.8rem", fontWeight: 700, flexShrink: 0, overflow: "hidden" }}>
                      {c.photoUrl ? <img src={c.photoUrl} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} /> : c.firstName.charAt(0).toUpperCase()}
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: "0.82rem", fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: isSel ? "var(--clr-brand)" : "var(--clr-text-primary)" }}>
                        {c.firstName}
                      </div>
                      <div style={{ fontSize: "0.68rem", color: "var(--clr-text-muted)" }}>
                        {c.username ? `@${c.username}` : `ID: ${c.telegramId}`}
                        <span style={{ marginLeft: 4, color: c.source === "admin" ? "var(--clr-warning)" : "var(--clr-accent)", fontWeight: 500 }}>
                          · {c.source === "admin" ? "admin" : "student"}
                        </span>
                      </div>
                    </div>
                    {isSel && <span style={{ color: "var(--clr-brand)", fontSize: "0.85rem", flexShrink: 0 }}>✓</span>}
                  </button>
                );
              })}
            </div>

            {filtered.length > 0 && (
              <div style={{ marginTop: 8, fontSize: "0.72rem", color: "var(--clr-text-muted)", textAlign: "center" }}>
                {filtered.length} contacts · {selected.size} selected
              </div>
            )}
          </div>
        </div>

        {/* ── Right: Composer ── */}
        <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-4)" }}>

          {/* Message Type Selector */}
          <div className="card animate-fade-up" style={{ padding: "var(--space-4)" }}>
            <h3 style={{ margin: "0 0 12px", fontSize: "0.9rem" }}>📝 Message Type</h3>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(100px, 1fr))", gap: 8 }}>
              {MSG_TYPES.map(t => (
                <button key={t.value} onClick={() => setMsgType(t.value)}
                  title={t.desc}
                  style={{
                    display: "flex", flexDirection: "column", alignItems: "center", gap: 4,
                    padding: "10px 8px", borderRadius: 10, cursor: "pointer",
                    background: msgType === t.value ? "var(--clr-brand-muted)" : "var(--clr-bg-elevated)",
                    border: `2px solid ${msgType === t.value ? "var(--clr-brand)" : "var(--clr-border)"}`,
                    transition: "all 0.15s",
                  }}>
                  <span style={{ fontSize: "1.3rem" }}>{t.icon}</span>
                  <span style={{ fontSize: "0.72rem", fontWeight: 600, color: msgType === t.value ? "var(--clr-brand)" : "var(--clr-text-secondary)" }}>
                    {t.label}
                  </span>
                </button>
              ))}
            </div>
          </div>

          {/* Composer body */}
          <div className="card animate-fade-up animate-delay-1" style={{ padding: "var(--space-4)", display: "flex", flexDirection: "column", gap: "var(--space-4)" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <h3 style={{ margin: 0, fontSize: "0.9rem" }}>✍️ Compose</h3>
              {(msgType === "text") && (
                <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                  <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: "0.78rem", color: "var(--clr-text-muted)", cursor: "pointer" }}>
                    <div className="toggle-switch" style={{ transform: "scale(0.75)" }}>
                      <input type="checkbox" checked={preview} onChange={e => setPreview(e.target.checked)} />
                      <span className="toggle-slider" />
                    </div>
                    Preview
                  </label>
                  <select className="select" style={{ fontSize: "0.78rem", padding: "3px 8px", height: 28 }}
                    value={parseMode} onChange={e => setParseMode(e.target.value as "HTML" | "Markdown")}>
                    <option value="HTML">HTML</option>
                    <option value="Markdown">Markdown</option>
                  </select>
                </div>
              )}
            </div>

            {/* Text */}
            {msgType === "text" && (
              <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                {/* Templates */}
                <div>
                  <label className="input-label" style={{ marginBottom: 6 }}>Quick Templates</label>
                  <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                    {HTML_TEMPLATES.map(tpl => (
                      <button key={tpl.label} className="btn btn-ghost btn-sm"
                        style={{ fontSize: "0.72rem", border: "1px solid var(--clr-border)" }}
                        onClick={() => setText(tpl.text)}>
                        {tpl.icon} {tpl.label}
                      </button>
                    ))}
                  </div>
                </div>

                {preview ? (
                  <div style={{ padding: "12px 16px", background: "#1a1a2e", borderRadius: 12, border: "1px solid var(--clr-border)", minHeight: 120, fontSize: "0.9rem", lineHeight: 1.6 }}>
                    <div style={{ fontSize: "0.7rem", color: "var(--clr-text-muted)", marginBottom: 8 }}>📱 Telegram Preview</div>
                    <div dangerouslySetInnerHTML={{ __html: previewHtml }} />
                  </div>
                ) : (
                  <textarea className="input" rows={8} placeholder={`Write your message in ${parseMode} format…\n\nHTML: <b>bold</b>, <i>italic</i>, <code>mono</code>\nMarkdown: **bold**, *italic*, \`mono\``}
                    value={text} onChange={e => setText(e.target.value)}
                    style={{ resize: "vertical", fontFamily: "var(--font-mono, monospace)", fontSize: "0.85rem" }} />
                )}
                <div style={{ fontSize: "0.72rem", color: "var(--clr-text-muted)", textAlign: "right" }}>{text.length} chars</div>
              </div>
            )}

            {/* Media URL */}
            {["photo","document","audio","video"].includes(msgType) && (
              <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                <div>
                  <label className="input-label">
                    {msgType === "photo" ? "🖼️" : msgType === "document" ? "📄" : msgType === "audio" ? "🎵" : "🎬"} {" "}
                    {msgType.charAt(0).toUpperCase() + msgType.slice(1)} URL
                    <span style={{ fontWeight: 400, color: "var(--clr-text-muted)", marginLeft: 6 }}>
                      (public HTTPS link)
                    </span>
                  </label>
                  <input className="input" placeholder={`https://example.com/file.${msgType === "photo" ? "jpg" : msgType === "document" ? "pdf" : msgType === "audio" ? "mp3" : "mp4"}`}
                    value={mediaUrl} onChange={e => setMediaUrl(e.target.value)} />
                </div>
                <div>
                  <label className="input-label">Caption <span style={{ fontWeight: 400, color: "var(--clr-text-muted)" }}>(optional)</span></label>
                  <textarea className="input" rows={3} placeholder="Caption with HTML formatting…"
                    value={caption} onChange={e => setCaption(e.target.value)} style={{ resize: "vertical" }} />
                </div>
              </div>
            )}

            {/* Poll */}
            {msgType === "poll" && (
              <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                <div>
                  <label className="input-label">Poll Question</label>
                  <input className="input" placeholder="Ask a question…"
                    value={pollQuestion} onChange={e => setPollQuestion(e.target.value)} maxLength={300} />
                </div>
                <div>
                  <label className="input-label">Options (min 2, max 10)</label>
                  <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                    {pollOptions.map((opt, i) => (
                      <div key={i} style={{ display: "flex", gap: 6, alignItems: "center" }}>
                        <span style={{ fontSize: "0.75rem", color: "var(--clr-text-muted)", width: 20, textAlign: "center" }}>{String.fromCharCode(65+i)}</span>
                        <input className="input" style={{ flex: 1 }} placeholder={`Option ${String.fromCharCode(65+i)}…`}
                          value={opt} onChange={e => { const o = [...pollOptions]; o[i] = e.target.value; setPollOptions(o); }} />
                        {pollOptions.length > 2 && (
                          <button className="btn btn-ghost btn-sm" style={{ color: "var(--clr-danger)", padding: "0 8px" }}
                            onClick={() => setPollOptions(pollOptions.filter((_, j) => j !== i))}>✕</button>
                        )}
                      </div>
                    ))}
                    {pollOptions.length < 10 && (
                      <button className="btn btn-ghost btn-sm" style={{ alignSelf: "flex-start", fontSize: "0.78rem" }}
                        onClick={() => setPollOptions([...pollOptions, ""])}>+ Add option</button>
                    )}
                  </div>
                </div>
                <label style={{ display: "flex", alignItems: "center", gap: 10, cursor: "pointer" }}>
                  <div className="toggle-switch">
                    <input type="checkbox" checked={pollAnonymous} onChange={e => setPollAnonymous(e.target.checked)} />
                    <span className="toggle-slider" />
                  </div>
                  <span style={{ fontSize: "0.85rem" }}>Anonymous poll</span>
                </label>
              </div>
            )}

            {/* Inline Buttons */}
            {msgType !== "poll" && (
              <div>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
                  <label className="input-label" style={{ margin: 0 }}>
                    🔘 Inline Buttons <span style={{ fontWeight: 400, color: "var(--clr-text-muted)" }}>(optional)</span>
                  </label>
                  {buttons.length < 5 && (
                    <button className="btn btn-ghost btn-sm" style={{ fontSize: "0.72rem" }}
                      onClick={() => setButtons([...buttons, { text: "", url: "" }])}>+ Add Button</button>
                  )}
                </div>
                {buttons.map((btn, i) => (
                  <div key={i} style={{ display: "flex", gap: 6, marginBottom: 6, alignItems: "center" }}>
                    <input className="input" placeholder="Button label" value={btn.text} style={{ flex: "0 0 140px" }}
                      onChange={e => { const b = [...buttons]; b[i].text = e.target.value; setButtons(b); }} />
                    <input className="input" placeholder="https://link.com" value={btn.url} style={{ flex: 1 }}
                      onChange={e => { const b = [...buttons]; b[i].url = e.target.value; setButtons(b); }} />
                    <button className="btn btn-ghost btn-sm" style={{ color: "var(--clr-danger)", padding: "0 8px" }}
                      onClick={() => setButtons(buttons.filter((_, j) => j !== i))}>✕</button>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Send Settings + Button */}
          <div className="card animate-fade-up animate-delay-2" style={{ padding: "var(--space-4)" }}>
            <div style={{ display: "flex", gap: "var(--space-4)", flexWrap: "wrap", alignItems: "center" }}>
              <div style={{ flex: 1, minWidth: 200 }}>
                <label className="input-label">⏱ Delay between sends</label>
                <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                  <input type="range" min={300} max={3000} step={100} value={delayMs}
                    onChange={e => setDelayMs(Number(e.target.value))}
                    style={{ flex: 1, accentColor: "var(--clr-brand)" }} />
                  <span style={{ fontSize: "0.82rem", color: "var(--clr-text-muted)", width: 50 }}>{(delayMs/1000).toFixed(1)}s</span>
                </div>
                <div style={{ fontSize: "0.68rem", color: "var(--clr-text-muted)", marginTop: 2 }}>
                  Est. time: ~{Math.ceil((selected.size * delayMs) / 1000)}s for {selected.size} recipients
                </div>
              </div>

              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                <button className="btn btn-primary"
                  disabled={!isValid() || sending}
                  onClick={handleSend}
                  style={{ minWidth: 200, justifyContent: "center", fontSize: "0.95rem" }}>
                  {sending ? (
                    <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <span className="spinner" style={{ width: 14, height: 14 }} />
                      Sending…
                    </span>
                  ) : (
                    `📨 Send to ${selected.size} recipient${selected.size !== 1 ? "s" : ""}`
                  )}
                </button>
                {!isValid() && selected.size > 0 && (
                  <div style={{ fontSize: "0.72rem", color: "var(--clr-warning)", textAlign: "center" }}>
                    {msgType === "poll" ? "Add a question and 2+ options" : msgType === "text" ? "Write a message first" : "Add a file URL first"}
                  </div>
                )}
                {selected.size === 0 && (
                  <div style={{ fontSize: "0.72rem", color: "var(--clr-text-muted)", textAlign: "center" }}>
                    Select at least one recipient
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Results */}
          {results && (
            <div className="card animate-fade-up" style={{ padding: "var(--space-4)" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
                <h3 style={{ margin: 0, fontSize: "0.9rem" }}>📊 Send Results</h3>
                <div style={{ display: "flex", gap: 10, fontSize: "0.82rem" }}>
                  <span style={{ color: "var(--clr-success)", fontWeight: 600 }}>✅ {results.filter(r => r.ok).length} sent</span>
                  {results.filter(r => !r.ok).length > 0 && (
                    <span style={{ color: "var(--clr-danger)", fontWeight: 600 }}>❌ {results.filter(r => !r.ok).length} failed</span>
                  )}
                </div>
              </div>

              {/* Progress bar */}
              <div style={{ height: 6, borderRadius: 3, background: "var(--clr-bg-elevated)", overflow: "hidden", marginBottom: 12 }}>
                <div style={{
                  height: "100%", borderRadius: 3,
                  width: `${(results.filter(r => r.ok).length / results.length) * 100}%`,
                  background: "var(--grad-brand)", transition: "width 0.5s",
                }} />
              </div>

              {/* Failures only */}
              {results.filter(r => !r.ok).length > 0 && (
                <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                  <div style={{ fontSize: "0.75rem", color: "var(--clr-text-muted)", fontWeight: 600, marginBottom: 4 }}>Failed deliveries:</div>
                  {results.filter(r => !r.ok).map(r => {
                    const c = contacts.find(c => c.telegramId === r.telegramId);
                    return (
                      <div key={r.telegramId} style={{ display: "flex", gap: 8, alignItems: "center", padding: "6px 10px", background: "rgba(239,68,68,0.08)", border: "1px solid rgba(239,68,68,0.2)", borderRadius: 6, fontSize: "0.78rem" }}>
                        <span style={{ color: "var(--clr-danger)" }}>❌</span>
                        <span style={{ fontWeight: 500 }}>{c?.firstName || r.telegramId}</span>
                        <span style={{ color: "var(--clr-text-muted)", flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>— {r.error}</span>
                      </div>
                    );
                  })}
                  <div style={{ fontSize: "0.7rem", color: "var(--clr-text-muted)", marginTop: 4 }}>
                    💡 Users must have started a chat with the bot first (send /start).
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
