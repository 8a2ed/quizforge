const TEST_GROUP_ID = "quizforge-d1-loadtest-group";
const TEST_EXAM_ID = "quizforge-d1-loadtest-exam";

const json = (data, status = 200) => new Response(JSON.stringify(data), {
  status,
  headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
});

function authorized(request, env) {
  const provided = request.headers.get("authorization") || "";
  return Boolean(env.D1_TEST_SECRET) && provided === `Bearer ${env.D1_TEST_SECRET}`;
}

async function bodyJson(request) {
  try { return await request.json(); } catch { return null; }
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (request.method === "GET" && url.pathname === "/health") {
      try {
        const row = await env.DB.prepare("SELECT 1 AS ok").first();
        return json({ ok: row?.ok === 1, database: "D1 test binding" });
      } catch {
        return json({ ok: false, error: "D1 query failed" }, 503);
      }
    }

    if (!url.pathname.startsWith("/test/")) return json({ error: "Not found" }, 404);
    if (!authorized(request, env)) return json({ error: "Unauthorized" }, 401);

    if (request.method === "POST" && url.pathname === "/test/reset") {
      const body = await bodyJson(request);
      const students = Number(body?.students);
      const questions = Number(body?.questions);
      if (!Number.isInteger(students) || students < 1 || students > 200 || !Number.isInteger(questions) || questions < 1 || questions > 20) {
        return json({ error: "Use 1-200 students and 1-20 questions." }, 400);
      }
      try {
        await env.DB.batch([
          env.DB.prepare("DELETE FROM exam_results WHERE exam_id = ?").bind(TEST_EXAM_ID),
          env.DB.prepare("DELETE FROM exams WHERE id = ?").bind(TEST_EXAM_ID),
          env.DB.prepare("DELETE FROM groups WHERE id = ?").bind(TEST_GROUP_ID),
          env.DB.prepare("INSERT INTO groups(id, title) VALUES (?, ?) ON CONFLICT(id) DO UPDATE SET title = excluded.title").bind(TEST_GROUP_ID, "QuizForge D1 load test"),
          env.DB.prepare("INSERT INTO exams(id, group_id, title, questions, is_published) VALUES (?, ?, ?, ?, 1)").bind(TEST_EXAM_ID, TEST_GROUP_ID, "Synthetic load test", JSON.stringify(Array.from({ length: questions }, (_, index) => ({ question: `Q${index + 1}`, options: ["A", "B", "C", "D"] })))),
        ]);
        return json({ ok: true, students, questions, plannedAnswerWrites: students * questions });
      } catch {
        return json({ error: "Could not reset isolated test data" }, 503);
      }
    }

    if (request.method === "POST" && url.pathname === "/test/start") {
      const body = await bodyJson(request);
      const studentIndex = Number(body?.studentIndex);
      const questions = Number(body?.questions);
      if (!Number.isInteger(studentIndex) || studentIndex < 0 || studentIndex >= 200 || !Number.isInteger(questions) || questions < 1 || questions > 20) {
        return json({ error: "Invalid studentIndex or question count" }, 400);
      }
      const id = crypto.randomUUID();
      const telegramId = `loadtest-${studentIndex}`;
      const now = Date.now();
      const snapshot = { answers: {}, questions: Array.from({ length: questions }, (_, index) => ({ question: `Q${index + 1}`, options: ["A", "B", "C", "D"], correctOptionId: 0 })), currentQ: 0, startedAt: now, lastActiveAt: now, chatId: 0, msgId: 0 };
      try {
        await env.DB.prepare("INSERT INTO exam_results(id, exam_id, telegram_id, name, answers, score, passed) VALUES (?, ?, ?, ?, ?, -1, 0)").bind(id, TEST_EXAM_ID, telegramId, `Student ${studentIndex}`, JSON.stringify(snapshot)).run();
        return json({ ok: true, resultId: id, studentIndex });
      } catch {
        return json({ error: "Could not create test session" }, 503);
      }
    }

    if (request.method === "POST" && url.pathname === "/test/answer") {
      const body = await bodyJson(request);
      const resultId = String(body?.resultId || "");
      const questionIndex = Number(body?.questionIndex);
      const optionId = Number(body?.optionId);
      if (!resultId || !Number.isInteger(questionIndex) || questionIndex < 0 || questionIndex >= 20 || !Number.isInteger(optionId) || optionId < 0 || optionId > 3) {
        return json({ error: "Invalid answer request" }, 400);
      }
      const now = Date.now();
      try {
        const result = await env.DB.prepare(`
          UPDATE exam_results
          SET answers = json_patch(
            answers,
            json_object(
              'answers', json_patch(COALESCE(json_extract(answers, '$.answers'), '{}'), json_object(CAST(CAST(?2 AS INTEGER) AS TEXT), ?3)),
              'currentQ', ?4,
              'lastActiveAt', ?5
            )
          )
          WHERE id = ?1 AND score = -1 AND json_extract(answers, '$.currentQ') = ?2
        `).bind(resultId, questionIndex, optionId, questionIndex + 1, now).run();
        if (result.meta.changes !== 1) return json({ ok: false, conflict: true }, 409);
        return json({ ok: true, questionIndex, nextQuestion: questionIndex + 1 });
      } catch {
        return json({ error: "Answer write failed" }, 503);
      }
    }

    if (request.method === "GET" && url.pathname === "/test/verify") {
      try {
        const rows = await env.DB.prepare("SELECT id, score, answers FROM exam_results WHERE exam_id = ? ORDER BY telegram_id").bind(TEST_EXAM_ID).all();
        const invalid = rows.results.filter((row) => {
          const state = JSON.parse(row.answers);
          return row.score !== -1 || Object.keys(state.answers || {}).length !== state.questions.length || state.currentQ !== state.questions.length;
        });
        return json({ ok: invalid.length === 0, sessions: rows.results.length, completeSessions: rows.results.length - invalid.length, invalidSessions: invalid.length });
      } catch {
        return json({ error: "Verification query failed" }, 503);
      }
    }

    if (request.method === "POST" && url.pathname === "/test/cleanup") {
      try {
        await env.DB.batch([
          env.DB.prepare("DELETE FROM exam_results WHERE exam_id = ?").bind(TEST_EXAM_ID),
          env.DB.prepare("DELETE FROM exams WHERE id = ?").bind(TEST_EXAM_ID),
          env.DB.prepare("DELETE FROM groups WHERE id = ?").bind(TEST_GROUP_ID),
        ]);
        return json({ ok: true, cleaned: true });
      } catch {
        return json({ error: "Cleanup failed" }, 503);
      }
    }

    return json({ error: "Not found" }, 404);
  },
};
