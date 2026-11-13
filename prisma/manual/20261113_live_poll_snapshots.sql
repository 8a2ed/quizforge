-- Run once against the production database only after a verified exported_data
-- backup exists. The application script performs this same idempotent change.
CREATE TABLE IF NOT EXISTS "quiz_poll_snapshots" (
  "quizId" TEXT PRIMARY KEY REFERENCES "quizzes"("id") ON DELETE CASCADE,
  "optionCounts" JSONB NOT NULL DEFAULT '[]'::jsonb,
  "totalVoterCount" INTEGER NOT NULL DEFAULT 0,
  "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX CONCURRENTLY IF NOT EXISTS "exam_results_score_examId_idx"
  ON "exam_results" ("score", "examId");
CREATE INDEX CONCURRENTLY IF NOT EXISTS "quizzes_groupId_sentAt_idx"
  ON "quizzes" ("groupId", "sentAt");
CREATE INDEX CONCURRENTLY IF NOT EXISTS "quizzes_sentAt_scheduledAt_idx"
  ON "quizzes" ("sentAt", "scheduledAt");
