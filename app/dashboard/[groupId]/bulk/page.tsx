"use client";

import { useState } from "react";
import { useParams } from "next/navigation";

interface QuizPreview {
  question: string;
  options: string[];
  type: "quiz" | "poll";
  correctOptionId?: number;
  explanation?: string;
  scheduledAt?: string;
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

  // Parse CSV function
  const parseCSV = (text: string) => {
    const lines = text.split(/\r?\n/).filter((line) => line.trim());
    const items: QuizPreview[] = [];
    for (let i = 1; i < lines.length; i++) {
      const cols = lines[i].split(",");
      if (cols.length < 3) continue;

      const question = cols[0]?.trim();
      const options = [cols[1], cols[2], cols[3], cols[4]].filter(Boolean).map((o) => o?.trim()) as string[];
      const correctIdxStr = cols[5]?.trim();
      let correctOptionId = correctIdxStr && correctIdxStr !== "" && !isNaN(Number(correctIdxStr)) ? Number(correctIdxStr) : undefined;
      const explanation = cols[6]?.trim();
      const scheduledAt = cols[7]?.trim();

      items.push({
        type: correctOptionId !== undefined ? "quiz" : "poll",
        question,
        options,
        correctOptionId,
        explanation,
        scheduledAt: scheduledAt && scheduledAt !== "" ? new Date(scheduledAt).toISOString() : undefined,
      });
    }
    return items;
  };

  // Smart AI Paste Parser (Fuzzy Regex)
  const parseSmartText = (text: string) => {
    // Split by deep blank lines to isolate separate questions
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

        // Detect Answer Key
        if (lowerLine.startsWith("answer:") || lowerLine.startsWith("correct answer:") || lowerLine.startsWith("correct:")) {
          correctAnswerStr = line.split(":")[1].trim();
        } 
        // Detect Explanation
        else if (lowerLine.startsWith("explanation:") || lowerLine.startsWith("note:")) {
          explanationStr = line.split(":")[1].trim();
        } 
        // Detect Options (A., B), - Option, 1. Option)
        else if (/^[a-d]\.|^[a-d]\)|^-[ \t]+|^\d+\./i.test(line)) {
          options.push(line.replace(/^[a-d]\.|^[a-d]\)|^-[ \t]+|^\d+\./i, "").trim());
        } 
        // Otherwise, inject into Question or Explanation
        else {
          if (options.length === 0) {
            question += (question ? "\n" : "") + line;
          } else if (correctAnswerStr) {
            explanationStr += (explanationStr ? " " : "") + line;
          }
        }
      }

      // Cleanup question header if it starts with "1. " or "Q:"
      question = question.replace(/^q\s*\d*:\s*/i, "").replace(/^\d+\.\s*/, "");

      // Resolve numeric index from letter (Example: "A" -> 0, "B" -> 1)
      let correctOptionId: number | undefined = undefined;
      if (correctAnswerStr && options.length > 0) {
        const answerMatch = correctAnswerStr.toLowerCase().match(/^[a-d]/);
        if (answerMatch) {
          const charCode = answerMatch[0].charCodeAt(0) - 97; // 'a' is 97 -> index 0
          if (charCode >= 0 && charCode < options.length) {
            correctOptionId = charCode;
          }
        } else {
          // Try fuzzy string matching
          const idx = options.findIndex((opt) => opt.toLowerCase() === correctAnswerStr.toLowerCase());
          if (idx !== -1) {
            correctOptionId = idx;
          }
        }
      }

      // Validate threshold
      if (question && options.length >= 2) {
        items.push({
          type: correctOptionId !== undefined ? "quiz" : "poll",
          question,
          options,
          correctOptionId,
          explanation: explanationStr || undefined,
        });
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
        setPreviews(Array.isArray(json) ? json : json.quizzes || []);
      } else if (selected.name.endsWith(".csv")) {
        setPreviews(parseCSV(text));
      } else {
        alert("Unsupported file format. Please use JSON or CSV.");
      }
    } catch {
      alert("Failed to parse file. Make sure it's valid.");
    }
  };

  const handleUpload = async () => {
    if (previews.length === 0) return;
    setUploading(true);
    setResult(null);

    try {
      const res = await fetch(`/api/groups/${groupId}/bulk`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ quizzes: previews }),
      });
      const data = await res.json();
      setResult({ ok: res.ok, processed: data.processed, errors: data.errors || (!res.ok ? [data.error] : undefined) });
    } catch {
      setResult({ ok: false, errors: ["Network error"] });
    } finally {
      setUploading(false);
    }
  };

  return (
    <div>
      <div className="section-header animate-fade-up">
        <div>
          <h1>Smart Import</h1>
          <p>Instantly generate multiple quizzes simultaneously.</p>
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr", gap: "var(--space-6)" }}>
        {/* Input Card */}
        <div className="card animate-fade-up animate-delay-1">
          {/* Tabs */}
          <div style={{ display: "flex", gap: "var(--space-2)", marginBottom: "var(--space-4)", borderBottom: "1px solid var(--clr-border)", paddingBottom: "var(--space-2)" }}>
            <button 
              className={`btn ${mode === "smart" ? "btn-primary" : "btn-ghost"}`} 
              onClick={() => { setMode("smart"); setFile(null); setPreviews([]); }}
            >
              🧠 AI Smart Paste
            </button>
            <button 
              className={`btn ${mode === "file" ? "btn-primary" : "btn-ghost"}`} 
              onClick={() => { setMode("file"); setRawText(""); setPreviews([]); }}
            >
              📁 File Upload
            </button>
          </div>

          {/* Mode: Smart Paste */}
          {mode === "smart" && (
            <div>
              <p style={{ fontSize: "0.85rem", color: "var(--clr-text-secondary)", marginBottom: "var(--space-3)" }}>
                Paste AI-generated lists or raw text directly. The engine will auto-detect questions, A/B/C/D options, and answers!
              </p>
              <textarea 
                className="input" 
                style={{ minHeight: "200px", fontFamily: "monospace" }}
                placeholder="Example:
1. What is the largest planet?
A. Earth
B. Mars
C. Jupiter
D. Saturn
Answer: C
Explanation: Jupiter is the gas giant."
                value={rawText}
                onChange={(e) => setRawText(e.target.value)}
              />
              <button className="btn btn-secondary" style={{ marginTop: "var(--space-3)", width: "100%" }} onClick={handleTextEval}>
                🔍 Auto-Extract Quizzes
              </button>
            </div>
          )}

          {/* Mode: File Upload */}
          {mode === "file" && (
            <div style={{ padding: "var(--space-6)", border: "2px dashed var(--clr-border)", borderRadius: "var(--radius-lg)", textAlign: "center", background: "var(--clr-bg-surface)" }}>
              <input 
                type="file" 
                accept=".csv,.json"
                onChange={handleFile}
                style={{ display: "none" }}
                id="bulk-upload"
              />
              <label htmlFor="bulk-upload" className="btn btn-secondary" style={{ cursor: "pointer" }}>
                Select CSV or JSON file
              </label>
              <p style={{ marginTop: "var(--space-3)", fontSize: "0.85rem", color: "var(--clr-text-muted)" }}>
                {file ? `Selected: ${file.name}` : "Standard Bulk Architecture (Template CSV)"}
              </p>
            </div>
          )}
        </div>

        {/* Previews / Execution Card */}
        {previews.length > 0 && (
          <div className="card animate-fade-up animate-delay-2" style={{ border: "1px solid var(--clr-brand)" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, flexWrap: "wrap", marginBottom: "var(--space-4)" }}>
              <h3>Validation ({previews.length} Ready)</h3>
              <button 
                className="btn btn-primary" 
                onClick={handleUpload}
                disabled={uploading}
              >
                {uploading ? "Broadcasting..." : `🚀 Import & Launch All`}
              </button>
            </div>

            {/* Results Alert */}
            {result && (
              <div style={{ padding: "var(--space-4)", borderRadius: "var(--radius-md)", marginBottom: "var(--space-4)", background: result.ok ? "var(--clr-success-muted)" : "var(--clr-danger-muted)", color: result.ok ? "var(--clr-success)" : "var(--clr-danger)" }}>
                <b>{result.ok ? `Successfully deployed ${result.processed} quizzes to Queue!` : "Validation Errors"}</b>
                {result.errors && (
                  <ul style={{ marginTop: "var(--space-2)", fontSize: "0.85rem", marginLeft: "1.5rem" }}>
                    {result.errors.map((err, i) => <li key={i}>{err}</li>)}
                  </ul>
                )}
              </div>
            )}

            {/* Card Grid Layout for Previews (Responsive for Mobile) */}
            <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-3)", maxHeight: "450px", overflowY: "auto", paddingRight: 4 }}>
              {previews.map((p, idx) => (
                <div key={idx} style={{ padding: "var(--space-4)", background: "var(--clr-bg-elevated)", border: "1px solid var(--clr-border)", borderRadius: "var(--radius-md)" }}>
                  
                  <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 12 }}>
                    <span className={`badge ${p.type === "quiz" ? "badge-brand" : "badge-accent"}`}>
                      {p.type.toUpperCase()}
                    </span>
                    <span style={{ fontSize: "0.8rem", fontWeight: 600, color: p.scheduledAt ? "var(--clr-success)" : "var(--clr-text-muted)" }}>
                      {p.scheduledAt ? `📅 ${new Date(p.scheduledAt).toLocaleString()}` : "⚡ Instant"}
                    </span>
                  </div>
                  
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

                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
