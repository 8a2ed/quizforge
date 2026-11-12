# Exam expiry scheduler

This Cloudflare Worker calls the production exam-expiry endpoint once per minute. The shared lease lock in Neon prevents overlapping Vercel instances and other callers from scanning the same in-progress sessions simultaneously.

## One-time setup

1. Apply the Prisma migration to the production database after confirming Vercel has the correct `DATABASE_URL` and `DIRECT_URL`:

   ```powershell
   cd "C:\Users\ahmed\Desktop\Quiz Maker Latest\quizforge-main"
   npx prisma migrate deploy
   ```

2. In Vercel, redeploy Production after adding `CRON_SECRET`. The Worker secret must be exactly the same value; never commit or paste it into this repository.
3. In a separate PowerShell window, deploy this Worker:

   ```powershell
   cd "C:\Users\ahmed\Desktop\Quiz Maker Latest\quizforge-main\experiments\cloudflare-exam-scheduler"
   npx wrangler secret put CRON_SECRET
   npx wrangler deploy
   ```

   When prompted, enter the same secret stored in Vercel. This creates a separate Worker and does not change the D1 load-test Worker.

## Verify

1. Check the Worker URL printed by Wrangler:

   ```powershell
   Invoke-RestMethod -Uri 'https://quizforge-exam-expiry-scheduler.agridmu.workers.dev/health'
   ```

2. Trigger one authenticated run manually. In PowerShell, set the secret without echoing it, then:

   ```powershell
   $secure = Read-Host 'Enter CRON_SECRET' -AsSecureString
   $env:CRON_SECRET = [Net.NetworkCredential]::new('', $secure).Password
   $headers = @{ Authorization = "Bearer $env:CRON_SECRET" }
   Invoke-RestMethod -Method Post -Uri 'https://quizforge-exam-expiry-scheduler.agridmu.workers.dev/run' -Headers $headers
   Remove-Item Env:\CRON_SECRET
   ```

3. In Cloudflare, open **Workers & Pages → quizforge-exam-expiry-scheduler → Triggers / Logs** and confirm scheduled invocations succeed. In Vercel, inspect Production function logs for `/api/cron/check-exams`.
4. If the endpoint reports `Unauthorized`, verify that Vercel Production was redeployed after setting the variable and that the Worker secret is identical.

The existing Vercel `/api/cron` schedule is left intact because it handles scheduled quizzes and poll maintenance too. The central Worker only calls `/api/cron/check-exams`.
