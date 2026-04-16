"use client";

import { useEffect, useState, useCallback } from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";

interface Topic {
  message_thread_id: number;
  name: string;
  icon_color: number;
  is_closed?: boolean;
}

interface Toast {
  id: number;
  type: "success" | "error" | "info";
  message: string;
}

let toastId = 0;

export default function NewQuizPage() {
  const params = useParams();
  const router = useRouter();
  const searchParams = useSearchParams();
  const groupId = params.groupId as string;

  // Form state
  const [question, setQuestion] = useState("");
  const [optionCount, setOptionCount] = useState(4);
  const [options, setOptions] = useState<string[]>(["", "", "", ""]);
  const [correctOptionId, setCorrectOptionId] = useState<number | null>(null);
  const [explanation, setExplanation] = useState("");
  const [type, setType] = useState<"quiz" | "poll">("quiz");
  const [isAnonymous, setIsAnonymous] = useState(true);
  const [allowsMultiple, setAllowsMultiple] = useState(false);
  const [openPeriod, setOpenPeriod] = useState(0);
  const [selectedTopic, setSelectedTopic] = useState<Topic | null>(null);
  const [scheduledAt, setScheduledAt] = useState<string>("");
  const [topics, setTopics] = useState<Topic[]>([]);
  const [loadingTopics, setLoadingTopics] = useState(false);
  const [sending, setSending] = useState(false);
  const [savingTemplate, setSavingTemplate] = useState(false);
  const [sentCount, setSentCount] = useState(0);
  const [toasts, setToasts] = useState<Toast[]>([]);

  // Load draft from URL (for duplication)
  useEffect(() => {
    const draftParam = searchParams.get("draft");
    if (draftParam) {
      try {
        const draft = JSON.parse(decodeURIComponent(draftParam));
        if (draft.question) setQuestion(draft.question);
        if (draft.options?.length) {
          setOptions(draft.options);
          setOptionCount(draft.options.length);
        }
        if (draft.type) setType(draft.type);
        if (draft.correctOptionId !== undefined) setCorrectOptionId(draft.correctOptionId);
        if (draft.explanation) setExplanation(draft.explanation);
        if (draft.isAnonymous !== undefined) setIsAnonymous(draft.isAnonymous);
        if (draft.allowsMultiple !== undefined) setAllowsMultiple(draft.allowsMultiple);
        if (draft.openPeriod) setOpenPeriod(draft.openPeriod);
      } catch {
        console.error("Failed to load draft from URL");
      }
    }
  }, [searchParams]);

  // Load topics
  useEffect(() => {
    setLoadingTopics(true);
    fetch(`/api/groups/${groupId}/topics`)
      .then((r) => r.json())
      .then((d) => {
        setTopics(d.topics || []);
        setLoadingTopics(false);
      })
      .catch(() => setLoadingTopics(false));
  }, [groupId]);

  const addToast = useCallback((type: Toast["type"], message: string) => {
    const id = ++toastId;
    setToasts((prev) => [...prev, { id, type, message }]);
    setTimeout(() => setToasts((prev) => prev.filter((t) => t.id !== id)), 4000);
  }, []);

  // Adjust option count
  const setOptionCountSafe = (n: number) => {
    const count = Math.min(10, Math.max(2, n));
    setOptionCount(count);
    setOptions((prev) => {
      const next = [...prev];
      while (next.length < count) next.push("");
      return next.slice(0, count);
    });
    if (correctOptionId !== null && correctOptionId >= count) {
      setCorrectOptionId(null);
    }
  };

  const handleOptionChange = (idx: number, value: string) => {
    setOptions((prev) => {
      const next = [...prev];
      next[idx] = value;
      return next;
    });
  };

  const resetForm = () => {
    setQuestion("");
    setOptions(["", "", "", ""]);
    setOptionCount(4);
    setCorrectOptionId(null);
    setExplanation("");
    setScheduledAt("");
    // Intentionally preserve: type, isAnonymous, allowsMultiple, openPeriod, selectedTopic
    // so you can send multiple quizzes to the same topic without re-configuring
  };

  const handleSend = async () => {
    // Validate
    if (!question.trim()) return addToast("error", "Please enter a question.");
    if (options.some((o) => !o.trim())) return addToast("error", "All option fields must be filled.");
    if (type === "quiz" && correctOptionId === null) return addToast("error", "Select the correct answer.");

    setSending(true);
    try {
      const res = await fetch(`/api/groups/${groupId}/quiz/send`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          question,
          options: options.map((o) => o.trim()),
          type,
          isAnonymous,
          correctOptionId: type === "quiz" ? correctOptionId : undefined,
          explanation: explanation.trim() || undefined,
          allowsMultiple: type === "poll" ? allowsMultiple : false,
          openPeriod: openPeriod > 0 ? openPeriod : undefined,
          topicId: selectedTopic?.message_thread_id,
          topicName: selectedTopic?.name,
          scheduledAt: scheduledAt || undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to send");
      
      const newCount = sentCount + 1;
      setSentCount(newCount);
      const isScheduled = !!scheduledAt;
      addToast("success", isScheduled 
        ? `⏰ Quiz #${newCount} scheduled! Form cleared — ready for next quiz.`
        : `✅ Quiz #${newCount} sent to Telegram! Form cleared — ready for next quiz.`
      );
      resetForm();
    } catch (e) {
      addToast("error", e instanceof Error ? e.message : "Unknown error");
    } finally {
      setSending(false);
    }
  };

  const handleSaveTemplate = async () => {
    if (!question.trim() || options.some((o) => !o.trim())) {
      return addToast("error", "Fill in the question and all options first.");
    }
    setSavingTemplate(true);
    try {
      const res = await fetch("/api/templates", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          question,
          options: options.map((o) => o.trim()),
          type,
          isAnonymous,
          correctOptionId: type === "quiz" ? correctOptionId : null,
          explanation: explanation.trim() || null,
          allowsMultiple,
          openPeriod,
        }),
      });
      if (res.ok) addToast("success", "Template saved! ✅");
      else addToast("error", "Failed to save template");
    } catch {
      addToast("error", "Network error");
    } finally {
      setSavingTemplate(false);
    }
  };

  const OPEN_PERIOD_OPTIONS = [
    { label: "No limit", value: 0 },
    { label: "30 seconds", value: 30 },
    { label: "1 minute", value: 60 },
    { label: "5 minutes", value: 300 },
    { label: "10 minutes", value: 600 },
    { label: "30 minutes", value: 1800 },
    { label: "1 hour", value: 3600 },
    { label: "24 hours", value: 86400 },
  ];

  const topicColor = (color: number) => `#${color.toString(16).padStart(6, "0")}`;

  return (
    <div>
      {/* Toast */}
      <div className="toast-container">
        {toasts.map((t) => (
          <div key={t.id} className={`toast toast-${t.type}`}>
            {t.type === "success" ? "✓" : t.type === "error" ? "✕" : "ℹ"}
            {t.message}
          </div>
        ))}
      </div>

      {/* Header */}
      <div className="section-header animate-fade-up" style={{ marginBottom: "var(--space-8)" }}>
        <div>
          <h1>{searchParams.get("draft") ? "Edit Duplicate" : "Create Quiz"}</h1>
          <p style={{ display: "flex", alignItems: "center", gap: "var(--space-2)" }}>
            Build and send a Telegram quiz or poll
            {sentCount > 0 && (
              <span style={{ 
                background: "var(--clr-success-muted)", color: "var(--clr-success)",
                border: "1px solid rgba(52,211,153,0.3)", borderRadius: "var(--radius-full)",
                padding: "2px 10px", fontSize: "0.75rem", fontWeight: 700,
              }}>
                ✓ {sentCount} sent this session
              </span>
            )}
          </p>
        </div>
        <div style={{ display: "flex", gap: "var(--space-3)", flexWrap: "wrap" }}>
          {sentCount > 0 && (
            <Link
              href={`/dashboard/${groupId}/history`}
              className="btn btn-ghost btn-sm"
              style={{ border: "1px solid var(--clr-border)" }}
            >
              📋 View History ({sentCount})
            </Link>
          )}
          <button
            className="btn btn-secondary"
            onClick={handleSaveTemplate}
            disabled={savingTemplate}
          >
            {savingTemplate ? "Saving…" : "💾 Save as Template"}
          </button>
          <button
            className="btn btn-primary btn-lg"
            onClick={handleSend}
            disabled={sending}
          >
            {sending ? (
              <>
                <span style={{ display: "inline-block", width: 16, height: 16, border: "2px solid rgba(255,255,255,0.3)", borderTopColor: "white", borderRadius: "50%", animation: "spin 0.6s linear infinite" }} />
                Sending…
              </>
            ) : (
              <>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M22 2L11 13M22 2L15 22l-4-9-9-4 20-7z"/>
                </svg>
                Send to Telegram
              </>
            )}
          </button>
        </div>
      </div>

      <div className="quiz-builder">
        {/* Left: Form */}
        <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-5)" }}>

          {/* Type selector */}
          <div className="card animate-fade-up animate-delay-1">
            <h4 style={{ marginBottom: "var(--space-4)" }}>Quiz Type</h4>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "var(--space-3)" }}>
              {(["quiz", "poll"] as const).map((t) => (
                <button
                  key={t}
                  className={`btn ${type === t ? "btn-primary" : "btn-secondary"}`}
                  onClick={() => {
                    setType(t);
                    if (t === "poll") setCorrectOptionId(null);
                  }}
                  style={{ height: 56, flexDirection: "column", gap: 4 }}
                >
                  <span style={{ fontSize: "1.2rem" }}>{t === "quiz" ? "🎯" : "📊"}</span>
                  <span style={{ fontSize: "0.8rem" }}>{t === "quiz" ? "Quiz (correct answer)" : "Poll (multiple choice)"}</span>
                </button>
              ))}
            </div>
          </div>

          {/* Question */}
          <div className="card animate-fade-up animate-delay-2">
            <div className="input-wrapper">
              <label className="input-label">Question</label>
              <textarea
                className="input"
                placeholder="Enter your question here… (up to 300 characters)"
                value={question}
                onChange={(e) => setQuestion(e.target.value.slice(0, 300))}
                rows={3}
              />
              <div className={`char-count ${question.length > 270 ? "near" : ""} ${question.length >= 300 ? "over" : ""}`}>
                {question.length}/300
              </div>
            </div>
          </div>

          {/* Options */}
          <div className="card animate-fade-up animate-delay-3">
            {/* Option count stepper */}
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "var(--space-5)" }}>
              <h4>Answer Options</h4>
              <div className="step-display">
                <button className="step-btn" onClick={() => setOptionCountSafe(optionCount - 1)}>−</button>
                <span className="step-value">{optionCount}</span>
                <button className="step-btn" onClick={() => setOptionCountSafe(optionCount + 1)}>+</button>
              </div>
            </div>

            {type === "quiz" && (
              <p style={{ fontSize: "0.8rem", color: "var(--clr-text-muted)", marginBottom: "var(--space-4)", background: "var(--clr-bg-elevated)", padding: "var(--space-3)", borderRadius: "var(--radius-md)" }}>
                <strong style={{ color: "var(--clr-success)" }}>✓</strong> Click the circle on the left of the correct answer to mark it
              </p>
            )}

            <div className="options-list">
              {options.map((opt, idx) => (
                <div
                  key={idx}
                  className={`option-row ${type === "quiz" && correctOptionId === idx ? "correct" : ""}`}
                >
                  {/* Correct answer selector */}
                  {type === "quiz" ? (
                    <button
                      className={`option-correct-check ${correctOptionId === idx ? "selected" : ""}`}
                      onClick={() => setCorrectOptionId(idx)}
                      title="Mark as correct answer"
                    >
                      {correctOptionId === idx && (
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3">
                          <path d="M20 6L9 17l-5-5"/>
                        </svg>
                      )}
                    </button>
                  ) : (
                    <div className="option-number">{String.fromCharCode(65 + idx)}</div>
                  )}

                  <input
                    className="input"
                    placeholder={`Option ${String.fromCharCode(65 + idx)}${type === "quiz" ? (correctOptionId === idx ? " ← Correct" : "") : ""}`}
                    value={opt}
                    onChange={(e) => handleOptionChange(idx, e.target.value.slice(0, 100))}
                    style={type === "quiz" && correctOptionId === idx ? { borderColor: "var(--clr-success)", background: "rgba(52,211,153,0.05)" } : {}}
                  />
                </div>
              ))}
            </div>
          </div>

          {/* Explanation (quiz only) */}
          {type === "quiz" && (
            <div className="card animate-fade-up animate-delay-4">
              <div className="input-wrapper">
                <label className="input-label">Explanation (optional)</label>
                <textarea
                  className="input"
                  placeholder="Shown after answering — explain the correct answer (up to 200 chars)"
                  value={explanation}
                  onChange={(e) => setExplanation(e.target.value.slice(0, 200))}
                  rows={3}
                />
                <div className={`char-count ${explanation.length > 180 ? "near" : ""}`}>
                  {explanation.length}/200
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Right: Settings + Preview */}
        <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-5)" }}>

          {/* Settings */}
          <div className="card" style={{ position: "sticky", top: "calc(var(--header-height) + var(--space-6))" }}>
            <h4 style={{ marginBottom: "var(--space-5)" }}>Settings</h4>

            {/* Schedule */}
            <div className="input-wrapper" style={{ marginBottom: "var(--space-4)" }}>
              <label className="input-label">Schedule (Send Later)</label>
              <input
                type="datetime-local"
                className="input"
                value={scheduledAt}
                onChange={(e) => setScheduledAt(e.target.value)}
                min={new Date().toISOString().slice(0, 16)}
              />
              <div className="toggle-desc">Leave blank to send immediately</div>
            </div>

            {/* Topic */}
            <div className="input-wrapper" style={{ marginBottom: "var(--space-4)" }}>
              <label className="input-label">Send to Topic</label>
              {loadingTopics ? (
                <div className="skeleton" style={{ height: 44 }} />
              ) : topics.length > 0 ? (
                <select
                  className="select"
                  value={selectedTopic?.message_thread_id || ""}
                  onChange={(e) => {
                    const t = topics.find((t) => t.message_thread_id === parseInt(e.target.value));
                    setSelectedTopic(t || null);
                  }}
                >
                  <option value="">General (no topic)</option>
                  {topics.map((t) => (
                    <option key={t.message_thread_id} value={t.message_thread_id}>
                      {t.name}
                    </option>
                  ))}
                </select>
              ) : (
                <div style={{ padding: "11px var(--space-4)", background: "var(--clr-bg-elevated)", borderRadius: "var(--radius-md)", color: "var(--clr-text-muted)", fontSize: "0.875rem", border: "1px solid var(--clr-border)" }}>
                  No topics found (or group has no forum mode)
                </div>
              )}
            </div>

            {/* Open period */}
            <div className="input-wrapper" style={{ marginBottom: "var(--space-4)" }}>
              <label className="input-label">Auto-close After</label>
              <select
                className="select"
                value={openPeriod}
                onChange={(e) => setOpenPeriod(parseInt(e.target.value))}
              >
                {OPEN_PERIOD_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>{o.label}</option>
                ))}
              </select>
            </div>

            {/* Toggles */}
            <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-3)" }}>
              {/* Anonymous */}
              <label className="toggle-group">
                <div className="toggle-info">
                  <div className="toggle-title">Anonymous Poll</div>
                  <div className="toggle-desc">Hide voter identities from results</div>
                </div>
                <div className="toggle-switch">
                  <input
                    type="checkbox"
                    checked={isAnonymous}
                    onChange={(e) => setIsAnonymous(e.target.checked)}
                  />
                  <span className="toggle-slider" />
                </div>
              </label>

              {/* Multiple (polls only) */}
              {type === "poll" && (
                <label className="toggle-group">
                  <div className="toggle-info">
                    <div className="toggle-title">Multiple Answers</div>
                    <div className="toggle-desc">Allow selecting more than one option</div>
                  </div>
                  <div className="toggle-switch">
                    <input
                      type="checkbox"
                      checked={allowsMultiple}
                      onChange={(e) => setAllowsMultiple(e.target.checked)}
                    />
                    <span className="toggle-slider" />
                  </div>
                </label>
              )}
            </div>
          </div>

          {/* Live Preview */}
          <div className="quiz-preview">
            <h4 style={{ marginBottom: "var(--space-4)", color: "var(--clr-text-secondary)", fontSize: "0.8rem", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.08em" }}>
              Live Preview
            </h4>
            {selectedTopic && (
              <div style={{ display: "flex", alignItems: "center", gap: "var(--space-2)", marginBottom: "var(--space-3)", fontSize: "0.78rem" }}>
                <span style={{ width: 10, height: 10, borderRadius: "50%", background: topicColor(selectedTopic.icon_color), display: "inline-block" }} />
                <span style={{ color: "var(--clr-text-muted)" }}># {selectedTopic.name}</span>
              </div>
            )}
            <div className="preview-phone">
              <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: "var(--space-3)" }}>
                <div style={{ width: 28, height: 28, borderRadius: "50%", background: "#4f7fff" }} />
                <div>
                  <div style={{ fontSize: "0.8rem", fontWeight: 600, color: "#a0b4e8" }}>@agridmu_bot</div>
                </div>
                <span style={{ marginLeft: "auto", fontSize: "0.7rem", color: "#5a6a8a" }}>now</span>
              </div>
              <div className="preview-message">
                {type === "quiz" && (
                  <div style={{ fontSize: "0.68rem", color: "#4f7fff", fontWeight: 700, marginBottom: 6, textTransform: "uppercase", letterSpacing: "0.05em" }}>
                    🎯 Quiz
                  </div>
                )}
                <div className="preview-question">
                  {question || "Your question will appear here…"}
                </div>
                {options.slice(0, optionCount).map((opt, idx) => (
                  <div
                    key={idx}
                    className={`preview-option ${type === "quiz" && correctOptionId === idx ? "correct" : ""}`}
                  >
                    {opt || `Option ${String.fromCharCode(65 + idx)}`}
                    {type === "quiz" && correctOptionId === idx && (
                      <span style={{ float: "right" }}>✓</span>
                    )}
                  </div>
                ))}
                {explanation && (
                  <div style={{ marginTop: 8, fontSize: "0.78rem", color: "#8090b0", borderTop: "1px solid rgba(255,255,255,0.08)", paddingTop: 8 }}>
                    💡 {explanation}
                  </div>
                )}
                {!isAnonymous && (
                  <div style={{ fontSize: "0.7rem", color: "#5a6a8a", marginTop: 6 }}>👤 Non-anonymous</div>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>

      <style>{`
        @keyframes spin {
          to { transform: rotate(360deg); }
        }
      `}</style>
    </div>
  );
}
