"use client";

import { useState, useEffect } from "react";
import { useParams } from "next/navigation";

const uid = () => Math.random().toString(36).substr(2, 9);

interface QuizPreview {
  id: string;
  question: string;
  options: string[];
  type: "quiz" | "poll";
  correctOptionId?: number | null;
  explanation?: string;
  topicId?: number;
  topicName?: string;
  isAnonymous?: boolean;
  allowsMultiple?: boolean;
  openPeriod?: number;
  tags?: string[];
  errors?: string[];
}

interface Topic { message_thread_id: number; name: string; icon_color: number; }

function validate(p: Partial<QuizPreview>): string[] {
  const e: string[] = [];
  if (!p.question?.trim()) e.push("Question is missing");
  else if (p.question.length > 300) e.push("Question exceeds 300 chars");
  if (!p.options || p.options.filter(o => o.trim()).length < 2) e.push("Need at least 2 options");
  else if (p.options.length > 10) e.push("Max 10 options");
  if (p.type === "quiz" && (p.correctOptionId === undefined || p.correctOptionId === null || p.correctOptionId < 0))
    e.push("Quiz needs a correct answer");
  return e;
}

function parseSmartText(text: string): QuizPreview[] {
  const chunks = text.split(/\n\s*\n/);
  const items: QuizPreview[] = [];
  for (const chunk of chunks) {
    if (!chunk.trim()) continue;
    const lines = chunk.split("\n").map(l => l.trim()).filter(Boolean);
    let question = "", options: string[] = [], correctAnswerStr = "", explanationStr = "";

    for (const line of lines) {
      // Answer / Explanation keywords
      if (/^(answer|correct answer|correct|الجواب|الإجابة)\s*:/i.test(line)) {
        correctAnswerStr = line.split(":").slice(1).join(":").trim();
        continue;
      }
      if (/^(explanation|note|شرح|ملاحظة)\s*:/i.test(line)) {
        explanationStr = line.split(":").slice(1).join(":").trim();
        continue;
      }

      const isLetterOption  = /^[a-dA-Dأبجد][\.\)]\s+\S/.test(line); // A. text  or  أ. text
      const isBulletOption  = /^[-•*]\s+\S/.test(line);                // - text  or  • text
      const isNumberedLine  = /^\d+[\.\)]\s+\S/.test(line);            // 1. text

      if (isLetterOption || isBulletOption) {
        // Always an answer option
        options.push(line.replace(/^[a-dA-Dأبجد][\.\)]\s+|^[-•*]\s+/, "").trim());
      } else if (isNumberedLine && question) {
        // Numbered line AND question is already set → it's a numbered option (1. text)
        options.push(line.replace(/^\d+[\.\)]\s+/, "").trim());
      } else {
        // Everything else → question text (or trailing explanation)
        if (options.length === 0) {
          question += (question ? "\n" : "") + line;
        } else {
          explanationStr += (explanationStr ? " " : "") + line;
        }
      }
    }

    // Strip leading "Q1:" or "1." prefix from question
    question = question.replace(/^q\s*\d*\s*:\s*/i, "").replace(/^\d+[\.\)]\s+/, "").trim();
    let correctOptionId: number | null = null;
    if (correctAnswerStr && options.length > 0) {
      const arabicMap: Record<string, number> = { "أ": 0, "ب": 1, "ج": 2, "د": 3 };
      if (arabicMap[correctAnswerStr] !== undefined) {
        correctOptionId = arabicMap[correctAnswerStr];
      } else {
        const m = correctAnswerStr.toLowerCase().match(/^[a-d]/);
        if (m) { const c = m[0].charCodeAt(0) - 97; if (c < options.length) correctOptionId = c; }
        else {
          const idx = options.findIndex(o => o.toLowerCase() === correctAnswerStr.toLowerCase());
          if (idx !== -1) correctOptionId = idx;
          else { const n = Number(correctAnswerStr); if (!isNaN(n) && n >= 0 && n < options.length) correctOptionId = n; }
        }
      }
    }
    if (question || options.length > 0) {
      const partial = { question, options, correctOptionId, explanation: explanationStr || undefined, type: correctOptionId !== null ? "quiz" as const : "poll" as const };
      items.push({ id: uid(), ...partial, errors: validate(partial) });
    }
  }
  return items;
}

function parseCSV(text: string): QuizPreview[] {
  const lines = text.split(/\r?\n/).filter(l => l.trim());
  const items: QuizPreview[] = [];
  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i].split(",");
    if (cols.length < 3) continue;
    const question = cols[0]?.trim();
    const options = [cols[1], cols[2], cols[3], cols[4]].filter(Boolean).map(o => o.trim());
    const cStr = cols[5]?.trim();
    const correctOptionId = cStr && !isNaN(Number(cStr)) ? Number(cStr) : null;
    const explanation = cols[6]?.trim() || undefined;
    const partial = { question, options, correctOptionId, explanation, type: correctOptionId !== null ? "quiz" as const : "poll" as const };
    items.push({ id: uid(), ...partial, errors: validate(partial) });
  }
  return items;
}

export default function BulkPage() {
  const { groupId } = useParams() as { groupId: string };
  const [mode, setMode] = useState<"smart" | "file">("smart");
  const [rawText, setRawText] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [queue, setQueue] = useState<QuizPreview[]>([]);
  const [uploading, setUploading] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; processed?: number; errors?: string[] } | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [notification, setNotification] = useState<{ type: "success" | "info"; msg: string } | null>(null);

  // Global settings
  const [globalTopicId, setGlobalTopicId] = useState<number | "">("");
  const [globalTopicName, setGlobalTopicName] = useState("");
  const [globalAnonymous, setGlobalAnonymous] = useState(true);
  const [globalDuration, setGlobalDuration] = useState(0);
  const [globalAllowMultiple, setGlobalAllowMultiple] = useState(false);
  const [globalTags, setGlobalTags] = useState("");
  const [topics, setTopics] = useState<Topic[]>([]);

  useEffect(() => {
    fetch(`/api/groups/${groupId}/topics`).then(r => r.json()).then(d => setTopics(d.topics || [])).catch(() => {});
  }, [groupId]);

  const notify = (type: "success" | "info", msg: string) => {
    setNotification({ type, msg });
    setTimeout(() => setNotification(null), 3000);
  };

  const addToQueue = (items: QuizPreview[]) => {
    if (items.length === 0) return;
    setQueue(prev => [...prev, ...items]);
    notify("success", `Added ${items.length} quiz${items.length > 1 ? "zes" : ""} to queue`);
  };

  const handleExtract = () => {
    const items = parseSmartText(rawText);
    if (items.length === 0) { notify("info", "No quizzes found — check your format"); return; }
    addToQueue(items);
    setRawText("");
  };

  const handleFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (!f) return;
    setFile(f);
    const text = await f.text();
    try {
      let items: QuizPreview[];
      if (f.name.endsWith(".json")) {
        const json = JSON.parse(text);
        const raw = Array.isArray(json) ? json : json.quizzes || [];
        items = raw.map((item: QuizPreview) => {
          const type = item.correctOptionId !== undefined && item.correctOptionId !== null ? "quiz" : "poll";
          return { ...item, id: uid(), type, errors: validate({ ...item, type }) };
        });
      } else {
        items = parseCSV(text);
      }
      addToQueue(items);
      e.target.value = "";
      setFile(null);
    } catch { alert("Failed to parse file."); }
  };

  const applyGlobal = () => {
    const tags = globalTags.split(",").map(t => t.trim()).filter(Boolean);
    setQueue(prev => prev.map(p => {
      const updated = {
        ...p,
        topicId: globalTopicId === "" ? undefined : (globalTopicId as number),
        topicName: globalTopicName || undefined,
        isAnonymous: globalAnonymous,
        openPeriod: globalDuration > 0 ? globalDuration : undefined,
        allowsMultiple: p.type === "poll" ? globalAllowMultiple : false,
        tags: tags.length > 0 ? tags : undefined,
      };
      return { ...updated, errors: validate(updated) };
    }));
    notify("success", "Applied to all queued quizzes");
  };

  const deleteItem = (id: string) => setQueue(prev => prev.filter(p => p.id !== id));
  const clearQueue = () => { setQueue([]); setResult(null); };

  const updateItem = (id: string, updates: Partial<QuizPreview>) => {
    setQueue(prev => prev.map(p => {
      if (p.id !== id) return p;
      const next = { ...p, ...updates };
      return { ...next, errors: validate(next) };
    }));
  };

  const handleSend = async (action: "send" | "save") => {
    if (queue.length === 0) return;
    setUploading(true);
    setResult(null);
    try {
      const res = await fetch(`/api/groups/${groupId}/bulk`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, quizzes: queue }),
      });
      const data = await res.json();
      setResult({ ok: res.ok, processed: data.processed, errors: data.errors || (!res.ok ? [data.error] : undefined) });
      if (res.ok) setQueue([]);
    } catch { setResult({ ok: false, errors: ["Network error"] }); }
    finally { setUploading(false); }
  };

  const downloadTemplate = (type: "csv" | "json" | "txt") => {
    const files: Record<string, [string, string, string]> = {
      csv: ["question,option1,option2,option3,option4,correctIndex,explanation\nWhat is 2+2?,3,4,5,6,1,Basic math", "quizforge_template.csv", "text/csv"],
      json: [JSON.stringify([{ question: "Example?", options: ["A", "B", "C"], correctOptionId: 0, explanation: "A is correct" }], null, 2), "quizforge_template.json", "application/json"],
      txt: ["1. What is 2+2?\nA. 3\nB. 4\nC. 5\nAnswer: B\nExplanation: Basic math", "quizforge_template.txt", "text/plain"],
    };
    const [content, name, mime] = files[type];
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([content], { type: mime }));
    a.download = name; a.click();
  };

  const hasErrors = queue.some(p => p.errors && p.errors.length > 0);
  const validCount = queue.filter(p => !p.errors || p.errors.length === 0).length;

  return (
    <div>
      {notification && (
        <div style={{ position: "fixed", top: 80, right: 24, zIndex: 200, padding: "10px 18px", borderRadius: "var(--radius-md)", background: notification.type === "success" ? "var(--clr-success)" : "var(--clr-brand)", color: "#fff", fontWeight: 600, fontSize: "0.875rem", boxShadow: "var(--shadow-lg)", animation: "fade-up 0.2s ease" }}>
          {notification.msg}
        </div>
      )}

      <div className="section-header animate-fade-up">
        <div>
          <h1>Smart Import</h1>
          <p>Paste, extract, queue and mass-deploy quizzes at scale.</p>
        </div>
        {queue.length > 0 && (
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <button className="btn btn-ghost" onClick={clearQueue} style={{ color: "var(--clr-danger)" }}>
              Clear Queue
            </button>
            <button className="btn btn-ghost" onClick={() => handleSend("save")} disabled={uploading}>
              📁 Save to Library
            </button>
            <button className="btn btn-primary" onClick={() => handleSend("send")} disabled={uploading || validCount === 0}>
              {uploading ? `Broadcasting… (ETA ~${queue.length * 3}s)` : `🚀 Send ${validCount} Quiz${validCount !== 1 ? "zes" : ""}`}
            </button>
          </div>
        )}
      </div>

      <div style={{ display: "grid", gap: "var(--space-5)" }}>

        {/* Step 1 — Input */}
        <div className="card animate-fade-up animate-delay-1">
          <div style={{ display: "flex", gap: 8, marginBottom: "var(--space-4)", borderBottom: "1px solid var(--clr-border)", paddingBottom: "var(--space-3)" }}>
            <button className={`btn btn-sm ${mode === "smart" ? "btn-primary" : "btn-ghost"}`} onClick={() => setMode("smart")}>🧠 Smart Paste</button>
            <button className={`btn btn-sm ${mode === "file" ? "btn-primary" : "btn-ghost"}`} onClick={() => setMode("file")}>📁 File Upload</button>
          </div>

          {mode === "smart" && (
            <div>
              <p style={{ fontSize: "0.82rem", color: "var(--clr-text-muted)", marginBottom: "var(--space-3)" }}>
                Supports: numbered lists, A/B/C/D or أ/ب/ج/د, Answer: X, Explanation: Y. Each question separated by blank line.
              </p>
              <textarea
                className="input"
                style={{ minHeight: 180, fontFamily: "monospace", fontSize: "0.85rem", resize: "vertical" }}
                placeholder={"1. What is the capital of France?\nA. Berlin\nB. Paris\nC. Rome\nAnswer: B\nExplanation: Paris is the capital.\n\n2. Next question..."}
                value={rawText}
                onChange={e => setRawText(e.target.value)}
              />
              <button className="btn btn-secondary" style={{ marginTop: "var(--space-3)", width: "100%" }} onClick={handleExtract}>
                ➕ Extract & Add to Queue
              </button>
            </div>
          )}

          {mode === "file" && (
            <div>
              <div style={{ display: "flex", gap: 8, marginBottom: 12, flexWrap: "wrap" }}>
                <button className="btn btn-ghost btn-sm" onClick={() => downloadTemplate("csv")}>⬇ CSV Template</button>
                <button className="btn btn-ghost btn-sm" onClick={() => downloadTemplate("json")}>⬇ JSON Template</button>
                <button className="btn btn-ghost btn-sm" onClick={() => downloadTemplate("txt")}>⬇ TXT Template</button>
              </div>
              <div style={{ padding: "var(--space-6)", border: "2px dashed var(--clr-border)", borderRadius: "var(--radius-lg)", textAlign: "center", background: "var(--clr-bg-surface)" }}>
                <input type="file" accept=".csv,.json,.txt" onChange={handleFile} style={{ display: "none" }} id="bulk-upload" />
                <label htmlFor="bulk-upload" className="btn btn-secondary" style={{ cursor: "pointer" }}>
                  Select File & Add to Queue
                </label>
                <p style={{ marginTop: 8, fontSize: "0.8rem", color: "var(--clr-text-muted)" }}>
                  {file ? `✓ ${file.name}` : "CSV, JSON, or TXT • Appends to existing queue"}
                </p>
              </div>
            </div>
          )}
        </div>

        {/* Step 2 — Global Settings (only when queue has items) */}
        {queue.length > 0 && (
          <div className="card animate-fade-up animate-delay-2">
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "var(--space-4)", flexWrap: "wrap", gap: 8 }}>
              <h3 style={{ margin: 0 }}>Global Settings</h3>
              <button className="btn btn-secondary btn-sm" onClick={applyGlobal}>⚡ Apply to All</button>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 12 }}>
              <div>
                <label className="input-label">Topic</label>
                <select className="select" value={globalTopicId} onChange={e => {
                  const id = e.target.value;
                  setGlobalTopicId(id ? Number(id) : "");
                  setGlobalTopicName(topics.find(t => t.message_thread_id === Number(id))?.name || "");
                }}>
                  <option value="">General</option>
                  {topics.map(t => <option key={t.message_thread_id} value={t.message_thread_id}>{t.name}</option>)}
                </select>
              </div>
              <div>
                <label className="input-label">Tags (comma separated)</label>
                <input className="input" value={globalTags} onChange={e => setGlobalTags(e.target.value)} placeholder="math, easy" />
              </div>
              <div>
                <label className="input-label">Duration (sec, 0=∞)</label>
                <input type="number" className="input" value={globalDuration} min={0} onChange={e => setGlobalDuration(Number(e.target.value))} />
              </div>
            </div>
            <div style={{ display: "flex", gap: 16, marginTop: 12, flexWrap: "wrap", fontSize: "0.85rem" }}>
              <label style={{ display: "flex", alignItems: "center", gap: 6, cursor: "pointer" }}>
                <input type="checkbox" checked={globalAnonymous} onChange={e => setGlobalAnonymous(e.target.checked)} /> Anonymous
              </label>
              <label style={{ display: "flex", alignItems: "center", gap: 6, cursor: "pointer" }}>
                <input type="checkbox" checked={globalAllowMultiple} onChange={e => setGlobalAllowMultiple(e.target.checked)} /> Multiple Answers
              </label>
            </div>
          </div>
        )}

        {/* Step 3 — Queue */}
        {queue.length > 0 && (
          <div className="card animate-fade-up animate-delay-3" style={{ border: "1px solid var(--clr-brand)" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "var(--space-4)", flexWrap: "wrap", gap: 8 }}>
              <div>
                <h3 style={{ margin: 0 }}>Queue — {queue.length} item{queue.length !== 1 ? "s" : ""}</h3>
                {hasErrors && <p style={{ fontSize: "0.8rem", color: "var(--clr-danger)", marginTop: 4 }}>⚠ Some items have validation errors</p>}
              </div>
              {uploading && (
                <span style={{ fontSize: "0.82rem", color: "var(--clr-text-muted)" }}>
                  ⏳ ETA ~{queue.length * 3}s (rate-limited)
                </span>
              )}
            </div>

            {result && (
              <div style={{ padding: "var(--space-3)", borderRadius: "var(--radius-md)", marginBottom: "var(--space-4)", background: result.ok ? "var(--clr-success-muted)" : "var(--clr-danger-muted)", color: result.ok ? "var(--clr-success)" : "var(--clr-danger)", fontSize: "0.875rem" }}>
                <b>{result.ok ? `✓ Sent ${result.processed} quizzes successfully!` : "Errors occurred:"}</b>
                {result.errors && <ul style={{ marginTop: 6, paddingLeft: 20 }}>{result.errors.map((e, i) => <li key={i}>{e}</li>)}</ul>}
              </div>
            )}

            <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-3)", maxHeight: 580, overflowY: "auto", paddingRight: 4 }}>
              {queue.map((p, idx) => {
                const isEditing = editingId === p.id;
                const hasErr = p.errors && p.errors.length > 0;
                return (
                  <div key={p.id} style={{ padding: "var(--space-4)", background: "var(--clr-bg-elevated)", border: `1px solid ${hasErr ? "var(--clr-danger)" : "var(--clr-border)"}`, borderRadius: "var(--radius-md)" }}>
                    {/* Row header */}
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: hasErr ? 8 : 12, gap: 8, flexWrap: "wrap" }}>
                      <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                        <span className={`badge ${p.type === "quiz" ? "badge-brand" : "badge-accent"}`}>{p.type.toUpperCase()}</span>
                        <span style={{ fontSize: "0.78rem", color: "var(--clr-text-muted)" }}>#{idx + 1}</span>
                        {hasErr && <span className="badge" style={{ background: "var(--clr-danger-muted)", color: "var(--clr-danger)" }}>⚠ Fix needed</span>}
                        {p.topicName && <span className="badge badge-muted" style={{ fontSize: "0.72rem" }}>📍 {p.topicName}</span>}
                      </div>
                      <div style={{ display: "flex", gap: 4 }}>
                        <button className="btn btn-ghost btn-sm" onClick={() => setEditingId(isEditing ? null : p.id)} style={{ fontSize: "0.8rem" }}>
                          {isEditing ? "✓ Done" : "✏️ Edit"}
                        </button>
                        <button className="btn btn-ghost btn-sm" style={{ color: "var(--clr-danger)" }} onClick={() => deleteItem(p.id)}>🗑</button>
                      </div>
                    </div>

                    {/* Error list */}
                    {hasErr && (
                      <div style={{ fontSize: "0.78rem", color: "var(--clr-danger)", marginBottom: 10, padding: "6px 10px", background: "rgba(248,113,113,0.08)", borderRadius: 6 }}>
                        {p.errors?.map((e, i) => <div key={i}>• {e}</div>)}
                      </div>
                    )}

                    {/* Edit mode */}
                    {isEditing ? (
                      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                        <textarea className="input" rows={3} value={p.question} onChange={e => updateItem(p.id, { question: e.target.value })} placeholder="Question text" />
                        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                          {p.options.map((opt, oIdx) => (
                            <div key={oIdx} style={{ display: "flex", gap: 8, alignItems: "center" }}>
                              <input type="radio" name={`correct-${p.id}`} checked={p.correctOptionId === oIdx}
                                onChange={() => updateItem(p.id, { correctOptionId: oIdx, type: "quiz" })}
                                title="Mark as correct" />
                              <input className="input" value={opt} onChange={e => {
                                const opts = [...p.options]; opts[oIdx] = e.target.value;
                                updateItem(p.id, { options: opts });
                              }} style={{ flex: 1 }} />
                              {p.options.length > 2 && (
                                <button className="btn btn-ghost btn-sm" style={{ color: "var(--clr-danger)", padding: "0 6px" }}
                                  onClick={() => { const opts = p.options.filter((_, i) => i !== oIdx); updateItem(p.id, { options: opts, correctOptionId: p.correctOptionId === oIdx ? null : p.correctOptionId }); }}>✕</button>
                              )}
                            </div>
                          ))}
                          {p.options.length < 10 && (
                            <button className="btn btn-ghost btn-sm" style={{ alignSelf: "flex-start" }}
                              onClick={() => updateItem(p.id, { options: [...p.options, ""] })}>+ Add Option</button>
                          )}
                        </div>
                        <input className="input" value={p.explanation || ""} onChange={e => updateItem(p.id, { explanation: e.target.value })} placeholder="Explanation (optional)" />
                      </div>
                    ) : (
                      <>
                        <div style={{ fontWeight: 500, marginBottom: 10, lineHeight: 1.4, wordBreak: "break-word" }}>{p.question}</div>
                        <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
                          {p.options.map((o, i) => (
                            <div key={i} style={{
                              padding: "5px 10px", borderRadius: "var(--radius-sm)", fontSize: "0.84rem",
                              background: p.correctOptionId === i ? "var(--clr-success-muted)" : "rgba(255,255,255,0.02)",
                              border: `1px solid ${p.correctOptionId === i ? "var(--clr-success)" : "transparent"}`,
                              color: p.correctOptionId === i ? "var(--clr-success)" : "var(--clr-text-secondary)"
                            }}>
                              <b>{String.fromCharCode(65 + i)}.</b> {o}
                            </div>
                          ))}
                        </div>
                        {p.explanation && (
                          <div style={{ marginTop: 10, fontSize: "0.78rem", color: "var(--clr-text-muted)", padding: "6px 10px", background: "rgba(0,0,0,0.25)", borderRadius: 6 }}>
                            💡 {p.explanation}
                          </div>
                        )}
                      </>
                    )}
                  </div>
                );
              })}
            </div>

            {/* Bottom send bar */}
            <div style={{ marginTop: "var(--space-4)", paddingTop: "var(--space-4)", borderTop: "1px solid var(--clr-border)", display: "flex", gap: 8, flexWrap: "wrap" }}>
              <button className="btn btn-ghost" onClick={() => handleSend("save")} disabled={uploading} style={{ flex: 1, minWidth: 140 }}>
                📁 Save to Library
              </button>
              <button className="btn btn-primary" onClick={() => handleSend("send")} disabled={uploading || validCount === 0} style={{ flex: 2, minWidth: 180 }}>
                {uploading ? `⏳ Broadcasting…` : `🚀 Send ${validCount} Valid Quiz${validCount !== 1 ? "zes" : ""} Now`}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
