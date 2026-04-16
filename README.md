# QuizForge 🎯

> A production-grade, multi-tenant Telegram Quiz Dashboard built with Next.js 14, Prisma, and PostgreSQL.

## Features

- **Multi-tenant** — any Telegram group owner can self-onboard
- **Quiz Builder** — dynamic options (2–10), correct answer selector, live preview, topic routing
- **Poll Support** — regular polls with multiple-answer mode
- **Real-time Analytics** — Recharts line/bar/pie charts, admin leaderboard, activity timeline
- **Webhook Receiver** — captures live `poll_answer` events from Telegram
- **Quiz History** — sortable/filterable table with CSV export
- **Admin Management** — auto-detected from Telegram, approve/revoke dashboard access
- **Telegram Login** — HMAC-SHA256 verified, no OAuth dependency
- **Dual Deploy** — HestiaCP (VPS) + Azure App Service support

## Quick Start

### 1. Prerequisites

- Node.js 20+
- A Telegram Bot ([@agridmu_bot](https://t.me/agridmu_bot))  
- PostgreSQL database ([Neon.tech](https://neon.tech) free tier works great)

### 2. Setup

```bash
# Clone and install
git clone <your-repo>
cd quizforge
npm install

# Configure environment
cp .env.example .env.local
# Edit .env.local with your database URL, auth secret, etc.

# Generate Prisma client & run migrations
npx prisma generate
npx prisma migrate dev --name init

# Start development server
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) — you'll be redirected to the login page.

### 3. First-Time Setup

1. Log in with your Telegram account via the login page
2. Click **Add Group** and enter your group's Chat ID (e.g. `-1003107991544`)
3. Make sure `@agridmu_bot` is already an admin in the group
4. Go to **Settings → Register Webhook** to enable live poll answer tracking

### 4. Finding Your Group Chat ID

- Forward a message from your group to [@userinfobot](https://t.me/userinfobot)
- Or use the Telegram API: `https://api.telegram.org/bot<TOKEN>/getUpdates`

## Environment Variables

See [`.env.example`](.env.example) for all required variables.

| Variable | Description |
|---|---|
| `DATABASE_URL` | PostgreSQL connection string |
| `AUTH_SECRET` | Random 32-byte secret for JWT signing |
| `TELEGRAM_BOT_TOKEN` | Your bot token from @BotFather |
| `NEXT_PUBLIC_BOT_USERNAME` | Bot username without @ |
| `WEBHOOK_BASE_URL` | Public URL for Telegram to POST updates |
| `NEXTAUTH_URL` | Your app's public URL |

## Deployment

### HestiaCP (VPS)

```bash
# Upload code to server, then:
bash deployment/hestia-deploy.sh
```

### Azure App Service

Push to `main` branch — GitHub Actions will automatically:
1. Install dependencies
2. Run Prisma migrations
3. Build the app
4. Deploy to Azure

See [`deployment/azure-deploy.yml`](deployment/azure-deploy.yml) for required GitHub Secrets.

## Tech Stack

| Layer | Technology |
|---|---|
| Framework | Next.js 16 (App Router, Turbopack) |
| Database | PostgreSQL via Prisma 5 |
| Auth | Custom Telegram Login Widget + jose JWT |
| Charts | Recharts |
| Animations | CSS animations + Framer Motion |
| Hosting | Azure App Service + HestiaCP |

## Database Schema

- **User** — Telegram users who have logged in
- **Group** — Telegram groups added to the dashboard  
- **GroupMember** — User ↔ Group membership with roles (OWNER/ADMIN/VIEWER)
- **Quiz** — All sent quizzes with full metadata
- **PollAnswer** — Individual answers from Telegram webhook
- **Topic** — Cached forum topics per group
- **BotConfig** — Per-group bot settings and webhook secrets

## License

MIT
