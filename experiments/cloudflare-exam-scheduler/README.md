# Exact exam deadline scheduler

This Worker does not poll Neon. It keeps only active exam deadlines in one
SQLite-backed Durable Object and calls QuizForge exactly when a student's
deadline is due. The Vercel endpoint remains authoritative and uses an atomic
`score = -1` transition, so alarm retries cannot finalise an attempt twice.

## Required configuration

1. Keep `CRON_SECRET` in this Worker and Vercel identical.
2. In Vercel Production, add:

   ```text
   EXAM_SCHEDULER_URL=https://quizforge-exam-expiry-scheduler.agridmu.workers.dev
   ```

   Then redeploy Production.
3. Deploy this folder:

   ```powershell
   cd "C:\Users\ahmed\Desktop\Quiz Maker Latest\quizforge-main\experiments\cloudflare-exam-scheduler"
   npx wrangler deploy
   ```

## Verify

```powershell
Invoke-RestMethod -Uri 'https://quizforge-exam-expiry-scheduler.agridmu.workers.dev/health'
```

Start a short test exam. In Cloudflare Observability, you should see one
`/schedule` request when the student starts it, and one alarm at the exact
deadline. There must be no repeating Cron trigger after deployment.
