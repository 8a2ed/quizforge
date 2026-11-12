# Cloudflare D1 exam persistence spike

This isolated SQLite/D1 proof of concept is not wired into the application and does not touch Neon or production data.

## Local check

Run `node experiments/cloudflare-d1/test-answer-progress.mjs` with Node 22.13+ / 23.4+ (uses the built-in `node:sqlite` module). It checks an answer write, preservation of the randomized question snapshot, and rejection of a stale concurrent update.

## Remote D1 test Worker

The folder includes a minimal protected Worker and a client load-test script. Configure the binding in `wrangler.jsonc`, install a Worker secret, deploy it with Wrangler, then set `D1_TEST_URL`, `D1_TEST_SECRET`, `D1_TEST_STUDENTS` (1-200), and `D1_TEST_QUESTIONS` (1-20) in the local shell and run `node load-test.mjs`. The Worker only writes rows with a fixed `quizforge-d1-loadtest-*` prefix; `/test/cleanup` removes only those rows. Keep this Worker and database separate from production.

## D1 account validation still required

The local check verifies SQLite semantics only. The remote Worker test measures the isolated answer-write path, not Telegram delivery, the whole dashboard, or Neon parity. Before considering a migration, compare quota usage and verify export/restore. Do not point Vercel production at this schema.

The current app has PostgreSQL-specific Prisma models and queries. This spike covers only exam-session persistence; full migration requires mapping every model and route, not merely applying this SQL file.
