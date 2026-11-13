const schedulerUrl = (process.env.EXAM_SCHEDULER_URL || "").replace(/\/$/, "");
const cronSecret = process.env.CRON_SECRET;

type SchedulerAction = "schedule" | "cancel";

async function callScheduler(action: SchedulerAction, payload: Record<string, unknown>): Promise<void> {
  // A missing URL must not block a student from taking an exam. The deployment
  // guide makes this visible, while the normal callback time-limit guard stays
  // in place as a last resort.
  if (!schedulerUrl || !cronSecret) return;

  const response = await fetch(`${schedulerUrl}/${action}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${cronSecret}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(8_000),
  });

  if (!response.ok) {
    throw new Error(`Exam scheduler returned HTTP ${response.status}`);
  }
}

export async function scheduleExamDeadline(input: {
  resultId: string;
  examId: string;
  dueAt: number;
}): Promise<void> {
  if (!Number.isFinite(input.dueAt) || input.dueAt <= Date.now()) return;
  await callScheduler("schedule", input);
}

export async function cancelExamDeadline(resultId: string | undefined): Promise<void> {
  if (!resultId) return;
  await callScheduler("cancel", { resultId });
}
