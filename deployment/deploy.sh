#!/bin/bash
# ═══════════════════════════════════════════════════════════════════
# QuizForge — One-Command Deploy Script for HestiaCP
# Run this from your VPS: bash deploy.sh
# ═══════════════════════════════════════════════════════════════════
set -e

# ── CONFIG (edit these once) ───────────────────────────────────────
APP_DIR="/home/quizforge/web/$(hostname -f)/quizforge"
PM2_NAME="quizforge"
PORT=3001       # Internal port (Nginx proxies to this)
NODE_ENV="production"

# ── Colors ─────────────────────────────────────────────────────────
GREEN='\033[0;32m'; BLUE='\033[0;34m'; YELLOW='\033[1;33m'; NC='\033[0m'
step() { echo -e "${BLUE}▶ $1${NC}"; }
ok()   { echo -e "${GREEN}✓ $1${NC}"; }
warn() { echo -e "${YELLOW}⚠ $1${NC}"; }

step "Pulling latest code from Git..."
cd "$APP_DIR"
git pull origin main
ok "Code updated"

step "Installing dependencies (skipping devDeps)..."
npm ci --omit=dev
ok "Dependencies ready"

step "Generating Prisma Client..."
npx prisma generate
ok "Prisma generated"

step "Running DB migrations..."
npx prisma migrate deploy
ok "Database migrated"

step "Building Next.js production bundle..."
npm run build
ok "Build complete"

step "Restarting app with PM2..."
if pm2 describe "$PM2_NAME" > /dev/null 2>&1; then
  pm2 restart "$PM2_NAME" --update-env
  ok "PM2 restarted: $PM2_NAME"
else
  pm2 start npm --name "$PM2_NAME" \
    --cwd "$APP_DIR" \
    -- start -- -p $PORT
  ok "PM2 started on port $PORT"
fi

pm2 save
ok "PM2 process list saved (survives reboot)"

echo ""
echo -e "${GREEN}════════════════════════════════════════${NC}"
echo -e "${GREEN}  ✅ QuizForge deployed successfully!   ${NC}"
echo -e "${GREEN}════════════════════════════════════════${NC}"
pm2 list
