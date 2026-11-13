const CHECK_EXAMS_PATH = "/api/cron/check-exams";
const SCHEDULER_NAME = "active-exam-deadlines";

export class ExamDeadlineScheduler {
  constructor(ctx, env) { this.ctx = ctx; this.env = env; }

  async fetch(request) {
    const url = new URL(request.url);
    if (request.method !== "POST") return Response.json({ ok: false, error: "Not found" }, { status: 404 });
    const body = await request.json().catch(() => null);
    if (!body || typeof body !== "object") return Response.json({ ok: false, error: "Invalid JSON" }, { status: 400 });

    if (url.pathname === "/schedule") {
      const { resultId, examId, dueAt } = body;
      if (typeof resultId !== "string" || typeof examId !== "string" || !Number.isFinite(dueAt)) {
        return Response.json({ ok: false, error: "Invalid deadline" }, { status: 400 });
      }
      await this.ctx.storage.put(`deadline:${resultId}`, { resultId, examId, dueAt: Math.max(Date.now(), dueAt) });
      await this.armNextAlarm();
      return Response.json({ ok: true });
    }

    if (url.pathname === "/cancel") {
      const { resultId } = body;
      if (typeof resultId !== "string") return Response.json({ ok: false, error: "Invalid result ID" }, { status: 400 });
      await this.ctx.storage.delete(`deadline:${resultId}`);
      await this.armNextAlarm();
      return Response.json({ ok: true });
    }
    return Response.json({ ok: false, error: "Not found" }, { status: 404 });
  }

  async alarm() {
    const now = Date.now();
    const entries = await this.ctx.storage.list({ prefix: "deadline:" });
    const due = [];
    for (const [key, event] of entries) if (event.dueAt <= now + 1000) due.push([key, event]);

    // At-least-once delivery is intentional. The Postgres score=-1 guard is
    // the final authority, so duplicate deliveries cannot finalise twice.
    for (const [key, event] of due) {
      try {
        await this.expireResult(event);
        await this.ctx.storage.delete(key);
      } catch (error) {
        console.error("deadline delivery failed", event.resultId, String(error));
        await this.ctx.storage.put(key, { ...event, dueAt: Date.now() + 15_000 });
      }
    }
    await this.armNextAlarm();
  }

  async expireResult(event) {
    if (!this.env.APP_BASE_URL || !this.env.CRON_SECRET) throw new Error("Missing Worker configuration");
    const url = new URL(CHECK_EXAMS_PATH, this.env.APP_BASE_URL);
    url.searchParams.set("resultId", event.resultId);
    url.searchParams.set("examId", event.examId);
    const response = await fetch(url, {
      method: "POST",
      headers: { Authorization: `Bearer ${this.env.CRON_SECRET}` },
      signal: AbortSignal.timeout(55_000),
    });
    if (!response.ok) throw new Error(`expiry endpoint returned HTTP ${response.status}`);
  }

  async armNextAlarm() {
    const entries = await this.ctx.storage.list({ prefix: "deadline:" });
    let nextDueAt = null;
    for (const event of entries.values()) if (nextDueAt === null || event.dueAt < nextDueAt) nextDueAt = event.dueAt;
    if (nextDueAt === null) await this.ctx.storage.deleteAlarm();
    else await this.ctx.storage.setAlarm(Math.max(Date.now(), nextDueAt));
  }
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === "/health" && request.method === "GET") return Response.json({ ok: true, service: "exam-deadline-scheduler" });
    if (!isAuthorized(request, env.CRON_SECRET)) return Response.json({ ok: false, error: "Unauthorized" }, { status: 401 });
    if (!["/schedule", "/cancel"].includes(url.pathname) || request.method !== "POST") {
      return Response.json({ ok: false, error: "Not found" }, { status: 404 });
    }
    const id = env.EXAM_DEADLINES.idFromName(SCHEDULER_NAME);
    return env.EXAM_DEADLINES.get(id).fetch(request);
  },
};

function isAuthorized(request, expectedSecret) {
  if (!expectedSecret) return false;
  const supplied = /^Bearer\s+(\S+)$/i.exec(request.headers.get("authorization") || "")?.[1];
  return supplied === expectedSecret;
}
