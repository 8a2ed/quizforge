"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { E } from "@/lib/emoji";

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
  const [openPeriod, setOpenPeriod] = useState(60);
  const [selectedTopic, setSelectedTopic] = useState<Topic | null>(null);
  const [scheduledAt, setScheduledAt] = useState<string>("");
  const [recurrence, setRecurrence] = useState<string>("");
  // Image attachment
  const [imageMode, setImageMode] = useState<"url" | "file">("url");
  const [mediaUrl, setMediaUrl] = useState<string>("");
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [imageBase64, setImageBase64] = useState<string>("");
  const [imageMimeType, setImageMimeType] = useState<string>("image/jpeg");
  const [imagePreviewUrl, setImagePreviewUrl] = useState<string>("");
  // Poll behaviour
  const [shuffleOptions, setShuffleOptions] = useState(false);
  const [showDuration, setShowDuration] = useState(false);
  const [allowAddingOptions, setAllowAddingOptions] = useState(false);
  const [allowRevoting, setAllowRevoting] = useState(false);
  // Topics
  const [topics, setTopics] = useState<Topic[]>([]);
  const [loadingTopics, setLoadingTopics] = useState(false);
  const [topicError, setTopicError] = useState<string | null>(null);
  const [showManualTopic, setShowManualTopic] = useState(false);
  const [manualTopicId, setManualTopicId] = useState("");
  const [manualTopicName, setManualTopicName] = useState("");
  const [addingTopic, setAddingTopic] = useState(false);
  // Tags
  const [tags, setTags] = useState<string[]>([]);
  const [tagInput, setTagInput] = useState("");
  // UI
  const [sending, setSending] = useState(false);
  const [savingTemplate, setSavingTemplate] = useState(false);
  const [sentCount, setSentCount] = useState(0);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);

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
        if (draft.tags && Array.isArray(draft.tags)) setTags(draft.tags);
        if (draft.allowAddingOptions !== undefined) setAllowAddingOptions(draft.allowAddingOptions);
        if (draft.allowRevoting !== undefined) setAllowRevoting(draft.allowRevoting);
      } catch {
        console.error("Failed to load draft from URL");
      }
    }
  }, [searchParams]);

  // Load topics
  const loadTopics = useCallback(() => {
    setLoadingTopics(true);
    setTopicError(null);
    fetch(`/api/groups/${groupId}/topics`)
      .then((r) => r.json())
      .then((d) => {
        setTopics(d.topics || []);
        if (d.telegramError) setTopicError(d.telegramError);
        setLoadingTopics(false);
      })
      .catch(() => {
        setTopicError("Network error fetching topics");
        setLoadingTopics(false);
      });
  }, [groupId]);

  useEffect(() => { loadTopics(); }, [loadTopics]);

  const handleAddManualTopic = async () => {
    if (!manualTopicId || !manualTopicName.trim()) return;
    setAddingTopic(true);
    try {
      const res = await fetch(`/api/groups/${groupId}/topics`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ topicId: Number(manualTopicId), name: manualTopicName.trim() }),
      });
      const data = await res.json();
      if (data.ok) {
        setManualTopicId("");
        setManualTopicName("");
        setShowManualTopic(false);
        loadTopics();
        addToast("success", `Topic "${data.topic.name}" added!`);
      }
    } finally {
      setAddingTopic(false);
    }
  };

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
    setRecurrence("");
    setMediaUrl("");
    setImageFile(null);
    setImageBase64("");
    setImagePreviewUrl("");
    setTags([]);
    setTagInput("");
    if (fileInputRef.current) fileInputRef.current.value = "";
    // Preserve: type, isAnonymous, allowsMultiple, openPeriod, selectedTopic, shuffleOptions
  };

  // Handle gallery / camera file selection
  const handleFileChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) {
      addToast("error", "Image too large - please pick one under 5 MB.");
      return;
    }
    setImageFile(file);
    setImageMimeType(file.type || "image/jpeg");
    // Blob URL for instant preview
    const blobUrl = URL.createObjectURL(file);
    setImagePreviewUrl(blobUrl);
    // Read as base64 for upload
    const reader = new FileReader();
    reader.onload = (ev) => {
      const result = ev.target?.result as string;
      // Strip the data:<type>;base64, prefix
      const base64 = result.split(",")[1] || "";
      setImageBase64(base64);
    };
    reader.readAsDataURL(file);
  }, [addToast]);

  const handleSend = async () => {
    if (!question.trim()) return addToast("error", "Please enter a question.");
    if (options.some((o) => !o.trim())) return addToast("error", "All option fields must be filled.");
    if (type === "quiz" && correctOptionId === null) return addToast("error", "Select the correct answer.");

    // Client-side option shuffle (remaps correctOptionId accordingly)
    let finalOptions = options.map((o) => o.trim());
    let finalCorrectId = correctOptionId;
    if (shuffleOptions && finalOptions.length > 1) {
      const indexed = finalOptions.map((opt, i) => ({ opt, i }));
      for (let i = indexed.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [indexed[i], indexed[j]] = [indexed[j], indexed[i]];
      }
      finalOptions = indexed.map((x) => x.opt);
      if (correctOptionId !== null) {
        finalCorrectId = indexed.findIndex((x) => x.i === correctOptionId);
      }
    }

    setSending(true);
    try {
      const res = await fetch(`/api/groups/${groupId}/quiz/send`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          question,
          options: finalOptions,
          type,
          isAnonymous,
          correctOptionId: type === "quiz" ? finalCorrectId : undefined,
          explanation: explanation.trim() || undefined,
          allowsMultiple: type === "poll" ? allowsMultiple : false,
          openPeriod: showDuration && openPeriod > 0 ? openPeriod : undefined,
          topicId: selectedTopic?.message_thread_id,
          topicName: selectedTopic?.name,
          scheduledAt: scheduledAt || undefined,
          mediaUrl: imageMode === "url" ? mediaUrl.trim() || undefined : undefined,
          mediaBase64: imageMode === "file" && imageBase64 ? imageBase64 : undefined,
          mediaMimeType: imageMode === "file" && imageBase64 ? imageMimeType : undefined,
          recurrence: scheduledAt && recurrence ? recurrence : undefined,
          tags: tags.length > 0 ? tags : undefined,
          allowAddingOptions: type === "poll" ? allowAddingOptions : undefined,
          allowRevoting: type === "poll" ? allowRevoting : undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to send");

      const newCount = sentCount + 1;
      setSentCount(newCount);
      addToast("success",
        scheduledAt
          ? `â° Quiz #${newCount} scheduled!`
          : `${E.ok} Quiz #${newCount} sent to Telegram!`
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
      if (res.ok) addToast("success", `Template saved! ${E.ok}`);
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
            {t.type === "success" ? E.check : t.type === "error" ? E.cross : E.info}
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
                {E.check} {sentCount} sent this session
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
              {E.history} View History ({sentCount})
            </Link>
          )}
          <button
            className="btn btn-secondary"
            onClick={handleSaveTemplate}
            disabled={savingTemplate}
          >
            {savingTemplate ? "Saving..." : E.save + " Save as Template"}
          </button>
          <button
            className="btn btn-primary btn-lg"
            onClick={handleSend}
            disabled={sending}
          >
            {sending ? (
              <>
                <span style={{ display: "inline-block", width: 16, height: 16, border: "2px solid rgba(255,255,255,0.3)", borderTopColor: "white", borderRadius: "50%", animation: "spin 0.6s linear infinite" }} />
                Sending...
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
                  <span style={{ fontSize: "1.2rem" }}>{t === "quiz" ? E.quiz : E.poll}</span>
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
                placeholder={"Enter your question here... (up to 300 characters)"}
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
                <button className="step-btn" onClick={() => setOptionCountSafe(optionCount - 1)}>-</button>
                <span className="step-value">{optionCount}</span>
                <button className="step-btn" onClick={() => setOptionCountSafe(optionCount + 1)}>+</button>
              </div>
            </div>

            {type === "quiz" && (
              <p style={{ fontSize: "0.8rem", color: "var(--clr-text-muted)", marginBottom: "var(--space-4)", background: "var(--clr-bg-elevated)", padding: "var(--space-3)", borderRadius: "var(--radius-md)" }}>
                <strong style={{ color: "var(--clr-success)" }}>{E.check}</strong> Click the circle on the left of the correct answer to mark it
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
                    placeholder={`Option ${String.fromCharCode(65 + idx)}${type === "quiz" ? (correctOptionId === idx ? " â† Correct" : "") : ""}`}
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
                  placeholder={"Shown after answering - explain the correct answer (up to 200 chars)"}
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

          {/* â”€â”€ Settings Card â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */}
          <div className="card" style={{ position: "sticky", top: "calc(var(--header-height) + var(--space-4))" }}>

            {/* Image Attachment */}
            <div style={{ marginBottom: "var(--space-5)" }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "var(--space-2)" }}>
                <span style={{ fontSize: "0.78rem", fontWeight: 600, color: "var(--clr-text-muted)", textTransform: "uppercase", letterSpacing: "0.06em" }}>Image</span>
                <div style={{ display: "flex", background: "rgba(255,255,255,0.06)", borderRadius: 8, padding: 2, gap: 2 }}>
                  {(["url", "file"] as const).map((m) => (
                    <button key={m} onClick={() => { setImageMode(m); setMediaUrl(""); setImagePreviewUrl(""); setImageFile(null); setImageBase64(""); }}
                      style={{ padding: "3px 10px", borderRadius: 6, border: "none", cursor: "pointer", fontSize: "0.72rem", fontWeight: 600, transition: "all 0.15s",
                        background: imageMode === m ? "var(--clr-brand)" : "transparent",
                        color: imageMode === m ? "#fff" : "var(--clr-text-muted)" }}>
                      {m === "url" ? "URL" : "Upload"}
                    </button>
                  ))}
                </div>
              </div>

              {imageMode === "url" ? (
                <input className="input" type="url" placeholder="https://example.com/photo.jpg"
                  value={mediaUrl} onChange={(e) => { setMediaUrl(e.target.value); setImagePreviewUrl(e.target.value); }}
                  style={{ fontSize: "0.85rem" }} />
              ) : (
                <div>
                  <input ref={fileInputRef} type="file" accept="image/*"
                    style={{ display: "none" }} onChange={handleFileChange} />

                  <button className="btn btn-secondary"
                    style={{ width: "100%", justifyContent: "center", gap: 8, fontSize: "0.85rem" }}
                    onClick={() => fileInputRef.current?.click()}>
                    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/>
                      <path d="M21 15l-5-5L5 21"/>
                    </svg>
                    {imageFile ? "Change image" : "Gallery / Camera"}
                  </button>
                  {imageFile && (
                    <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 6, fontSize: "0.78rem", color: "var(--clr-text-secondary)" }}>
                      <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", flex: 1 }}>{imageFile.name}</span>
                      <button onClick={() => { setImageFile(null); setImageBase64(""); setImagePreviewUrl(""); if (fileInputRef.current) fileInputRef.current.value = ""; }}
                        style={{ background: "none", border: "none", cursor: "pointer", color: "var(--clr-danger)", fontSize: "1rem", lineHeight: 1 }}>{E.cross}</button>
                    </div>
                  )}
                </div>
              )}

              {imagePreviewUrl && (
                <div style={{
                  marginTop: 8,
                  borderRadius: 8,
                  overflow: "hidden",
                  height: 90,
                  width: "100%",
                  background: "rgba(0,0,0,0.3)",
                  flexShrink: 0,
                }}>
                  <img
                    src={imagePreviewUrl}
                    alt="Preview"
                    style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }}
                    onError={() => setImagePreviewUrl("")}
                  />
                </div>
              )}
            </div>

            {/* Tags */}
            <div style={{ marginBottom: "var(--space-4)" }}>
              <label className="input-label" style={{ marginBottom: "var(--space-2)" }}>{E.pin} Tags (Max 5)</label>
              <div style={{
                display: "flex", flexWrap: "wrap", gap: 6, padding: "6px 8px",
                border: "1px solid var(--clr-border)", borderRadius: "var(--radius-md)",
                background: "var(--clr-bg-base)", minHeight: 40, alignItems: "center"
              }}>
                {tags.map(tag => (
                  <span key={tag} className="badge badge-accent" style={{ display: "flex", alignItems: "center", gap: 4, padding: "2px 8px", fontSize: "0.75rem" }}>
                    #{tag}
                    <button type="button" onClick={() => setTags(ts => ts.filter(t => t !== tag))} style={{ background: "none", border: "none", color: "inherit", cursor: "pointer", marginLeft: 2, padding: 0, fontSize: "0.8rem", lineHeight: 1 }}>{E.cross}</button>
                  </span>
                ))}
                {tags.length < 5 && (
                  <input
                    type="text"
                    style={{ border: "none", background: "transparent", outline: "none", flex: 1, minWidth: 80, fontSize: "0.85rem", color: "var(--clr-text-primary)" }}
                    placeholder={tags.length === 0 ? "Add tag (press Enter or ,)" : "Add more..."}
                    value={tagInput}
                    onChange={(e) => setTagInput(e.target.value.replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 15))}
                    onKeyDown={(e) => {
                      if ((e.key === "Enter" || e.key === ",") && tagInput.trim()) {
                        e.preventDefault();
                        const newTag = tagInput.trim().toLowerCase();
                        if (newTag && !tags.includes(newTag)) {
                          setTags(ts => [...ts, newTag]);
                        }
                        setTagInput("");
                      } else if (e.key === "Backspace" && !tagInput && tags.length > 0) {
                        setTags(ts => ts.slice(0, -1));
                      }
                    }}
                  />
                )}
              </div>
            </div>

            {/* Schedule */}
            <div style={{ marginBottom: "var(--space-3)" }}>
              <label className="input-label">â° Schedule</label>
              <input type="datetime-local" className="input" value={scheduledAt}
                onChange={(e) => { setScheduledAt(e.target.value); if (!e.target.value) setRecurrence(""); }}
                min={new Date().toISOString().slice(0, 16)} style={{ fontSize: "0.85rem" }} />
            </div>

            {scheduledAt && (
              <div style={{ marginBottom: "var(--space-3)" }}>
                <label className="input-label">ðŸ” Repeat</label>
                <select className="select" value={recurrence} onChange={(e) => setRecurrence(e.target.value)} style={{ fontSize: "0.85rem" }}>
                  <option value="">No repeat</option>
                  <option value="daily">Daily</option>
                  <option value="weekly">Weekly</option>
                  <option value="biweekly">Every 2 weeks</option>
                  <option value="monthly">Monthly</option>
                </select>
              </div>
            )}

            {/* Topic */}
            <div style={{ marginBottom: "var(--space-4)" }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "var(--space-2)" }}>
                <label className="input-label" style={{ marginBottom: 0 }}>{E.topic} Topic</label>
                <button className="btn btn-ghost btn-sm" onClick={loadTopics} disabled={loadingTopics}
                  style={{ fontSize: "0.7rem", padding: "2px 6px" }}>
                  {loadingTopics ? "..." : "↻ Refresh"}
                </button>
              </div>
              {loadingTopics ? (
                <div className="skeleton" style={{ height: 40 }} />
              ) : topics.length > 0 ? (
                <select className="select" value={selectedTopic?.message_thread_id || ""}
                  onChange={(e) => { const t = topics.find((t) => t.message_thread_id === parseInt(e.target.value)); setSelectedTopic(t || null); }}
                  style={{ fontSize: "0.85rem" }}>
                  <option value="">General (no topic)</option>
                  {topics.map((t) => (
                    <option key={t.message_thread_id} value={t.message_thread_id}>
                      {t.is_closed ? E.lock + " " : ""}{t.name}
                    </option>
                  ))}
                </select>
              ) : (
                <div style={{ padding: "8px 12px", background: "rgba(251,191,36,0.08)", borderRadius: 8, border: "1px solid rgba(251,191,36,0.25)", fontSize: "0.78rem", color: "var(--clr-text-muted)" }}>
                  {topicError ? "Bot needs Manage Topics permission" : "No topics found"}
                </div>
              )}
              <button className="btn btn-ghost btn-sm" onClick={() => setShowManualTopic(!showManualTopic)}
                style={{ marginTop: 6, fontSize: "0.72rem", color: "var(--clr-text-muted)" }}>
                {showManualTopic ? "▲ Hide" : "＋ Add manually"}
              </button>
              {showManualTopic && (
                <div style={{ marginTop: 8, display: "flex", flexDirection: "column", gap: 8, padding: "var(--space-3)", background: "var(--clr-bg-elevated)", borderRadius: 8, border: "1px solid var(--clr-border)" }}>
                  <input className="input" placeholder="Topic ID (e.g. 3677)" type="number" value={manualTopicId}
                    onChange={e => setManualTopicId(e.target.value.replace(/\D/g, ""))} style={{ fontSize: "0.82rem" }} />
                  <input className="input" placeholder="Topic name" value={manualTopicName}
                    onChange={e => setManualTopicName(e.target.value)} style={{ fontSize: "0.82rem" }} />
                  <button className="btn btn-primary btn-sm" onClick={handleAddManualTopic}
                    disabled={addingTopic || !manualTopicId || !manualTopicName.trim()} style={{ justifyContent: "center" }}>
                    {addingTopic ? "Saving..." : "Save Topic"}
                  </button>
                </div>
              )}
            </div>

            {/* â”€â”€ Poll Behaviour Toggles â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */}
            <div style={{ borderTop: "1px solid var(--clr-border)", paddingTop: "var(--space-4)", display: "flex", flexDirection: "column", gap: 2 }}>
              <div style={{ fontSize: "0.72rem", fontWeight: 700, color: "var(--clr-text-muted)", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: "var(--space-2)" }}>
                Poll Options
              </div>

              {/* Show Who Voted */}
              <label style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "10px 0", cursor: "pointer", borderBottom: "1px solid rgba(255,255,255,0.04)" }}>
                <div>
                  <div style={{ fontSize: "0.875rem", fontWeight: 500, color: "var(--clr-text-primary)" }}>Show Who Voted</div>
                  <div style={{ fontSize: "0.72rem", color: "var(--clr-text-muted)" }}>Voter names visible in results</div>
                </div>
                <div className="toggle-switch">
                  <input type="checkbox" checked={!isAnonymous} onChange={(e) => setIsAnonymous(!e.target.checked)} />
                  <span className="toggle-slider" />
                </div>
              </label>

              {/* Multiple Answers â€” poll only */}
              {type === "poll" && (
                <>
                  <label style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "10px 0", cursor: "pointer", borderBottom: "1px solid rgba(255,255,255,0.04)" }}>
                    <div>
                      <div style={{ fontSize: "0.875rem", fontWeight: 500, color: "var(--clr-text-primary)" }}>Multiple Answers</div>
                      <div style={{ fontSize: "0.72rem", color: "var(--clr-text-muted)" }}>Select more than one option</div>
                    </div>
                    <div className="toggle-switch">
                      <input type="checkbox" checked={allowsMultiple} onChange={(e) => setAllowsMultiple(e.target.checked)} />
                      <span className="toggle-slider" />
                    </div>
                  </label>

                  <label style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "10px 0", cursor: "pointer", borderBottom: "1px solid rgba(255,255,255,0.04)" }}>
                    <div>
                      <div style={{ fontSize: "0.875rem", fontWeight: 500, color: "var(--clr-text-primary)" }}>Allow Adding Options</div>
                      <div style={{ fontSize: "0.72rem", color: "var(--clr-text-muted)" }}>Voters can suggest new options</div>
                    </div>
                    <div className="toggle-switch">
                      <input type="checkbox" checked={allowAddingOptions} onChange={(e) => setAllowAddingOptions(e.target.checked)} />
                      <span className="toggle-slider" />
                    </div>
                  </label>

                  <label style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "10px 0", cursor: "pointer", borderBottom: "1px solid rgba(255,255,255,0.04)" }}>
                    <div>
                      <div style={{ fontSize: "0.875rem", fontWeight: 500, color: "var(--clr-text-primary)" }}>Allow Revoting</div>
                      <div style={{ fontSize: "0.72rem", color: "var(--clr-text-muted)" }}>Voters can change their vote</div>
                    </div>
                    <div className="toggle-switch">
                      <input type="checkbox" checked={allowRevoting} onChange={(e) => setAllowRevoting(e.target.checked)} />
                      <span className="toggle-slider" />
                    </div>
                  </label>
                </>
              )}

              {/* Shuffle Options */}
              <label style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "10px 0", cursor: "pointer", borderBottom: "1px solid rgba(255,255,255,0.04)" }}>
                <div>
                  <div style={{ fontSize: "0.875rem", fontWeight: 500, color: "var(--clr-text-primary)" }}>Shuffle Options</div>
                  <div style={{ fontSize: "0.72rem", color: "var(--clr-text-muted)" }}>Random order per voter</div>
                </div>
                <div className="toggle-switch">
                  <input type="checkbox" checked={shuffleOptions} onChange={(e) => setShuffleOptions(e.target.checked)} />
                  <span className="toggle-slider" />
                </div>
              </label>

              {/* Limit Duration */}
              <label style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "10px 0", cursor: "pointer" }}>
                <div>
                  <div style={{ fontSize: "0.875rem", fontWeight: 500, color: "var(--clr-text-primary)" }}>Limit Duration</div>
                  <div style={{ fontSize: "0.72rem", color: "var(--clr-text-muted)" }}>Auto-close after a set time</div>
                </div>
                <div className="toggle-switch">
                  <input type="checkbox" checked={showDuration} onChange={(e) => { setShowDuration(e.target.checked); if (!e.target.checked) setOpenPeriod(0); }} />
                  <span className="toggle-slider" />
                </div>
              </label>
              {showDuration && (
                <select className="select" value={openPeriod} onChange={(e) => setOpenPeriod(parseInt(e.target.value))}
                  style={{ marginTop: 4, fontSize: "0.85rem" }}>
                  {OPEN_PERIOD_OPTIONS.filter(o => o.value > 0).map((o) => (
                    <option key={o.value} value={o.value}>{o.label}</option>
                  ))}
                </select>
              )}
            </div>
          </div>

          {/* â”€â”€ Live Preview â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */}
          <div className="quiz-preview">
            <h4 style={{ marginBottom: "var(--space-3)", color: "var(--clr-text-muted)", fontSize: "0.72rem", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.08em" }}>
              Preview
            </h4>
            {selectedTopic && (
              <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 8, fontSize: "0.75rem" }}>
                <span style={{ width: 8, height: 8, borderRadius: "50%", background: topicColor(selectedTopic.icon_color), display: "inline-block", flexShrink: 0 }} />
                <span style={{ color: "var(--clr-text-muted)" }}># {selectedTopic.name}</span>
              </div>
            )}
            <div className="preview-phone">
              <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 10 }}>
                <div style={{ width: 26, height: 26, borderRadius: "50%", background: "var(--grad-brand)", flexShrink: 0 }} />
                <div style={{ fontSize: "0.78rem", fontWeight: 600, color: "#a0b4e8" }}>@agridmu_bot</div>
                <span style={{ marginLeft: "auto", fontSize: "0.68rem", color: "#5a6a8a" }}>now</span>
              </div>

              {/* Image preview inside phone mock */}
              {imagePreviewUrl && (
                <div style={{
                  borderRadius: 8,
                  overflow: "hidden",
                  marginBottom: 8,
                  height: 90,
                  width: "100%",
                  flexShrink: 0,
                }}>
                  <img
                    src={imagePreviewUrl}
                    alt=""
                    style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }}
                    onError={() => {}}
                  />
                </div>
              )}

              <div className="preview-message">
                {type === "quiz" && (
                  <div style={{ fontSize: "0.65rem", color: "var(--clr-brand)", fontWeight: 700, marginBottom: 5, textTransform: "uppercase", letterSpacing: "0.05em" }}>
                    {E.quiz} Quiz
                  </div>
                )}
                <div className="preview-question">
                  {question || "Your question will appear here..."}
                </div>
                {options.slice(0, optionCount).map((opt, idx) => (
                  <div key={idx} className={`preview-option ${type === "quiz" && correctOptionId === idx ? "correct" : ""}`}>
                    {opt || `Option ${String.fromCharCode(65 + idx)}`}
                    {type === "quiz" && correctOptionId === idx && <span style={{ float: "right" }}>{E.check}</span>}
                  </div>
                ))}
                {explanation && (
                  <div style={{ marginTop: 7, fontSize: "0.75rem", color: "#8090b0", borderTop: "1px solid rgba(255,255,255,0.08)", paddingTop: 7 }}>
                    {E.bulb} {explanation}
                  </div>
                )}
                <div style={{ display: "flex", gap: 10, marginTop: 7, flexWrap: "wrap" }}>
                  {!isAnonymous && <span style={{ fontSize: "0.65rem", color: "#5a6a8a" }}>{E.user} Visible votes</span>}
                  {shuffleOptions && <span style={{ fontSize: "0.65rem", color: "#5a6a8a" }}>{E.shuffle} Shuffled</span>}
                  {showDuration && openPeriod > 0 && <span style={{ fontSize: "0.65rem", color: "#5a6a8a" }}>â± {OPEN_PERIOD_OPTIONS.find(o => o.value === openPeriod)?.label}</span>}
                  {scheduledAt && <span style={{ fontSize: "0.65rem", color: "#fbbf24" }}>â° Scheduled</span>}
                </div>
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
