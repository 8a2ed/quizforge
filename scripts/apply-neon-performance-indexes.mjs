import dotenv from "dotenv";
import { PrismaClient } from "@prisma/client";

dotenv.config({ path: ".env.local" });
const prisma = new PrismaClient();

const indexes = [
  {
    name: "exam_results_score_examId_idx",
    sql: 'CREATE INDEX CONCURRENTLY IF NOT EXISTS "exam_results_score_examId_idx" ON "exam_results" ("score", "examId")',
  },
  {
    name: "quizzes_groupId_sentAt_idx",
    sql: 'CREATE INDEX CONCURRENTLY IF NOT EXISTS "quizzes_groupId_sentAt_idx" ON "quizzes" ("groupId", "sentAt")',
  },
  {
    name: "quizzes_sentAt_scheduledAt_idx",
    sql: 'CREATE INDEX CONCURRENTLY IF NOT EXISTS "quizzes_sentAt_scheduledAt_idx" ON "quizzes" ("sentAt", "scheduledAt")',
  },
];

try {
  for (const index of indexes) {
    await prisma.$executeRawUnsafe(index.sql);
    console.log(JSON.stringify({ ok: true, index: index.name }));
  }
} finally {
  await prisma.$disconnect();
}
