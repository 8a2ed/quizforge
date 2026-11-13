import dotenv from "dotenv";
import { PrismaClient } from "@prisma/client";

dotenv.config({ path: ".env.local" });
const prisma = new PrismaClient();
const prepareOnly = process.argv.includes("--prepare");

try {
  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS "quiz_poll_snapshots" (
      "quizId" TEXT PRIMARY KEY REFERENCES "quizzes"("id") ON DELETE CASCADE,
      "optionCounts" JSONB NOT NULL DEFAULT '[]'::jsonb,
      "totalVoterCount" INTEGER NOT NULL DEFAULT 0,
      "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  if (prepareOnly) {
    console.log(JSON.stringify({ ok: true, prepared: true }));
  } else {
  // Preserve the existing anonymous aggregate data as a starting snapshot.
  // Historic synthetic rows cannot reveal exact distinct voters for multi-answer
  // polls, so the sum is only a one-time fallback until Telegram sends an update.
  await prisma.$executeRawUnsafe(`
    WITH counts AS (
      SELECT
        pa."quizId",
        option_id::int AS "optionId",
        COUNT(*)::int AS "voterCount"
      FROM "poll_answers" pa
      CROSS JOIN LATERAL UNNEST(pa."optionIds") AS option_id
      WHERE pa."telegramUserId" LIKE 'anon\\_%' ESCAPE '\\'
      GROUP BY pa."quizId", option_id
    ), snapshots AS (
      SELECT
        "quizId",
        JSONB_AGG(JSONB_BUILD_OBJECT('optionId', "optionId", 'voterCount', "voterCount") ORDER BY "optionId") AS "optionCounts",
        SUM("voterCount")::int AS "totalVoterCount"
      FROM counts
      GROUP BY "quizId"
    )
    INSERT INTO "quiz_poll_snapshots" ("quizId", "optionCounts", "totalVoterCount", "updatedAt")
    SELECT "quizId", "optionCounts", "totalVoterCount", NOW()
    FROM snapshots
    ON CONFLICT ("quizId") DO NOTHING
  `);

  const deleted = await prisma.$executeRawUnsafe(`
    DELETE FROM "poll_answers"
    WHERE "telegramUserId" LIKE 'anon\\_%' ESCAPE '\\'
  `);

  console.log(JSON.stringify({ ok: true, deletedSyntheticRows: deleted }));
  }
} finally {
  await prisma.$disconnect();
}
