import { NextRequest, NextResponse } from "next/server";
import { jwtVerify } from "jose";
import { prisma, withRetry } from "@/lib/db";

const JWT_SECRET = new TextEncoder().encode(process.env.AUTH_SECRET || "secret");
const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;

async function authorize(req: NextRequest, groupId: string) {
  const token = req.cookies.get("qf_session")?.value;
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, JWT_SECRET);
    const userId = (payload as { sub: string }).sub;
    const m = await withRetry(() => prisma.groupMember.findUnique({
      where: { userId_groupId: { userId, groupId } },
      include: { group: true },
    }));
    if (!m || !m.approved) return null;
    return { userId, membership: m };
  } catch { return null; }
}

// GET /api/groups/[groupId]/exams
export async function GET(req: NextRequest, { params }: { params: Promise<{ groupId: string }> }) {
  const { groupId } = await params;
  const auth = await authorize(req, groupId);
  if (!auth) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const exams = await withRetry(() => prisma.exam.findMany({
    where: { groupId },
    include: { _count: { select: { results: true } }, createdBy: { select: { firstName: true, username: true } } },
    orderBy: { createdAt: "desc" },
  }));

  return NextResponse.json({ exams });
}

// POST /api/groups/[groupId]/exams
export async function POST(req: NextRequest, { params }: { params: Promise<{ groupId: string }> }) {
  const { groupId } = await params;
  const auth = await authorize(req, groupId);
  if (!auth) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json();
  const { title, description, questions, timeLimit, passingScore } = body;

  if (!title?.trim()) return NextResponse.json({ error: "Title required" }, { status: 400 });
  if (!Array.isArray(questions) || questions.length < 1)
    return NextResponse.json({ error: "At least 1 question required" }, { status: 400 });

  const exam = await withRetry(() => prisma.exam.create({
    data: {
      title: title.trim(),
      description: description?.trim() || null,
      questions,
      timeLimit: timeLimit ? Number(timeLimit) : null,
      passingScore: passingScore ? Number(passingScore) : 60,
      isPublished: false,
      groupId,
      createdById: auth.userId,
    },
  }));

  return NextResponse.json({ ok: true, exam });
}

// PATCH /api/groups/[groupId]/exams — update exam
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ groupId: string }> }) {
  const { groupId } = await params;
  const auth = await authorize(req, groupId);
  if (!auth) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json();
  const { id, title, description, questions, timeLimit, passingScore, isPublished } = body;
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });

  const updated = await withRetry(() => prisma.exam.updateMany({
    where: { id, groupId },
    data: {
      ...(title !== undefined ? { title: title.trim() } : {}),
      ...(description !== undefined ? { description: description?.trim() || null } : {}),
      ...(questions !== undefined ? { questions } : {}),
      ...(timeLimit !== undefined ? { timeLimit: timeLimit ? Number(timeLimit) : null } : {}),
      ...(passingScore !== undefined ? { passingScore: Number(passingScore) } : {}),
      ...(isPublished !== undefined ? { isPublished } : {}),
    },
  }));

  // If publishing, send launch message to Telegram group
  if (isPublished === true && updated.count > 0) {
    const exam = await prisma.exam.findFirst({ where: { id, groupId }, include: { group: true } });
    if (exam && exam.group) {
      const questions = exam.questions as Array<Record<string, unknown>>;
      const msg = [
        `📋 *${exam.title}*`,
        exam.description ? `\n${exam.description}` : "",
        `\n\n📊 *${questions.length} questions*`,
        exam.timeLimit ? `\n⏱ ${Math.floor(exam.timeLimit / 60)} minute time limit` : "",
        `\n✅ Passing score: ${exam.passingScore}%`,
        "\n\n*Press the button below to start the exam in your DMs.*",
      ].filter(Boolean).join("");

      try {
        const res = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            chat_id: exam.group.chatId,
            text: msg,
            parse_mode: "Markdown",
            reply_markup: {
              inline_keyboard: [[{ text: "🚀 Start Exam", callback_data: `exam_start:${exam.id}` }]],
            },
          }),
        });
        const data = await res.json();
        if (data.ok) {
          await prisma.exam.update({ where: { id }, data: { launchMsgId: data.result.message_id } });
        }
      } catch (e) { console.error("[exam launch]", e); }
    }
  }

  return NextResponse.json({ ok: true });
}

// DELETE /api/groups/[groupId]/exams
export async function DELETE(req: NextRequest, { params }: { params: Promise<{ groupId: string }> }) {
  const { groupId } = await params;
  const auth = await authorize(req, groupId);
  if (!auth) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await req.json();
  await withRetry(() => prisma.exam.deleteMany({ where: { id, groupId } }));
  return NextResponse.json({ ok: true });
}
