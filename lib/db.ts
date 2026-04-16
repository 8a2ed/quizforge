import { PrismaClient } from "@prisma/client";

const globalForPrisma = globalThis as unknown as { prisma: PrismaClient };

function createPrismaClient() {
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
 * Wraps a Prisma query with automatic retry logic for Neon DB auto-pause.
 * Neon serverless databases go to sleep after inactivity (E57P01 error).
 * The first retry after wake-up always succeeds.
 */
export async function withRetry<T>(fn: () => Promise<T>, retries = 3, delayMs = 500): Promise<T> {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      return await fn();
    } catch (error: any) {
      const isNeonSleep =
        error?.message?.includes("terminating connection") ||
        error?.message?.includes("E57P01") ||
        error?.code === "P1001" || // Can't reach DB
        error?.code === "P1017";   // Server closed connection

      if (isNeonSleep && attempt < retries) {
        console.warn(`[DB] Neon wakeup detected (attempt ${attempt}/${retries}), retrying in ${delayMs}ms...`);
        await new Promise((r) => setTimeout(r, delayMs));
        continue;
      }
      throw error;
    }
  }
  throw new Error("Max DB retries exceeded");
}
