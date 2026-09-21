"use client";

import { useState, useEffect } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";

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
  collectionId?: string;
  collectionName?: string;
  collectionIds?: string[];
  isAnonymous?: boolean;
  allowsMultiple?: boolean;
  openPeriod?: number;
  tags?: string[];
  errors?: string[];
}

interface Topic { message_thread_id: number; name: string; icon_color: number; }

interface Collection {
  id: string;
  name: string;
  emoji: string;
  color: string;
  quizCount?: number;
}

function validate(p: Partial<QuizPreview>): string[] {
  const e: string[] = [];
  const q = p.question?.trim() || "";
  if (!q) e.push("Question is missing");
  else if (q.length > 300) e.push(`Question exceeds 300 chars (${q.length}/300)`);

  const cleanOpts = (p.options || []).map(o => o.trim()).filter(Boolean);
  if (cleanOpts.length < 2) e.push("Need at least 2 options");
  else if (cleanOpts.length > 10) e.push("Max 10 options allowed by Telegram");

  if (cleanOpts.some(o => o.length > 100)) {
    e.push("Each option must be 100 characters or less");
  }

  // Duplicate options check
  const lower = cleanOpts.map(o => o.toLowerCase());
  if (new Set(lower).size !== lower.length) {
    e.push("Options must be unique (duplicate answers found)");
  }

  if (p.type === "quiz") {
    if (p.correctOptionId === undefined || p.correctOptionId === null || p.correctOptionId < 0 || p.correctOptionId >= cleanOpts.length) {
      e.push("Quiz needs a valid correct answer");
    }
  }

  if (p.type === "quiz" && p.explanation && p.explanation.trim().length > 200) {
    e.push(`Explanation exceeds 200 chars (${p.explanation.trim().length}/200)`);
  }

  return e;
}

function resolveCorrectOption(raw: string | undefined | null, options: string[]): number | null {
  if (!raw || options.length === 0) return null;
  const str = String(raw).trim().replace(/^["']|["']$/g, "");
  if (!str) return null;

  // Arabic letters map
  const arabicLetters = ["أ", "ب", "ج", "د", "هـ", "و", "ز", "ح", "ط", "ي"];
  const arabicIdx = arabicLetters.indexOf(str);
  if (arabicIdx !== -1 && arabicIdx < options.length) return arabicIdx;

  if (str === "ا" && options.length > 0) return 0;

  // English letters A-J
  if (/^[a-jA-J]$/.test(str)) {
    const idx = str.toUpperCase().charCodeAt(0) - 65;
    if (idx < options.length) return idx;
  }

  // Exact match with option text (case-insensitive)
  const matchIdx = options.findIndex(o => o.trim().toLowerCase() === str.toLowerCase());
  if (matchIdx !== -1) return matchIdx;

  // Numeric index check (both 0-based and 1-based)
  const n = Number(str);
  if (!isNaN(n) && Number.isInteger(n)) {
    if (n >= 0 && n < options.length) return n;
    if (n >= 1 && n <= options.length) return n - 1;
  }

  return null;
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
      if (/^(answer|correct answer|correct|ans|حل|الجواب|الإجابة|الاجابة)\s*[:=-]/i.test(line)) {
        correctAnswerStr = line.replace(/^(answer|correct answer|correct|ans|حل|الجواب|الإجابة|الاجابة)\s*[:=-]\s*/i, "").trim();
        continue;
      }
      if (/^(explanation|note|reason|شرح|تفسير|ملاحظة)\s*[:=-]/i.test(line)) {
        explanationStr = line.replace(/^(explanation|note|reason|شرح|تفسير|ملاحظة)\s*[:=-]\s*/i, "").trim();
        continue;
      }

      const isLetterOption  = /^[a-dA-Dأ-ي][\.\)\-]\s+\S/.test(line); // A. text or أ. text or A) text
      const isBulletOption  = /^[-•*]\s+\S/.test(line);                // - text or • text
      const isNumberedLine  = /^\d+[\.\)\-]\s+\S/.test(line);            // 1. text

      if (isLetterOption || isBulletOption) {
        options.push(line.replace(/^[a-dA-Dأ-ي][\.\)\-]\s+|^[-•*]\s+/, "").trim());
      } else if (isNumberedLine && question) {
        options.push(line.replace(/^\d+[\.\)\-]\s+/, "").trim());
      } else {
        if (options.length === 0) {
          question += (question ? "\n" : "") + line;
        } else {
          explanationStr += (explanationStr ? " " : "") + line;
        }
      }
    }

    // Strip leading "Q1:" or "1." or "س1:" prefix from question
    question = question.replace(/^(q\s*\d*|question\s*\d*|س\s*\d*)\s*[:.]\s*/i, "").replace(/^\d+[\.\)]\s+/, "").trim();
    const cleanOpts = options.filter(Boolean);
    const correctOptionId = resolveCorrectOption(correctAnswerStr, cleanOpts);

    if (question || cleanOpts.length > 0) {
      const partial = {
        question,
        options: cleanOpts,
        correctOptionId,
        explanation: explanationStr || undefined,
        type: correctOptionId !== null ? ("quiz" as const) : ("poll" as const),
      };
      items.push({ id: uid(), ...partial, errors: validate(partial) });
    }
  }
  return items;
}

function parseFullCSV(text: string): string[][] {
  const clean = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  const firstLine = clean.split(/\r?\n/)[0] || "";
  const delimiter = (firstLine.match(/;/g) || []).length > (firstLine.match(/,/g) || []).length ? ";"
    : (firstLine.match(/\t/g) || []).length > (firstLine.match(/,/g) || []).length ? "\t" : ",";

  const rows: string[][] = [];
  let currentRow: string[] = [];
  let currentCell = "";
  let inQuotes = false;

  for (let i = 0; i < clean.length; i++) {
    const char = clean[i];
    if (char === '"') {
      if (inQuotes && clean[i + 1] === '"') {
        currentCell += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (char === delimiter && !inQuotes) {
      currentRow.push(currentCell.trim());
      currentCell = "";
    } else if ((char === '\r' || char === '\n') && !inQuotes) {
      if (char === '\r' && clean[i + 1] === '\n') {
        i++;
      }
      currentRow.push(currentCell.trim());
      currentCell = "";
      if (currentRow.some(c => c.length > 0)) {
        rows.push(currentRow);
      }
      currentRow = [];
    } else {
      currentCell += char;
    }
  }
  if (currentCell.length > 0 || currentRow.length > 0) {
    currentRow.push(currentCell.trim());
    if (currentRow.some(c => c.length > 0)) {
      rows.push(currentRow);
    }
  }
  return rows;
}

function parseCSV(text: string): QuizPreview[] {
  const rows = parseFullCSV(text);
  if (rows.length < 2) return [];

  const items: QuizPreview[] = [];
  // Skip header row
  for (let i = 1; i < rows.length; i++) {
    const cols = rows[i];
    if (cols.length < 3) continue;

    const question = cols[0]?.replace(/^"|"$/g, "").trim();
    if (!question) continue;

    let correctOptionId: number | null = null;
    let explanation: string | undefined = undefined;
    let options: string[] = [];

    // Standard template: [question, opt1, opt2, opt3, opt4, correctIndex, explanation]
    if (cols.length >= 6) {
      const possibleAns = cols[5]?.replace(/^"|"$/g, "").trim();
      const testOpts = [cols[1], cols[2], cols[3], cols[4]].map(o => o?.replace(/^"|"$/g, "").trim()).filter(Boolean);

      const resolved = resolveCorrectOption(possibleAns, testOpts);
      if (resolved !== null) {
        options = testOpts;
        correctOptionId = resolved;
        explanation = cols[6]?.replace(/^"|"$/g, "").trim() || undefined;
      }
    }

    if (options.length === 0) {
      // Dynamic columns: search for which column represents the answer
      let foundCol = -1;
      let resolvedOpt: number | null = null;
      let candidateOptions: string[] = [];

      for (let cIdx = cols.length - 1; cIdx >= 2; cIdx--) {
        const candidateAns = cols[cIdx]?.replace(/^"|"$/g, "").trim();
        const candOpts = cols.slice(1, cIdx).map(o => o?.replace(/^"|"$/g, "").trim()).filter(Boolean);
        if (candOpts.length >= 2) {
          const res = resolveCorrectOption(candidateAns, candOpts);
          if (res !== null) {
            foundCol = cIdx;
            resolvedOpt = res;
            candidateOptions = candOpts;
            break;
          }
        }
      }

      if (foundCol !== -1) {
        options = candidateOptions;
        correctOptionId = resolvedOpt;
        explanation = cols.slice(foundCol + 1).join(" ").replace(/^"|"$/g, "").trim() || undefined;
      } else {
        options = cols.slice(1).map(o => o?.replace(/^"|"$/g, "").trim()).filter(Boolean);
      }
    }

    const partial = {
      question,
      options,
      correctOptionId,
      explanation: explanation || undefined,
      type: correctOptionId !== null ? ("quiz" as const) : ("poll" as const),
    };
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
  const [showErrorsOnly, setShowErrorsOnly] = useState(false);

  // Global settings
  const [globalTopicId, setGlobalTopicId] = useState<number | "">("");
  const [globalTopicName, setGlobalTopicName] = useState("");
  const [globalCollectionId, setGlobalCollectionId] = useState("");
  const [globalCollectionName, setGlobalCollectionName] = useState("");
  const [globalAnonymous, setGlobalAnonymous] = useState(true);
  const [globalDuration, setGlobalDuration] = useState(0);
  const [globalAllowMultiple, setGlobalAllowMultiple] = useState(false);
  const [globalTags, setGlobalTags] = useState("");
  const [topics, setTopics] = useState<Topic[]>([]);
  const [collections, setCollections] = useState<Collection[]>([]);

  useEffect(() => {
    fetch(`/api/groups/${groupId}/topics`).then(r => r.json()).then(d => setTopics(d.topics || [])).catch(() => {});
    fetch("/api/collections").then(r => r.json()).then(d => setCollections(d.collections || [])).catch(() => {});
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
      const updated: QuizPreview = {
        ...p,
        topicId: globalTopicId === "" ? undefined : (globalTopicId as number),
        topicName: globalTopicName || undefined,
        collectionId: globalCollectionId || undefined,
        collectionName: globalCollectionName || undefined,
        collectionIds: globalCollectionId ? [globalCollectionId] : undefined,
        isAnonymous: globalAnonymous,
        openPeriod: globalDuration > 0 ? globalDuration : undefined,
        allowsMultiple: p.type === "poll" ? globalAllowMultiple : false,
        tags: tags.length > 0 ? tags : undefined,
      };
      return { ...updated, errors: validate(updated) };
    }));
    notify("success", "Applied global settings to all queued quizzes");
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
        body: JSON.stringify({
          action,
          collectionId: globalCollectionId || undefined,
          collectionIds: globalCollectionId ? [globalCollectionId] : undefined,
          quizzes: queue.map(q => ({
            ...q,
            collectionId: q.collectionId || globalCollectionId || undefined,
            collectionIds: q.collectionIds || (q.collectionId ? [q.collectionId] : (globalCollectionId ? [globalCollectionId] : undefined)),
          })),
        }),
      });
      const data = await res.json();
      setResult({ ok: res.ok, processed: data.processed, errors: data.errors || (!res.ok ? [data.error] : undefined) });
      if (res.ok) setQueue([]);
    } catch { setResult({ ok: false, errors: ["Network error"] }); }
    finally { setUploading(false); }
  };

  const removeInvalid = () => {
    setQueue(prev => prev.filter(p => !p.errors || p.errors.length === 0));
    notify("info", "Removed invalid items from queue");
  };

  const downloadTemplate = (type: "csv" | "json" | "txt") => {
    const files: Record<string, [string, string, string]> = {
      csv: ['"question","option1","option2","option3","option4","correctIndex","explanation"\n"What is 2+2?","3","4","5","6",1,"Basic math"\n"Which is a primary color?","Green","Blue","Purple","Orange",1,"Blue is a primary color"', "quizforge_template.csv", "text/csv;charset=utf-8"],
      json: [JSON.stringify([
        { question: "What is 2+2?", options: ["3", "4", "5", "6"], correctOptionId: 1, explanation: "Basic math" },
        { question: "Which is a primary color?", options: ["Green", "Blue", "Purple", "Orange"], correctOptionId: 1, explanation: "Blue is a primary color" }
      ], null, 2), "quizforge_template.json", "application/json"],
      txt: ["1. What is 2+2?\nA. 3\nB. 4\nC. 5\nD. 6\nAnswer: B\nExplanation: Basic math\n\n2. Which is a primary color?\nA. Green\nB. Blue\nC. Purple\nD. Orange\nAnswer: B", "quizforge_template.txt", "text/plain;charset=utf-8"],
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
          <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
            <h1 style={{ margin: 0 }}>Smart Import</h1>
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
              <Link href={`/dashboard/${groupId}/library`} className="btn btn-ghost btn-sm" style={{ fontSize: "0.78rem", padding: "4px 10px" }}>
                📚 Library
              </Link>
              <Link href={`/dashboard/${groupId}/quiz/new`} className="btn btn-ghost btn-sm" style={{ fontSize: "0.78rem", padding: "4px 10px" }}>
                ➕ New Quiz
              </Link>
              <Link href={`/dashboard/${groupId}/topics`} className="btn btn-ghost btn-sm" style={{ fontSize: "0.78rem", padding: "4px 10px" }}>
                🏷️ Topics
              </Link>
            </div>
          </div>
          <p style={{ marginTop: 4 }}>Paste, extract, configure topics & categories, and mass-deploy quizzes at scale.</p>
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
              {uploading ? `Broadcasting… (ETA ~${queue.length}s)` : `🚀 Send ${validCount} Quiz${validCount !== 1 ? "zes" : ""}`}
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
              <div>
                <h3 style={{ margin: 0 }}>Global Settings</h3>
                <p style={{ fontSize: "0.78rem", color: "var(--clr-text-muted)", margin: "3px 0 0" }}>Apply topic, category, and options to all questions simultaneously.</p>
              </div>
              <button className="btn btn-secondary btn-sm" onClick={applyGlobal}>⚡ Apply to All</button>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(190px, 1fr))", gap: 12 }}>
              <div>
                <label className="input-label">Forum Topic</label>
                <select className="select" value={globalTopicId} onChange={e => {
                  const id = e.target.value;
                  setGlobalTopicId(id ? Number(id) : "");
                  setGlobalTopicName(topics.find(t => t.message_thread_id === Number(id))?.name || "");
                }}>
                  <option value="">📌 General (Main chat)</option>
                  {topics.map(t => <option key={t.message_thread_id} value={t.message_thread_id}>📂 {t.name}</option>)}
                </select>
              </div>
              <div>
                <label className="input-label">Category / Collection</label>
                <select className="select" value={globalCollectionId} onChange={e => {
                  const id = e.target.value;
                  setGlobalCollectionId(id);
                  const col = collections.find(c => c.id === id);
                  setGlobalCollectionName(col ? `${col.emoji} ${col.name}` : "");
                }}>
                  <option value="">📂 None (Uncategorized)</option>
                  {collections.map(c => (
                    <option key={c.id} value={c.id}>{c.emoji} {c.name}</option>
                  ))}
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
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "var(--space-4)", flexWrap: "wrap", gap: 12 }}>
              <div>
                <h3 style={{ margin: 0 }}>Queue — {queue.length} item{queue.length !== 1 ? "s" : ""}</h3>
                {hasErrors ? (
                  <p style={{ fontSize: "0.8rem", color: "var(--clr-danger)", marginTop: 4 }}>
                    ⚠ {queue.filter(p => p.errors && p.errors.length > 0).length} item(s) have validation errors
                  </p>
                ) : (
                  <p style={{ fontSize: "0.8rem", color: "var(--clr-success)", marginTop: 4 }}>
                    ✓ All {queue.length} items are valid and ready to broadcast
                  </p>
                )}
              </div>

              <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                {hasErrors && (
                  <>
                    <button
                      className={`btn btn-sm ${showErrorsOnly ? "btn-secondary" : "btn-ghost"}`}
                      onClick={() => setShowErrorsOnly(!showErrorsOnly)}
                      style={{ fontSize: "0.8rem" }}
                    >
                      {showErrorsOnly ? "👁 Show All" : "⚠ Show Errors Only"}
                    </button>
                    <button
                      className="btn btn-sm btn-ghost"
                      onClick={removeInvalid}
                      style={{ color: "var(--clr-danger)", fontSize: "0.8rem" }}
                    >
                      🗑 Remove Invalid
                    </button>
                  </>
                )}
                {uploading && (
                  <span style={{ fontSize: "0.82rem", color: "var(--clr-text-muted)" }}>
                    ⏳ ETA ~{queue.length}s
                  </span>
                )}
              </div>
            </div>

            {result && (
              <div style={{ padding: "var(--space-3)", borderRadius: "var(--radius-md)", marginBottom: "var(--space-4)", background: result.ok ? "var(--clr-success-muted)" : "var(--clr-danger-muted)", color: result.ok ? "var(--clr-success)" : "var(--clr-danger)", fontSize: "0.875rem" }}>
                <b>{result.ok ? `✓ Sent ${result.processed} quizzes successfully!` : "Errors occurred:"}</b>
                {result.errors && <ul style={{ marginTop: 6, paddingLeft: 20 }}>{result.errors.map((e, i) => <li key={i}>{e}</li>)}</ul>}
              </div>
            )}

            <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-3)", maxHeight: 580, overflowY: "auto", paddingRight: 4 }}>
              {(showErrorsOnly ? queue.filter(p => p.errors && p.errors.length > 0) : queue).map((p, idx) => {
                const isEditing = editingId === p.id;
                const hasErr = p.errors && p.errors.length > 0;
                const matchedCol = collections.find(c => c.id === p.collectionId);

                return (
                  <div key={p.id} style={{ padding: "var(--space-4)", background: "var(--clr-bg-elevated)", border: `1px solid ${hasErr ? "var(--clr-danger)" : "var(--clr-border)"}`, borderRadius: "var(--radius-md)" }}>
                    {/* Row header */}
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: hasErr ? 8 : 12, gap: 8, flexWrap: "wrap" }}>
                      <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                        <span className={`badge ${p.type === "quiz" ? "badge-brand" : "badge-accent"}`}>{p.type.toUpperCase()}</span>
                        <span style={{ fontSize: "0.78rem", color: "var(--clr-text-muted)" }}>#{idx + 1}</span>
                        {hasErr && <span className="badge" style={{ background: "var(--clr-danger-muted)", color: "var(--clr-danger)" }}>⚠ Fix needed</span>}
                        <span className="badge badge-muted" style={{ fontSize: "0.72rem" }}>
                          {p.topicName ? `📍 ${p.topicName}` : "📌 General"}
                        </span>
                        {matchedCol ? (
                          <span className="badge" style={{ fontSize: "0.72rem", background: matchedCol.color + "22", color: matchedCol.color, border: `1px solid ${matchedCol.color}44` }}>
                            {matchedCol.emoji} {matchedCol.name}
                          </span>
                        ) : p.collectionName ? (
                          <span className="badge badge-muted" style={{ fontSize: "0.72rem" }}>📁 {p.collectionName}</span>
                        ) : null}
                        {p.tags?.map(tag => <span key={tag} className="badge badge-muted" style={{ fontSize: "0.68rem" }}>#{tag}</span>)}
                      </div>
                      <div style={{ display: "flex", gap: 4 }}>
                        <button className={`btn btn-sm ${isEditing ? "btn-primary" : "btn-ghost"}`} onClick={() => setEditingId(isEditing ? null : p.id)} style={{ fontSize: "0.8rem" }}>
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
                      <div style={{ display: "flex", flexDirection: "column", gap: 10, marginTop: 6 }}>
                        {/* Type & Toggles row */}
                        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", borderBottom: "1px solid var(--clr-border)", paddingBottom: 8 }}>
                          <div style={{ display: "flex", gap: 4, background: "var(--clr-bg-surface)", padding: 3, borderRadius: "var(--radius-sm)" }}>
                            <button
                              type="button"
                              className={`btn btn-sm ${p.type === "quiz" ? "btn-primary" : "btn-ghost"}`}
                              style={{ fontSize: "0.75rem", padding: "2px 8px", height: 26 }}
                              onClick={() => updateItem(p.id, {
                                type: "quiz",
                                correctOptionId: p.correctOptionId ?? 0,
                                allowsMultiple: false,
                              })}
                            >
                              ✅ Quiz Mode
                            </button>
                            <button
                              type="button"
                              className={`btn btn-sm ${p.type === "poll" ? "btn-primary" : "btn-ghost"}`}
                              style={{ fontSize: "0.75rem", padding: "2px 8px", height: 26 }}
                              onClick={() => updateItem(p.id, {
                                type: "poll",
                                correctOptionId: null,
                              })}
                            >
                              📊 Poll Mode
                            </button>
                          </div>

                          <label style={{ display: "flex", alignItems: "center", gap: 5, fontSize: "0.78rem", cursor: "pointer", marginLeft: "auto" }}>
                            <input
                              type="checkbox"
                              checked={p.isAnonymous ?? true}
                              onChange={e => updateItem(p.id, { isAnonymous: e.target.checked })}
                            />
                            🔒 Anonymous
                          </label>

                          {p.type === "poll" && (
                            <label style={{ display: "flex", alignItems: "center", gap: 5, fontSize: "0.78rem", cursor: "pointer" }}>
                              <input
                                type="checkbox"
                                checked={p.allowsMultiple ?? false}
                                onChange={e => updateItem(p.id, { allowsMultiple: e.target.checked })}
                              />
                              ☑ Multi-answer
                            </label>
                          )}
                        </div>

                        {/* Question */}
                        <div>
                          <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 3 }}>
                            <label className="input-label" style={{ margin: 0 }}>Question</label>
                            <span style={{ fontSize: "0.72rem", color: (p.question || "").trim().length > 300 ? "var(--clr-danger)" : "var(--clr-text-muted)" }}>
                              {(p.question || "").trim().length}/300
                            </span>
                          </div>
                          <textarea
                            className="input"
                            rows={2}
                            value={p.question}
                            onChange={e => updateItem(p.id, { question: e.target.value })}
                            placeholder="Question text…"
                            style={{ borderColor: (p.question || "").trim().length > 300 ? "var(--clr-danger)" : undefined }}
                          />
                        </div>

                        {/* Options */}
                        <div>
                          <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
                            <label className="input-label" style={{ margin: 0 }}>
                              Options ({p.options.length}/10) {p.type === "quiz" && <span style={{ color: "var(--clr-text-muted)", fontWeight: "normal" }}>— mark radio for correct answer</span>}
                            </label>
                          </div>
                          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                            {p.options.map((opt, oIdx) => (
                              <div key={oIdx} style={{ display: "flex", gap: 8, alignItems: "center" }}>
                                {p.type === "quiz" && (
                                  <input
                                    type="radio"
                                    name={`correct-${p.id}`}
                                    checked={p.correctOptionId === oIdx}
                                    onChange={() => updateItem(p.id, { correctOptionId: oIdx })}
                                    title="Mark as correct answer"
                                  />
                                )}
                                <span style={{ fontSize: "0.78rem", fontWeight: 600, color: "var(--clr-text-muted)", width: 18 }}>
                                  {String.fromCharCode(65 + oIdx)}.
                                </span>
                                <input
                                  className="input"
                                  value={opt}
                                  onChange={e => {
                                    const opts = [...p.options];
                                    opts[oIdx] = e.target.value;
                                    updateItem(p.id, { options: opts });
                                  }}
                                  placeholder={`Option ${oIdx + 1}`}
                                  style={{ flex: 1 }}
                                />
                                {p.options.length > 2 && (
                                  <button
                                    type="button"
                                    className="btn btn-ghost btn-sm"
                                    style={{ color: "var(--clr-danger)", padding: "0 6px" }}
                                    title="Delete option"
                                    onClick={() => {
                                      const opts = p.options.filter((_, i) => i !== oIdx);
                                      let nextCorrect = p.correctOptionId;
                                      if (p.correctOptionId === oIdx) nextCorrect = 0;
                                      else if (p.correctOptionId !== null && p.correctOptionId !== undefined && p.correctOptionId > oIdx) {
                                        nextCorrect = p.correctOptionId - 1;
                                      }
                                      updateItem(p.id, {
                                        options: opts,
                                        correctOptionId: p.type === "quiz" ? Math.min(nextCorrect ?? 0, opts.length - 1) : null,
                                      });
                                    }}
                                  >
                                    ✕
                                  </button>
                                )}
                              </div>
                            ))}
                            {p.options.length < 10 && (
                              <button
                                type="button"
                                className="btn btn-ghost btn-sm"
                                style={{ alignSelf: "flex-start", fontSize: "0.8rem" }}
                                onClick={() => updateItem(p.id, { options: [...p.options, ""] })}
                              >
                                + Add Option
                              </button>
                            )}
                          </div>
                        </div>

                        {/* Explanation (quiz mode) */}
                        {p.type === "quiz" && (
                          <div>
                            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 3 }}>
                              <label className="input-label" style={{ margin: 0 }}>💡 Explanation (optional)</label>
                              <span style={{ fontSize: "0.72rem", color: (p.explanation || "").trim().length > 200 ? "var(--clr-danger)" : "var(--clr-text-muted)" }}>
                                {(p.explanation || "").trim().length}/200
                              </span>
                            </div>
                            <input
                              className="input"
                              value={p.explanation || ""}
                              onChange={e => updateItem(p.id, { explanation: e.target.value })}
                              placeholder="Shown when answer is revealed (max 200 chars)"
                              style={{ borderColor: (p.explanation || "").trim().length > 200 ? "var(--clr-danger)" : undefined }}
                            />
                          </div>
                        )}

                        {/* Topic & Category row */}
                        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                          <div>
                            <label className="input-label">Forum Topic</label>
                            <select
                              className="select"
                              value={p.topicId !== undefined ? p.topicId : ""}
                              onChange={e => {
                                const tid = e.target.value;
                                const found = topics.find(t => t.message_thread_id === Number(tid));
                                updateItem(p.id, {
                                  topicId: tid ? Number(tid) : undefined,
                                  topicName: found?.name,
                                });
                              }}
                            >
                              <option value="">📌 General</option>
                              {topics.map(t => (
                                <option key={t.message_thread_id} value={t.message_thread_id}>
                                  📂 {t.name}
                                </option>
                              ))}
                            </select>
                          </div>

                          <div>
                            <label className="input-label">Category / Collection</label>
                            <select
                              className="select"
                              value={p.collectionId || ""}
                              onChange={e => {
                                const cid = e.target.value;
                                const col = collections.find(c => c.id === cid);
                                updateItem(p.id, {
                                  collectionId: cid || undefined,
                                  collectionName: col ? `${col.emoji} ${col.name}` : undefined,
                                  collectionIds: cid ? [cid] : [],
                                });
                              }}
                            >
                              <option value="">📂 None (Uncategorized)</option>
                              {collections.map(c => (
                                <option key={c.id} value={c.id}>
                                  {c.emoji} {c.name}
                                </option>
                              ))}
                            </select>
                          </div>
                        </div>

                        {/* Tags & Duration row */}
                        <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr", gap: 10 }}>
                          <div>
                            <label className="input-label">Tags (comma-separated)</label>
                            <input
                              className="input"
                              value={(p.tags || []).join(", ")}
                              onChange={e => {
                                const tgs = e.target.value.split(",").map(t => t.trim()).filter(Boolean);
                                updateItem(p.id, { tags: tgs });
                              }}
                              placeholder="e.g. math, algebra"
                            />
                          </div>
                          <div>
                            <label className="input-label">Duration (sec, 0=∞)</label>
                            <input
                              type="number"
                              min={0}
                              className="input"
                              value={p.openPeriod ?? 0}
                              onChange={e => updateItem(p.id, { openPeriod: Number(e.target.value) || undefined })}
                            />
                          </div>
                        </div>
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
