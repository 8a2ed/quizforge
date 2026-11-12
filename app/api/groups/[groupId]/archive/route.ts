import { getAuthSecret } from "@/lib/auth";
import { prisma, withRetry } from "@/lib/db";
import { jwtVerify, SignJWT } from "jose";
import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const DAY_MS = 24 * 60 * 60 * 1000;
const RETENTION_DAYS = 365;
const PAGE_SIZE = 200;
const DELETE_CONFIRMATION = "DELETE_OLDER_THAN_1_YEAR";
const JWT_SECRET = getAuthSecret();

type GroupParams = { params: Promise<{ groupId: string }> };

async function authorize(req: NextRequest, groupId: string) {
  const token = req.cookies.get("qf_session")?.value;
  if (!token) return { response: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };

  let userId: string;
  try {
    const { payload } = await jwtVerify(token, JWT_SECRET);
    if (typeof payload.sub !== "string") throw new Error("Missing subject");
    userId = payload.sub;
  } catch {
    return { response: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
  }

  try {
    const membership = await withRetry(() =>
      prisma.groupMember.findUnique({
        where: { userId_groupId: { userId, groupId } },
        select: { approved: true, role: true },
      })
    );
    if (!membership?.approved || (membership.role !== "OWNER" && membership.role !== "ADMIN")) {
      return { response: NextResponse.json({ error: "Forbidden" }, { status: 403 }) };
    }
    return { userId };
  } catch {
    return { response: NextResponse.json({ error: "Database unavailable" }, { status: 503 }) };
  }
}

function getCutoff() {
  return new Date(Date.now() - RETENTION_DAYS * DAY_MS);
}

async function getCounts(groupId: string, cutoff: Date) {
  const [quizzes, examResults, feedback] = await Promise.all([
    prisma.quiz.count({ where: { groupId, sentAt: { not: null, lt: cutoff } } }),
    prisma.examResult.count({ where: { completedAt: { lt: cutoff }, exam: { groupId } } }),
    prisma.examFeedback.count({ where: { createdAt: { lt: cutoff }, exam: { groupId } } }),
  ]);
  return { quizzes, examResults, feedback };
}

async function createArchiveToken(groupId: string, cutoff: Date) {
  return new SignJWT({ purpose: "annual-archive", groupId, cutoff: cutoff.toISOString() })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime("30m")
    .sign(JWT_SECRET);
}

async function readArchiveToken(token: unknown, groupId: string): Promise<Date | null> {
  if (typeof token !== "string" || token.length > 2048) return null;
  try {
    const { payload } = await jwtVerify(token, JWT_SECRET);
    if (payload.purpose !== "annual-archive" || payload.groupId !== groupId || typeof payload.cutoff !== "string") return null;
    const cutoff = new Date(payload.cutoff);
    if (!Number.isFinite(cutoff.getTime())) return null;
    return cutoff;
  } catch {
    return null;
  }
}

function csvCell(value: unknown): string {
  const raw = typeof value === "string" ? value : value == null ? "" : String(value);
  const text = /^[=+@\-\t\r]/.test(raw) ? `'${raw}` : raw;
  return `"${text.replace(/"/g, '""')}"`;
}

function csvLine(values: unknown[]): string {
  return `${values.map(csvCell).join(",")}\r\n`;
}

function jsonStream(groupId: string, cutoff: Date): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  async function* chunks(): AsyncGenerator<string> {
    yield `{"format":"quizforge-archive-v1","groupId":${JSON.stringify(groupId)},"cutoff":${JSON.stringify(cutoff.toISOString())},"retentionDays":${RETENTION_DAYS},"quizzes":[`;
    let first = true;
    let lastId = "";
    while (true) {
      const rows = await prisma.quiz.findMany({
        where: { groupId, sentAt: { not: null, lt: cutoff }, ...(lastId ? { id: { gt: lastId } } : {}) },
        orderBy: { id: "asc" },
        take: PAGE_SIZE,
        select: {
          id: true, question: true, options: true, correctOptionId: true,
          explanation: true, type: true, isAnonymous: true, allowsMultiple: true,
          openPeriod: true, topicId: true, topicName: true, mediaUrl: true,
          scheduledAt: true, recurrence: true, sentAt: true, deletedAt: true,
          pollClosed: true, messageId: true, pollId: true, tags: true,
          allowAddingOptions: true, allowRevoting: true, createdAt: true,
          groupId: true, sentById: true,
          answers: {
            select: { id: true, optionIds: true, answeredAt: true, telegramUserId: true, firstName: true, username: true },
            orderBy: { id: "asc" },
          },
          collections: {
            select: { collectionId: true, addedAt: true, collection: { select: { name: true, emoji: true, color: true } } },
          },
        },
      });
      if (rows.length === 0) break;
      for (const row of rows) {
        yield `${first ? "" : ","}${JSON.stringify(row)}`;
        first = false;
      }
      lastId = rows[rows.length - 1].id;
    }

    yield `],"examResults":[`;
    first = true;
    lastId = "";
    while (true) {
      const rows = await prisma.examResult.findMany({
        where: { completedAt: { lt: cutoff }, exam: { groupId }, ...(lastId ? { id: { gt: lastId } } : {}) },
        orderBy: { id: "asc" },
        take: PAGE_SIZE,
        select: {
          id: true, name: true, telegramId: true, answers: true, score: true,
          passed: true, duration: true, completedAt: true, examId: true,
          exam: { select: { title: true } },
        },
      });
      if (rows.length === 0) break;
      for (const row of rows) {
        yield `${first ? "" : ","}${JSON.stringify(row)}`;
        first = false;
      }
      lastId = rows[rows.length - 1].id;
    }

    yield `],"feedback":[`;
    first = true;
    lastId = "";
    while (true) {
      const rows = await prisma.examFeedback.findMany({
        where: { createdAt: { lt: cutoff }, exam: { groupId }, ...(lastId ? { id: { gt: lastId } } : {}) },
        orderBy: { id: "asc" },
        take: PAGE_SIZE,
        select: {
          id: true, examId: true, groupId: true, telegramId: true, name: true,
          username: true, rating: true, suggestion: true, createdAt: true,
          updatedAt: true, exam: { select: { title: true } },
        },
      });
      if (rows.length === 0) break;
      for (const row of rows) {
        yield `${first ? "" : ","}${JSON.stringify(row)}`;
        first = false;
      }
      lastId = rows[rows.length - 1].id;
    }
    yield "]}";
  }

  const iterator = chunks();
  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        const next = await iterator.next();
        if (next.done) controller.close();
        else controller.enqueue(encoder.encode(next.value));
      } catch (error) {
        controller.error(error);
      }
    },
    async cancel() {
      await iterator.return?.(undefined);
    },
  });
}

function csvStream(groupId: string, cutoff: Date): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  async function* chunks(): AsyncGenerator<string> {
    yield `\uFEFF${csvLine(["record_type", "id", "group_id", "recorded_at", "parent_id", "title", "payload_json"])}`;
    let lastId = "";
    while (true) {
      const rows = await prisma.quiz.findMany({
        where: { groupId, sentAt: { not: null, lt: cutoff }, ...(lastId ? { id: { gt: lastId } } : {}) },
        orderBy: { id: "asc" },
        take: PAGE_SIZE,
        include: {
          answers: true,
          collections: { select: { collectionId: true, addedAt: true, collection: { select: { name: true, emoji: true, color: true } } } },
        },
      });
      if (!rows.length) break;
      for (const row of rows) {
        const { answers, ...quiz } = row;
        yield csvLine(["quiz", row.id, groupId, row.sentAt?.toISOString(), "", row.question, JSON.stringify({ ...quiz, answers })]);
      }
      lastId = rows[rows.length - 1].id;
    }

    lastId = "";
    while (true) {
      const rows = await prisma.examResult.findMany({
        where: { completedAt: { lt: cutoff }, exam: { groupId }, ...(lastId ? { id: { gt: lastId } } : {}) },
        orderBy: { id: "asc" },
        take: PAGE_SIZE,
        include: { exam: { select: { title: true } } },
      });
      if (!rows.length) break;
      for (const row of rows) {
        const { exam, ...result } = row;
        yield csvLine(["exam_result", row.id, groupId, row.completedAt.toISOString(), row.examId, exam.title, JSON.stringify(result)]);
      }
      lastId = rows[rows.length - 1].id;
    }

    lastId = "";
    while (true) {
      const rows = await prisma.examFeedback.findMany({
        where: { createdAt: { lt: cutoff }, exam: { groupId }, ...(lastId ? { id: { gt: lastId } } : {}) },
        orderBy: { id: "asc" },
        take: PAGE_SIZE,
        include: { exam: { select: { title: true } } },
      });
      if (!rows.length) break;
      for (const row of rows) {
        const { exam, ...feedback } = row;
        yield csvLine(["exam_feedback", row.id, groupId, row.createdAt.toISOString(), row.examId, exam.title, JSON.stringify(feedback)]);
      }
      lastId = rows[rows.length - 1].id;
    }
  }

  const iterator = chunks();
  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        const next = await iterator.next();
        if (next.done) controller.close();
        else controller.enqueue(encoder.encode(next.value));
      } catch (error) {
        controller.error(error);
      }
    },
    async cancel() {
      await iterator.return?.(undefined);
    },
  });
}

export async function GET(req: NextRequest, { params }: GroupParams) {
  const { groupId } = await params;
  const auth = await authorize(req, groupId);
  if (auth.response) return auth.response;

  const cutoff = getCutoff();
  try {
    if (req.nextUrl.searchParams.get("preview") === "1") {
      const counts = await getCounts(groupId, cutoff);
      const archiveToken = await createArchiveToken(groupId, cutoff);
      return NextResponse.json({ ok: true, cutoff: cutoff.toISOString(), retentionDays: RETENTION_DAYS, counts, total: Object.values(counts).reduce((sum, count) => sum + count, 0), archiveToken }, { headers: { "Cache-Control": "no-store" } });
    }

    const format = req.nextUrl.searchParams.get("format");
    if (format !== "json" && format !== "csv") {
      return NextResponse.json({ error: "Use format=json or format=csv" }, { status: 400 });
    }

    const archiveCutoff = await readArchiveToken(req.nextUrl.searchParams.get("token"), groupId);
    if (!archiveCutoff) return NextResponse.json({ error: "Archive preview expired. Please preview again." }, { status: 400 });

    const date = new Date().toISOString().slice(0, 10);
    const extension = format === "json" ? "json" : "csv";
    return new Response(format === "json" ? jsonStream(groupId, archiveCutoff) : csvStream(groupId, archiveCutoff), {
      headers: {
        "Content-Type": format === "json" ? "application/json; charset=utf-8" : "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="quizforge-archive-${groupId}-${date}.${extension}"`,
        "Cache-Control": "no-store, no-transform",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch {
    return NextResponse.json({ error: "Failed to prepare archive" }, { status: 503 });
  }
}

export async function DELETE(req: NextRequest, { params }: GroupParams) {
  const { groupId } = await params;
  const auth = await authorize(req, groupId);
  if (auth.response) return auth.response;

  let body: { confirmation?: unknown; archiveToken?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }
  if (body.confirmation !== DELETE_CONFIRMATION) {
    return NextResponse.json({ error: "Explicit archive deletion confirmation required" }, { status: 400 });
  }

  const cutoff = await readArchiveToken(body.archiveToken, groupId);
  if (!cutoff) return NextResponse.json({ error: "Archive preview expired. Please export again before deleting." }, { status: 400 });
  try {
    const counts = await prisma.$transaction(async (tx) => {
      const [quizzes, examResults, feedback] = await Promise.all([
        tx.quiz.count({ where: { groupId, sentAt: { not: null, lt: cutoff } } }),
        tx.examResult.count({ where: { completedAt: { lt: cutoff }, exam: { groupId } } }),
        tx.examFeedback.count({ where: { createdAt: { lt: cutoff }, exam: { groupId } } }),
      ]);
      await tx.quiz.deleteMany({ where: { groupId, sentAt: { not: null, lt: cutoff } } });
      await tx.examResult.deleteMany({ where: { completedAt: { lt: cutoff }, exam: { groupId } } });
      await tx.examFeedback.deleteMany({ where: { createdAt: { lt: cutoff }, exam: { groupId } } });
      return { quizzes, examResults, feedback };
    });
    return NextResponse.json({ ok: true, cutoff: cutoff.toISOString(), retentionDays: RETENTION_DAYS, deleted: counts, total: Object.values(counts).reduce((sum, count) => sum + count, 0) }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return NextResponse.json({ error: "Archive cleanup failed; no records were intentionally removed" }, { status: 503 });
  }
}
