import dotenv from "dotenv";

dotenv.config({ path: ".env.local" });

const baseUrl = (process.env.EXAM_SCHEDULER_URL || "https://quizforge-exam-expiry-scheduler.agridmu.workers.dev").replace(/\/$/, "");
const secret = process.env.CRON_SECRET;
if (!secret) throw new Error("CRON_SECRET is required locally for this verification.");

const resultId = `verify-${crypto.randomUUID()}`;
const headers = { Authorization: `Bearer ${secret}`, "Content-Type": "application/json" };

const scheduled = await fetch(`${baseUrl}/schedule`, {
  method: "POST",
  headers,
  body: JSON.stringify({ resultId, examId: "verification-only", dueAt: Date.now() + 60 * 60 * 1000 }),
});
if (!scheduled.ok) throw new Error(`schedule failed: HTTP ${scheduled.status}`);

const cancelled = await fetch(`${baseUrl}/cancel`, {
  method: "POST",
  headers,
  body: JSON.stringify({ resultId }),
});
if (!cancelled.ok) throw new Error(`cancel failed: HTTP ${cancelled.status}`);

console.log(JSON.stringify({ ok: true, schedule: "accepted", cancel: "accepted" }));
