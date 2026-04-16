#!/bin/bash
# ═══════════════════════════════════════════════════════════════════
# QuizForge — Quick Redeploy (no DB migration, faster)
# Use this for UI/logic changes that don't touch the schema
# Run from VPS: bash quick-deploy.sh
# ═══════════════════════════════════════════════════════════════════
set -e
APP_DIR="/home/quizforge/web/$(hostname -f)/quizforge"
PM2_NAME="quizforge"

echo "⚡ Quick deploy starting..."
cd "$APP_DIR"
git pull origin main
npm run build
pm2 restart "$PM2_NAME" --update-env
echo "✅ Done! Live in ~1 second."
pm2 logs "$PM2_NAME" --lines 10 --nostream
