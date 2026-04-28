const fs = require('fs');
const file = 'app/dashboard/[groupId]/quiz/new/page.tsx';
let txt = fs.readFileSync(file, 'utf8');

if (!txt.includes('@/lib/emoji')) {
  txt = txt.replace('import Link from "next/link";', 'import Link from "next/link";\nimport { E } from "@/lib/emoji";');
}

// Map of garbled to code
const replacements = [
  ['"Image too large â€” please pick one under 5 MB."', '"Image too large - please pick one under 5 MB."'],
  ['`â ° Quiz #${newCount} scheduled!`', '`${E.schedule} Quiz #${newCount} scheduled!`'],
  ['`âœ… Quiz #${newCount} sent to Telegram!`', '`${E.ok} Quiz #${newCount} sent to Telegram!`'],
  ['"Template saved! âœ…"', '`Template saved! ${E.ok}`'],
  ['t.type === "success" ? "âœ“" : t.type === "error" ? "âœ•" : "â„¹"', 't.type === "success" ? E.check : t.type === "error" ? E.cross : E.info'],
  ['âœ“ {sentCount} sent this session', '{E.check} {sentCount} sent this session'],
  ['ðŸ“‹ View History ({sentCount})', '{E.history} View History ({sentCount})'],
  ['{savingTemplate ? "Savingâ€¦" : "ðŸ’¾ Save as Template"}', '{savingTemplate ? "Saving..." : E.save + " Save as Template"}'],
  ['Sendingâ€¦', 'Sending...'],
  ['{t === "quiz" ? "ðŸŽ¯" : "ðŸ“Š"}', '{t === "quiz" ? E.quiz : E.poll}'],
  ['placeholder="Enter your question hereâ€¦ (up to 300 characters)"', 'placeholder={"Enter your question here... (up to 300 characters)"}'],
  ['<button className="step-btn" onClick={() => setOptionCountSafe(optionCount - 1)}>âˆ’</button>', '<button className="step-btn" onClick={() => setOptionCountSafe(optionCount - 1)}>-</button>'],
  ['<strong style={{ color: "var(--clr-success)" }}>âœ“</strong>', '<strong style={{ color: "var(--clr-success)" }}>{E.check}</strong>'],
  ['correctOptionId === idx ? " â†  Correct" : ""', 'correctOptionId === idx ? " <- Correct" : ""'],
  ['placeholder="Shown after answering â€” explain the correct answer (up to 200 chars)"', 'placeholder={"Shown after answering - explain the correct answer (up to 200 chars)"}'],
  ['<button onClick={() => { setImageFile(null); setImageBase64(""); setImagePreviewUrl(""); if (fileInputRef.current) fileInputRef.current.value = ""; }}\n                        style={{ background: "none", border: "none", cursor: "pointer", color: "var(--clr-danger)", fontSize: "1rem", lineHeight: 1 }}>âœ•</button>', '<button onClick={() => { setImageFile(null); setImageBase64(""); setImagePreviewUrl(""); if (fileInputRef.current) fileInputRef.current.value = ""; }}\n                        style={{ background: "none", border: "none", cursor: "pointer", color: "var(--clr-danger)", fontSize: "1rem", lineHeight: 1 }}>{E.cross}</button>'],
  ['<label className="input-label">â ° Schedule</label>', '<label className="input-label">{E.schedule} Schedule</label>'],
  ['<label className="input-label">ðŸ”  Repeat</label>', '<label className="input-label">{E.repeat} Repeat</label>'],
  ['<label className="input-label" style={{ marginBottom: 0 }}>ðŸ“Œ Topic</label>', '<label className="input-label" style={{ marginBottom: 0 }}>{E.topic} Topic</label>'],
  ['{loadingTopics ? "â€¦" : "â†» Refresh"}', '{loadingTopics ? "..." : "↻ Refresh"}'],
  ['{t.is_closed ? "ðŸ”’ " : ""}', '{t.is_closed ? E.lock + " " : ""}'],
  ['{showManualTopic ? "â–² Hide" : "ï¼‹ Add manually"}', '{showManualTopic ? "▲ Hide" : "＋ Add manually"}'],
  ['{addingTopic ? "Savingâ€¦" : "Save Topic"}', '{addingTopic ? "Saving..." : "Save Topic"}'],
  ['ðŸŽ¯ Quiz', '{E.quiz} Quiz'],
  ['Your question will appear hereâ€¦', 'Your question will appear here...'],
  ['<span style={{ float: "right" }}>âœ“</span>', '<span style={{ float: "right" }}>{E.check}</span>'],
  ['ðŸ’¡ {explanation}', '{E.bulb} {explanation}'],
  ['ðŸ‘¤ Visible votes', '{E.user} Visible votes'],
  ['ðŸ”€ Shuffled', '{E.shuffle} Shuffled'],
  ['â ± {OPEN_PERIOD_OPTIONS', '{E.timer} {OPEN_PERIOD_OPTIONS'],
  ['â ° Scheduled', '{E.schedule} Scheduled']
];

for (const [search, replace] of replacements) {
  txt = txt.split(search).join(replace);
}

fs.writeFileSync(file, txt, 'utf8');
console.log('Fixed garbled emojis and chars in page.tsx');
