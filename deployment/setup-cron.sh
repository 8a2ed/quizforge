#!/bin/bash
# HestiaCP Cron Job Setup for QuizForge Scheduler

echo "============================================="
echo "   QuizForge Auto-Scheduler Cron Setup"
echo "============================================="
echo ""

if [ -z "$1" ]; then
  echo "Usage: ./setup-cron.sh <YOUR_APP_URL> <CRON_SECRET>"
  echo "Example: ./setup-cron.sh https://quiz.my-domain.com my_super_secret"
  exit 1
fi

APP_URL=$1
CRON_SECRET=$2
CRON_ENDPOINT="$APP_URL/api/cron?secret=$CRON_SECRET"

echo "Testing endpoint connection..."
HTTP_STATUS=$(curl -s -o /dev/null -w "%{http_code}" "$CRON_ENDPOINT")

if [ "$HTTP_STATUS" -eq 200 ] || [ "$HTTP_STATUS" -eq 401 ]; then
  echo "✔ Endpoint reachable."
else
  echo "⚠️ Warning: Endpoint returned status $HTTP_STATUS"
fi

# Add the cron job (Runs every minute)
CRON_CMD="* * * * * curl -s \"$CRON_ENDPOINT\" > /dev/null 2>&1"

(crontab -l 2>/dev/null; echo "$CRON_CMD") | crontab -

echo "✔ Cron job successfully installed!"
echo "Your scheduled quizzes will now trigger exactly on time."
echo "Active Command:"
echo "$CRON_CMD"
