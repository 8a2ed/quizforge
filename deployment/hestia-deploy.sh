#!/bin/bash
# ─── QuizForge HestiaCP Deploy Script ──────────────────────────────
set -e

APP_DIR="/home/$USER/web/$(hostname -f)/public_html/quizforge"
PM2_APP_NAME="quizforge"

echo "📦 Pulling latest code…"
git pull origin main

echo "📥 Installing dependencies…"
npm install --production=false

echo "🏗️  Building application…"
npm run build

echo "🔄 Restarting PM2 process…"
if pm2 describe $PM2_APP_NAME > /dev/null 2>&1; then
  pm2 restart $PM2_APP_NAME
else
  pm2 start npm --name $PM2_APP_NAME -- start
fi

echo "💾 Saving PM2 process list…"
pm2 save

echo "✅ Deployment complete!"
pm2 list
