import { Prisma } from "@prisma/client";
import { prisma, withRetry } from "@/lib/db";

export interface PollOptionCount {
  optionId: number;
  voterCount: number;
}

function normaliseOptionCounts(options: Array<{ voter_count?: number }>): PollOptionCount[] {
  return options.map((option, optionId) => ({
    optionId,
    voterCount: Math.max(0, Math.floor(Number(option.voter_count) || 0)),
  }));
}

/**
 * Stores the latest anonymous Telegram poll tally in one row. Telegram does not
 * reveal anonymous voters, so creating a synthetic row for every vote is both
 * misleading and needlessly expensive for long-lived polls.
 */
export async function upsertAnonymousPollSnapshot(
  quizId: string,
  options: Array<{ voter_count?: number }>,
  totalVoterCount: number
): Promise<void> {
  if (!quizId || !Array.isArray(options)) return;

  const counts = normaliseOptionCounts(options);
  const safeTotal = Math.max(0, Math.floor(Number(totalVoterCount) || 0));
  const countsJson = JSON.stringify(counts);

  await withRetry(() => prisma.$executeRaw`
    INSERT INTO "quiz_poll_snapshots" (
      "quizId", "optionCounts", "totalVoterCount", "updatedAt"
    )
    VALUES (
      ${quizId}, ${countsJson}::jsonb, ${safeTotal}, NOW()
    )
    ON CONFLICT ("quizId") DO UPDATE
    SET
      "optionCounts" = EXCLUDED."optionCounts",
      "totalVoterCount" = EXCLUDED."totalVoterCount",
      "updatedAt" = NOW()
    WHERE "quiz_poll_snapshots"."optionCounts" IS DISTINCT FROM EXCLUDED."optionCounts"
       OR "quiz_poll_snapshots"."totalVoterCount" IS DISTINCT FROM EXCLUDED."totalVoterCount"
  `);
}

export function parsePollOptionCounts(value: Prisma.JsonValue | null | undefined): PollOptionCount[] {
  if (!Array.isArray(value)) return [];

  return value.flatMap((item) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) return [];
    const record = item as Record<string, unknown>;
    const optionId = Number(record.optionId);
    const voterCount = Number(record.voterCount);
    if (!Number.isInteger(optionId) || optionId < 0 || !Number.isFinite(voterCount) || voterCount < 0) {
      return [];
    }
    return [{ optionId, voterCount: Math.floor(voterCount) }];
  });
}
