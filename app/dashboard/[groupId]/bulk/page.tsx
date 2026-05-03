"use client";

import { useState, useEffect } from "react";
import { useParams } from "next/navigation";

// Utility to generate a unique ID
const uid = () => Math.random().toString(36).substr(2, 9);

interface QuizPreview {
  id: string;
  question: string;
  options: string[];
  type: "quiz" | "poll";
  correctOptionId?: number | null;
  explanation?: string;
  scheduledAt?: string;
  isAnonymous?: boolean;
  allowsMultiple?: boolean;
  allowAddingOptions?: boolean;
  allowRevoting?: boolean;
  openPeriod?: number;
  topicId?: number;
  topicName?: string;
  tags?: string[];
  errors?: string[];
}

interface Topic {
  message_thread_id: number;
  name: string;
  icon_color: number;
  is_closed?: boolean;
}

export default function BulkPage() {
  const params = useParams();
  const groupId = params.groupId as string;

  const [mode, setMode] = useState<"smart" | "file">("smart");
  const [rawText, setRawText] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [previews, setPreviews] = useState<QuizPreview[]>([]);
  const [uploading, setUploading] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; processed?: number; errors?: string[] } | null>(null);

  // Global Settings State
  const [globalTopicId, setGlobalTopicId] = useState<number | "">("");
  const [globalTopicName, setGlobalTopicName] = useState("");
  const [globalAnonymous, setGlobalAnonymous] = useState(true);
  const [globalDuration, setGlobalDuration] = useState(0);
  const [globalAllowsMultiple, setGlobalAllowsMultiple] = useState(false);
  const [globalAllowAdding, setGlobalAllowAdding] = useState(false);
  const [globalAllowRevoting, setGlobalAllowRevoting] = useState(false);
  const [globalTags, setGlobalTags] = useState("");

  const [topics, setTopics] = useState<Topic[]>([]);
  const [loadingTopics, setLoadingTopics] = useState(false);

  // Load Topics on mount
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

  // Validation function
  const validatePreview = (p: Partial<QuizPreview>): string[] => {
    const errs: string[] = [];
    if (!p.question || p.question.trim().length === 0) errs.push("Question is missing");
    else if (p.question.length > 300) errs.push("Question exceeds 300 characters limit");
    
    if (!p.options || p.options.filter(o => o.trim()).length < 2) {
      errs.push("Needs at least 2 non-empty options");
    } else if (p.options.length > 10) {
      errs.push("Maximum 10 options allowed");
    }
    
    if (p.type === "quiz" && (p.correctOptionId === undefined || p.correctOptionId === null || p.correctOptionId < 0)) {
      errs.push("Quiz type requires a correct answer");
    }
    return errs;
  };

  // Parsers
  const parseCSV = (text: string) => {
    const lines = text.split(/\r?\n/).filter((line) => line.trim());
    const items: QuizPreview[] = [];
    for (let i = 1; i < lines.length; i++) {
      const cols = lines[i].split(",");
      if (cols.length < 3) continue;

      const question = cols[0]?.trim();
      const options = [cols[1], cols[2], cols[3], cols[4]].filter(Boolean).map((o) => o?.trim()) as string[];
      const correctIdxStr = cols[5]?.trim();
      let correctOptionId = correctIdxStr && correctIdxStr !== "" && !isNaN(Number(correctIdxStr)) ? Number(correctIdxStr) : null;
      const explanation = cols[6]?.trim();
      const scheduledAt = cols[7]?.trim();

      const partial = {
        question,
        options,
        correctOptionId,
        explanation,
        scheduledAt: scheduledAt && scheduledAt !== "" ? new Date(scheduledAt).toISOString() : undefined,
        type: correctOptionId !== null ? "quiz" as const : "poll" as const,
      };

      items.push({
        id: uid(),
        ...partial,
        errors: validatePreview(partial)
      });
    }
    return items;
  };

  const parseSmartText = (text: string) => {
    const chunks = text.split(/\n\s*\n/);
    const items: QuizPreview[] = [];

    for (const chunk of chunks) {
      if (!chunk.trim()) continue;

      const lines = chunk.split("\n").map((l) => l.trim()).filter(Boolean);
      let question = "";
      let options: string[] = [];
      let correctAnswerStr = "";
      let explanationStr = "";

      for (const line of lines) {
        const lowerLine = line.toLowerCase();
        if (lowerLine.startsWith("answer:") || lowerLine.startsWith("correct answer:") || lowerLine.startsWith("correct:")) {
          correctAnswerStr = line.split(":")[1].trim();
        } else if (lowerLine.startsWith("explanation:") || lowerLine.startsWith("note:")) {
          explanationStr = line.split(":")[1].trim();
        } else if (/^[a-d]\.|^[a-d]\)|^-[ \t]+|^\d+\./i.test(line)) {
          options.push(line.replace(/^[a-d]\.|^[a-d]\)|^-[ \t]+|^\d+\./i, "").trim());
        } else {
          if (options.length === 0) {
            question += (question ? "\n" : "") + line;
          } else if (correctAnswerStr) {
            explanationStr += (explanationStr ? " " : "") + line;
          }
        }
      }

      question = question.replace(/^q\s*\d*:\s*/i, "").replace(/^\d+\.\s*/, "");

      let correctOptionId: number | null = null;
      if (correctAnswerStr && options.length > 0) {
        const answerMatch = correctAnswerStr.toLowerCase().match(/^[a-d]/);
        if (answerMatch) {
          const charCode = answerMatch[0].charCodeAt(0) - 97;
          if (charCode >= 0 && charCode < options.length) correctOptionId = charCode;
        } else {
          const idx = options.findIndex((opt) => opt.toLowerCase() === correctAnswerStr.toLowerCase());
          if (idx !== -1) correctOptionId = idx;
        }
      }

      const partial = {
        question,
        options,
        correctOptionId,
        explanation: explanationStr || undefined,
        type: correctOptionId !== null ? "quiz" as const : "poll" as const,
      };

      if (question || options.length > 0) {
        items.push({ id: uid(), ...partial, errors: validatePreview(partial) });
      }
    }
    return items;
  };

  const handleTextEval = () => {
    setPreviews(parseSmartText(rawText));
    setResult(null);
  };

  const handleFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const selected = e.target.files?.[0];
    if (!selected) return;
    setFile(selected);
    setResult(null);

    const text = await selected.text();
    try {
      if (selected.name.endsWith(".json")) {
        const json = JSON.parse(text);
        const rawItems = Array.isArray(json) ? json : json.quizzes || [];
        setPreviews(rawItems.map((item: any) => {
          const type = item.correctOptionId !== undefined && item.correctOptionId !== null ? "quiz" : "poll";
          return { ...item, id: uid(), type, errors: validatePreview({...item, type}) };
        }));
      } else if (selected.name.endsWith(".csv")) {
        setPreviews(parseCSV(text));
      } else {
        alert("Unsupported file format. Please use JSON or CSV.");
      }
    } catch {
      alert("Failed to parse file. Make sure it's valid.");
    }
  };

  // Actions
  const handleUpload = async (action: "send" | "save") => {
    if (previews.length === 0) return;
    setUploading(true);
    setResult(null);

    try {
      const res = await fetch(`/api/groups/${groupId}/bulk`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, quizzes: previews }),
      });
      const data = await res.json();
      setResult({ ok: res.ok, processed: data.processed, errors: data.errors || (!res.ok ? [data.error] : undefined) });
    } catch {
      setResult({ ok: false, errors: ["Network error"] });
    } finally {
      setUploading(false);
    }
  };

  const applyGlobalSettings = () => {
    const sanitizedTags = globalTags.split(",").map(t => t.trim()).filter(Boolean);
    setPreviews(prev => prev.map(p => {
      const updated = {
        ...p,
        topicId: globalTopicId === "" ? undefined : globalTopicId,
        topicName: globalTopicName || undefined,
        isAnonymous: globalAnonymous,
        allowsMultiple: p.type === "poll" ? globalAllowsMultiple : false,
        allowAddingOptions: p.type === "poll" ? globalAllowAdding : false,
        allowRevoting: p.type === "poll" ? globalAllowRevoting : false,
        openPeriod: globalDuration > 0 ? globalDuration : undefined,
        tags: sanitizedTags.length > 0 ? sanitizedTags : undefined,
      };
      return { ...updated, errors: validatePreview(updated) };
    }));
    alert("Applied global settings to all quizzes.");
  };

  const deletePreview = (id: string) => setPreviews(prev => prev.filter(p => p.id !== id));

  // Edit Inline
  const [editingId, setEditingId] = useState<string | null>(null);

  const updatePreview = (id: string, updates: Partial<QuizPreview>) => {
    setPreviews(prev => prev.map(p => {
      if (p.id === id) {
        const next = { ...p, ...updates };
        return { ...next, errors: validatePreview(next) };
      }
      return p;
    }));
  };

  // Downloads
  const downloadFile = (content: string, filename: string, type: string) => {
    const blob = new Blob([content], { type });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const downloadCSVTemplate = () => {
    downloadFile("question,option1,option2,option3,option4,correctIndex(0-3),explanation,scheduledAt(ISO)\nExample Question,Opt A,Opt B,Opt C,Opt D,1,Because B is true,", "quizforge_template.csv", "text/csv");
  };
  const downloadJSONTemplate = () => {
    const sample = [{ question: "Example", options: ["A", "B", "C"], correctOptionId: 1, explanation: "Details" }];
    downloadFile(JSON.stringify(sample, null, 2), "quizforge_template.json", "application/json");
  };
  const downloadTXTTemplate = () => {
    downloadFile("1. What is 2+2?\nA. 3\nB. 4\nC. 5\nAnswer: B\nExplanation: Math", "quizforge_template.txt", "text/plain");
  };

  return (
    <div>
      <div className="section-header animate-fade-up">
        <div>
          <h1>Smart Import & Staging</h1>
          <p>Extract, validate, edit, and mass-deploy quizzes.</p>
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr", gap: "var(--space-6)" }}>
        {/* Step 1: Input */}
        <div className="card animate-fade-up animate-delay-1">
          <div style={{ display: "flex", gap: "var(--space-2)", marginBottom: "var(--space-4)", borderBottom: "1px solid var(--clr-border)", paddingBottom: "var(--space-2)" }}>
            <button className={`btn ${mode === "smart" ? "btn-primary" : "btn-ghost"}`} onClick={() => { setMode("smart"); setFile(null); }}>
              🧠 AI Smart Paste
            </button>
            <button className={`btn ${mode === "file" ? "btn-primary" : "btn-ghost"}`} onClick={() => { setMode("file"); setRawText(""); }}>
              📁 File Upload
            </button>
          </div>

          {mode === "smart" && (
            <div>
              <p style={{ fontSize: "0.85rem", color: "var(--clr-text-secondary)", marginBottom: "var(--space-3)" }}>
                Paste AI-generated lists. We will auto-detect questions, options, and answers!
              </p>
              <textarea 
                className="input" 
                style={{ minHeight: "200px", fontFamily: "monospace", fontSize: "0.85rem" }}
                placeholder="Example:\n1. Question?\nA. Opt 1\nB. Opt 2\nAnswer: A"
                value={rawText}
                onChange={(e) => setRawText(e.target.value)}
              />
              <button className="btn btn-secondary" style={{ marginTop: "var(--space-3)", width: "100%" }} onClick={handleTextEval}>
                🔍 Auto-Extract Quizzes
              </button>
            </div>
          )}

          {mode === "file" && (
            <div>
              <div style={{ display: "flex", gap: 8, marginBottom: 16 }}>
                <button className="btn btn-ghost btn-sm" onClick={downloadCSVTemplate}>⬇️ CSV Template</button>
                <button className="btn btn-ghost btn-sm" onClick={downloadJSONTemplate}>⬇️ JSON Template</button>
                <button className="btn btn-ghost btn-sm" onClick={downloadTXTTemplate}>⬇️ TXT Template</button>
              </div>
              <div style={{ padding: "var(--space-6)", border: "2px dashed var(--clr-border)", borderRadius: "var(--radius-lg)", textAlign: "center", background: "var(--clr-bg-surface)" }}>
                <input type="file" accept=".csv,.json,.txt" onChange={handleFile} style={{ display: "none" }} id="bulk-upload" />
                <label htmlFor="bulk-upload" className="btn btn-secondary" style={{ cursor: "pointer" }}>
                  Select CSV or JSON file
                </label>
                <p style={{ marginTop: "var(--space-3)", fontSize: "0.85rem", color: "var(--clr-text-muted)" }}>
                  {file ? `Selected: ${file.name}` : "Standard Bulk Architecture"}
                </p>
              </div>
            </div>
          )}
        </div>

        {/* Step 2: Global Settings */}
        {previews.length > 0 && (
          <div className="card animate-fade-up animate-delay-2">
            <h3 style={{ marginBottom: "var(--space-4)" }}>Global Settings</h3>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 16, fontSize: "0.85rem" }}>
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
                <input className="input" value={globalTags} onChange={e => setGlobalTags(e.target.value)} placeholder="e.g. math, easy" />
              </div>
              <div>
                <label className="input-label">Duration (seconds, 0 for infinite)</label>
                <input type="number" className="input" value={globalDuration} onChange={e => setGlobalDuration(Number(e.target.value))} />
              </div>
            </div>
            
            <div style={{ display: "flex", gap: 16, marginTop: 16, flexWrap: "wrap", fontSize: "0.85rem" }}>
              <label style={{ display: "flex", alignItems: "center", gap: 8 }}><input type="checkbox" checked={globalAnonymous} onChange={e => setGlobalAnonymous(e.target.checked)} /> Anonymous Voting</label>
              <label style={{ display: "flex", alignItems: "center", gap: 8 }}><input type="checkbox" checked={globalAllowsMultiple} onChange={e => setGlobalAllowsMultiple(e.target.checked)} /> Multiple Answers (Polls)</label>
              <label style={{ display: "flex", alignItems: "center", gap: 8 }}><input type="checkbox" checked={globalAllowAdding} onChange={e => setGlobalAllowAdding(e.target.checked)} /> Allow Adding (Polls)</label>
              <label style={{ display: "flex", alignItems: "center", gap: 8 }}><input type="checkbox" checked={globalAllowRevoting} onChange={e => setGlobalAllowRevoting(e.target.checked)} /> Allow Revoting (Polls)</label>
            </div>
            
            <button className="btn btn-secondary" style={{ marginTop: 16 }} onClick={applyGlobalSettings}>⚡ Apply to All Pending Quizzes</button>
          </div>
        )}

        {/* Step 3: Staging Area */}
        {previews.length > 0 && (
          <div className="card animate-fade-up animate-delay-3" style={{ border: "1px solid var(--clr-brand)" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, flexWrap: "wrap", marginBottom: "var(--space-4)" }}>
              <h3>Staging Area ({previews.length} Items)</h3>
              <div style={{ display: "flex", gap: 8 }}>
                <button className="btn btn-ghost" onClick={() => handleUpload("save")} disabled={uploading}>
                  {uploading ? "..." : `📁 Save to Library`}
                </button>
                <button className="btn btn-primary" onClick={() => handleUpload("send")} disabled={uploading}>
                  {uploading ? "Broadcasting..." : `🚀 Launch to Telegram`}
                </button>
              </div>
            </div>

            {uploading && (
              <p style={{ color: "var(--clr-text-muted)", fontSize: "0.85rem", marginBottom: 16 }}>
                ⏳ ETA: ~{previews.length * 3} seconds to avoid Telegram rate limits...
              </p>
            )}

            {result && (
              <div style={{ padding: "var(--space-4)", borderRadius: "var(--radius-md)", marginBottom: "var(--space-4)", background: result.ok ? "var(--clr-success-muted)" : "var(--clr-danger-muted)", color: result.ok ? "var(--clr-success)" : "var(--clr-danger)" }}>
                <b>{result.ok ? `Successfully processed ${result.processed} items!` : "Validation Errors"}</b>
                {result.errors && (
                  <ul style={{ marginTop: "var(--space-2)", fontSize: "0.85rem", marginLeft: "1.5rem" }}>
                    {result.errors.map((err, i) => <li key={i}>{err}</li>)}
                  </ul>
                )}
              </div>
            )}

            <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-3)", maxHeight: "600px", overflowY: "auto", paddingRight: 4 }}>
              {previews.map((p, idx) => {
                const isEditing = editingId === p.id;
                const hasErrors = p.errors && p.errors.length > 0;

                return (
                  <div key={p.id} style={{ padding: "var(--space-4)", background: "var(--clr-bg-elevated)", border: `1px solid ${hasErrors ? "var(--clr-danger)" : "var(--clr-border)"}`, borderRadius: "var(--radius-md)" }}>
                    
                    <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 12 }}>
                      <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                        <span className={`badge ${p.type === "quiz" ? "badge-brand" : "badge-accent"}`}>{p.type.toUpperCase()}</span>
                        <span style={{ fontSize: "0.8rem", color: "var(--clr-text-muted)" }}>#{idx + 1}</span>
                        {hasErrors && <span className="badge" style={{ background: "var(--clr-danger-muted)", color: "var(--clr-danger)" }}>Errors Found</span>}
                      </div>
                      <div style={{ display: "flex", gap: 6 }}>
                        <button className="btn btn-ghost btn-sm" onClick={() => setEditingId(isEditing ? null : p.id)}>
                          {isEditing ? "Close" : "✏️ Edit"}
                        </button>
                        <button className="btn btn-ghost btn-sm" style={{ color: "var(--clr-danger)" }} onClick={() => deletePreview(p.id)}>
                          🗑️
                        </button>
                      </div>
                    </div>

                    {hasErrors && (
                      <div style={{ fontSize: "0.8rem", color: "var(--clr-danger)", marginBottom: 12, padding: 8, background: "rgba(239,68,68,0.1)", borderRadius: 6 }}>
                        <ul style={{ margin: 0, paddingLeft: 16 }}>
                          {p.errors?.map((err, i) => <li key={i}>{err}</li>)}
                        </ul>
                      </div>
                    )}
                    
                    {isEditing ? (
                      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                        <textarea className="input" value={p.question} onChange={e => updatePreview(p.id, { question: e.target.value })} placeholder="Question" />
                        {p.options.map((opt, oIdx) => (
                          <div key={oIdx} style={{ display: "flex", gap: 8, alignItems: "center" }}>
                            <input type="radio" checked={p.correctOptionId === oIdx} onChange={() => updatePreview(p.id, { correctOptionId: oIdx, type: "quiz" })} />
                            <input className="input" value={opt} onChange={e => {
                              const newOpts = [...p.options];
                              newOpts[oIdx] = e.target.value;
                              updatePreview(p.id, { options: newOpts });
                            }} />
                          </div>
                        ))}
                        <input className="input" value={p.explanation || ""} onChange={e => updatePreview(p.id, { explanation: e.target.value })} placeholder="Explanation" />
                      </div>
                    ) : (
                      <>
                        <div style={{ fontWeight: 500, marginBottom: 12 }}>{p.question}</div>
                        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                          {p.options.map((o, i) => (
                            <div key={i} style={{ 
                              padding: "6px 12px", borderRadius: "var(--radius-sm)", fontSize: "0.85rem",
                              background: p.correctOptionId === i ? "var(--clr-success-muted)" : "rgba(255,255,255,0.02)", 
                              border: `1px solid ${p.correctOptionId === i ? "var(--clr-success)" : "transparent"}`,
                              color: p.correctOptionId === i ? "var(--clr-success)" : "var(--clr-text-secondary)"
                            }}>
                              <b>{String.fromCharCode(65+i)}.</b> {o}
                            </div>
                          ))}
                        </div>
                        {p.explanation && (
                          <div style={{ marginTop: 12, fontSize: "0.8rem", color: "var(--clr-text-muted)", padding: "8px", background: "rgba(0,0,0,0.2)", borderRadius: "var(--radius-sm)" }}>
                            💡 {p.explanation}
                          </div>
                        )}
                      </>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
