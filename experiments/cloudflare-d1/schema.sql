-- Isolated D1 proof-of-concept schema for exam delivery.
-- This is not the production schema and must not be applied to Neon.
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS groups (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS exams (
  id TEXT PRIMARY KEY,
  group_id TEXT NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  questions TEXT NOT NULL CHECK (json_valid(questions)),
  time_limit INTEGER,
  passing_score INTEGER NOT NULL DEFAULT 60,
  is_published INTEGER NOT NULL DEFAULT 0 CHECK (is_published IN (0, 1))
);

CREATE TABLE IF NOT EXISTS exam_results (
  id TEXT PRIMARY KEY,
  exam_id TEXT NOT NULL REFERENCES exams(id) ON DELETE CASCADE,
  telegram_id TEXT NOT NULL,
  name TEXT NOT NULL,
  answers TEXT NOT NULL CHECK (json_valid(answers)),
  score INTEGER NOT NULL DEFAULT -1,
  passed INTEGER NOT NULL DEFAULT 0 CHECK (passed IN (0, 1)),
  duration INTEGER,
  completed_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX IF NOT EXISTS exam_results_one_active_attempt
  ON exam_results(exam_id, telegram_id) WHERE score = -1;
CREATE INDEX IF NOT EXISTS exam_results_exam_completed
  ON exam_results(exam_id, completed_at);
