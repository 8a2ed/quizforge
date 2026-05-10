import { PrismaClient } from "@prisma/client";

declare global {
  // Prevent multiple Prisma instances in dev hot-reload
  // eslint-disable-next-line no-var
  var __prisma: PrismaClient | undefined;
}

function createPrismaClient(): PrismaClient {
  return new PrismaClient({
    log: process.env.NODE_ENV === "development" ? ["error", "warn"] : ["error"],
    datasources: {
      db: {
        // Use pgbouncer=true for the pooled URL to prevent prepared statement conflicts
        url: process.env.DATABASE_URL,
      },
    },
  });
}

// Singleton: reuse across hot reloads in dev, single instance in prod
export const prisma: PrismaClient =
  globalThis.__prisma ?? createPrismaClient();

if (process.env.NODE_ENV !== "production") {
  globalThis.__prisma = prisma;
}

// ── Transient error detection ──────────────────────────────────────────────────
const TRANSIENT_CODES = new Set(["P1001", "P1008", "P1017", "P2024"]);
const TRANSIENT_MESSAGES = [
  "terminating connection",
  "E57P01",
  "connection pool",
  "prepared statement",
  "SSL connection",
  "ECONNRESET",
  "ETIMEDOUT",
  "socket hang up",
  "Can't reach database",
  "connection timed out",
];

function isTransientError(err: unknown): boolean {
  const e = err as { message?: string; code?: string };
  if (e?.code && TRANSIENT_CODES.has(e.code)) return true;
  if (e?.message && TRANSIENT_MESSAGES.some((m) => e.message!.includes(m))) return true;
  return false;
}

/**
 * Retry wrapper with exponential backoff for Neon DB auto-pause / transient errors.
 * Retries up to 5 times: 200ms → 400ms → 800ms → 1600ms
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  retries = 5,
  baseDelayMs = 200
): Promise<T> {
  let lastError: unknown;

  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      return await fn();
    } catch (error: unknown) {
      lastError = error;

      if (isTransientError(error) && attempt < retries) {
        // Jittered exponential backoff
        const base = baseDelayMs * Math.pow(2, attempt - 1);
        const jitter = Math.floor(Math.random() * base * 0.3); // ±30% jitter
        const delay = base + jitter;
        const e = error as { code?: string; message?: string };
        console.warn(
          `[DB] Transient error attempt ${attempt}/${retries} — retrying in ${delay}ms` +
            (e?.code ? ` (code: ${e.code})` : "") +
            (e?.message ? ` — ${e.message.slice(0, 80)}` : "")
        );
        await new Promise((r) => setTimeout(r, delay));
        continue;
      }

      // Non-transient or last attempt — surface immediately
      throw error;
    }
  }

  throw lastError ?? new Error("[DB] Max retries exceeded");
}

/**
 * Lightweight keep-alive ping. Call from /api/cron to prevent Neon from sleeping.
 * Also warms the connection pool on cold starts.
 */
export async function dbPing(): Promise<void> {
  await prisma.$queryRaw`SELECT 1`;
}

/**
 * Graceful disconnect — call in cleanup handlers if needed.
 */
export async function dbDisconnect(): Promise<void> {
  await prisma.$disconnect();
}
