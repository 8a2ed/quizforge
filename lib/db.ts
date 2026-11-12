import { PrismaClient } from "@prisma/client";

declare global {
  // Prevent multiple Prisma instances in dev hot-reload
  var __prisma: PrismaClient | undefined;
}

function createPrismaClient(): PrismaClient {
  const url = process.env.DATABASE_URL;
  let connectionUrl = url;

  // Each production function instance should hold only a small local pool.
  // Preserve an explicit provider setting if the operator already supplied one.
  if (url) {
    try {
      const parsedUrl = new URL(url);
      if (!parsedUrl.searchParams.has("connection_limit")) {
        const configuredLimit = Number.parseInt(process.env.DB_CONNECTION_LIMIT || "1", 10);
        parsedUrl.searchParams.set(
          "connection_limit",
          String(Number.isFinite(configuredLimit) && configuredLimit > 0 ? configuredLimit : 1)
        );
      }
      connectionUrl = parsedUrl.toString();
    } catch {
      // Let Prisma report malformed connection strings with its normal error.
    }
  }

  return new PrismaClient({
    log: process.env.NODE_ENV === "development" ? ["error", "warn"] : ["error"],
    ...(connectionUrl
      ? {
          datasources: {
            db: {
              url: connectionUrl,
            },
          },
        }
      : {}),
  });
}

// Singleton: reuse across hot reloads in dev, single instance in prod
export const prisma: PrismaClient =
  globalThis.__prisma ?? createPrismaClient();

globalThis.__prisma = prisma;

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
 * Retry transient connection errors once. A high retry count multiplies database
 * traffic during an outage and can cause webhook/API requests to pile up.
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  retries = 2,
  baseDelayMs = 150
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
 * Graceful disconnect — call in cleanup handlers if needed.
 */
export async function dbDisconnect(): Promise<void> {
  await prisma.$disconnect();
}
