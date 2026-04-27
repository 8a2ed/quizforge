import { PrismaClient } from "@prisma/client";

const globalForPrisma = globalThis as unknown as { prisma: PrismaClient };

function createPrismaClient() {
  // Use DIRECT_URL for migrations, DATABASE_URL for queries (Neon pooler)
  return new PrismaClient({
    log: process.env.NODE_ENV === "development" ? ["error", "warn"] : ["error"],
    datasources: {
      db: {
        url: process.env.DATABASE_URL,
      },
    },
  });
}

export const prisma = globalForPrisma.prisma ?? createPrismaClient();

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;

/**
 * Retry wrapper with exponential backoff for Neon DB auto-pause / transient errors.
 * Neon serverless databases go to sleep after inactivity (E57P01).
 * The first reconnect attempt always succeeds within 500–1500ms.
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  retries = 4,
  baseDelayMs = 300
): Promise<T> {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      return await fn();
    } catch (error: unknown) {
      const err = error as { message?: string; code?: string };
      const isTransient =
        err?.message?.includes("terminating connection") ||
        err?.message?.includes("E57P01") ||
        err?.message?.includes("connection pool") ||
        err?.message?.includes("prepared statement") ||
        err?.code === "P1001" || // Can't reach DB
        err?.code === "P1008" || // Timeout
        err?.code === "P1017";   // Server closed connection

      if (isTransient && attempt < retries) {
        // Exponential backoff: 300ms → 600ms → 1200ms
        const delay = baseDelayMs * Math.pow(2, attempt - 1);
        console.warn(
          `[DB] Transient error on attempt ${attempt}/${retries}, retrying in ${delay}ms... (${err?.code || err?.message?.slice(0, 50)})`
        );
        await new Promise((r) => setTimeout(r, delay));
        continue;
      }
      throw error;
    }
  }
  throw new Error("Max DB retries exceeded");
}

/**
 * Lightweight keep-alive ping to prevent Neon from sleeping during long sessions.
 * Call this from a cron route (/api/cron) every 4 minutes.
 */
export async function dbPing() {
  await prisma.$queryRaw`SELECT 1`;
}
