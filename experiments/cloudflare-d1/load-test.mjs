const baseUrl = (process.env.D1_TEST_URL || "").replace(/\/$/, "");
const secret = process.env.D1_TEST_SECRET || "";
const students = Number(process.env.D1_TEST_STUDENTS || 100);
const questions = Number(process.env.D1_TEST_QUESTIONS || 10);

if (!baseUrl || !secret) throw new Error("Set D1_TEST_URL and D1_TEST_SECRET in your local shell.");
if (!Number.isInteger(students) || students < 1 || students > 200) throw new Error("D1_TEST_STUDENTS must be 1-200.");
if (!Number.isInteger(questions) || questions < 1 || questions > 20) throw new Error("D1_TEST_QUESTIONS must be 1-20.");

const headers = { authorization: `Bearer ${secret}`, "content-type": "application/json" };
async function call(path, body) {
  const started = performance.now();
  const response = await fetch(`${baseUrl}${path}`, { method: body ? "POST" : "GET", headers, ...(body ? { body: JSON.stringify(body) } : {}) });
  const data = await response.json();
  return { status: response.status, data, ms: performance.now() - started };
}

const health = await fetch(`${baseUrl}/health`).then((r) => r.json());
if (!health.ok) throw new Error("D1 worker health check failed.");

const reset = await call("/test/reset", { students, questions });
if (!reset.data.ok) throw new Error(`Reset failed: ${JSON.stringify(reset.data)}`);

const starts = await Promise.all(Array.from({ length: students }, (_, studentIndex) => call("/test/start", { studentIndex, questions })));
const failedStarts = starts.filter((result) => result.status !== 200 || !result.data.resultId);
if (failedStarts.length) throw new Error(`${failedStarts.length} of ${students} sessions failed to start.`);
const resultIds = starts.map((result) => result.data.resultId);

const latencies = [];
let failures = 0;
for (let questionIndex = 0; questionIndex < questions; questionIndex++) {
  const wave = await Promise.all(resultIds.map(async (resultId, studentIndex) => {
    const result = await call("/test/answer", { resultId, questionIndex, optionId: (studentIndex + questionIndex) % 4 });
    latencies.push(result.ms);
    if (result.status !== 200 || !result.data.ok) failures++;
  }));
  void wave;
}

const verification = await call("/test/verify");
if (verification.status !== 200 || !verification.data.ok) {
  throw new Error(`Verification failed: ${JSON.stringify(verification.data)}`);
}

latencies.sort((a, b) => a - b);
const percentile = (p) => latencies[Math.min(latencies.length - 1, Math.ceil(latencies.length * p) - 1)] || 0;
console.log(JSON.stringify({
  ok: failures === 0,
  students,
  questionsPerStudent: questions,
  answerWrites: students * questions,
  failures,
  answerLatencyMs: { p50: Number(percentile(0.5).toFixed(1)), p95: Number(percentile(0.95).toFixed(1)), max: Number(percentile(1).toFixed(1)) },
  verification: verification.data,
}, null, 2));
