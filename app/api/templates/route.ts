import { NextRequest, NextResponse } from "next/server";
import { jwtVerify } from "jose";
import { prisma, withRetry } from "@/lib/db";

const JWT_SECRET = new TextEncoder().encode(process.env.AUTH_SECRET || "secret");

async function getUser(req: NextRequest) {
  const token = req.cookies.get("qf_session")?.value;
  if (!token) return null;
  const { payload } = await jwtVerify(token, JWT_SECRET).catch(() => ({ payload: null }));
  return payload ? (payload as { sub: string }) : null;
}

/** Resolve the real DB group.id for the user's virtual template group */
async function getTemplateGroupId(userId: string): Promise<string | null> {
  const templateChatId = `template:${userId}`;
  const group = await withRetry(() =>
    prisma.group.findUnique({ where: { chatId: templateChatId }, select: { id: true } })
  );
  return group?.id ?? null;
}

/** Ensure the virtual template group exists and return its DB id */
async function ensureTemplateGroup(userId: string): Promise<string> {
  const templateChatId = `template:${userId}`;
  let group = await withRetry(() =>
    prisma.group.findUnique({ where: { chatId: templateChatId }, select: { id: true } })
  );
  if (!group) {
    group = await withRetry(() =>
      prisma.group.create({
        data: { chatId: templateChatId, title: "Templates", isForum: false, botConfig: { create: {} } },
        select: { id: true },
      })
    );
    await withRetry(() =>
      prisma.groupMember.create({ data: { userId, groupId: group!.id, role: "OWNER" } })
    );
  }
  return group.id;
}

// GET /api/templates — list user's saved templates
export async function GET(req: NextRequest) {
  const user = await getUser(req);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const groupId = await getTemplateGroupId(user.sub);
  if (!groupId) return NextResponse.json({ templates: [] });

  const templates = await withRetry(() =>
    prisma.quiz.findMany({
      where: { sentById: user.sub, groupId },  // ← real DB UUID, not chatId
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        question: true,
        options: true,
        type: true,
        isAnonymous: true,
        correctOptionId: true,
        explanation: true,
        allowsMultiple: true,
        openPeriod: true,
        tags: true,
        createdAt: true,
      },
    })
  );

  return NextResponse.json({ templates });
}

// POST /api/templates — save a template
export async function POST(req: NextRequest) {
  const user = await getUser(req);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json();
  const { question, options, type, isAnonymous, correctOptionId, explanation, allowsMultiple, openPeriod, tags } = body;

  if (!question?.trim() || !options?.length) {
    return NextResponse.json({ error: "Question and options are required" }, { status: 400 });
  }

  const groupId = await ensureTemplateGroup(user.sub);

  const template = await withRetry(() =>
    prisma.quiz.create({
      data: {
        question: question.trim(),
        options,
        type: type === "poll" ? "POLL" : "QUIZ",
        isAnonymous: isAnonymous ?? true,
        correctOptionId: type === "quiz" ? (correctOptionId ?? null) : null,
        explanation: explanation?.trim() || null,
        allowsMultiple: allowsMultiple ?? false,
        openPeriod: openPeriod || null,
        tags: tags || [],
        groupId,
        sentById: user.sub,
      },
    })
  );

  return NextResponse.json({ ok: true, template });
}

// DELETE /api/templates — delete by ?id=... (legacy, kept for compat)
export async function DELETE(req: NextRequest) {
  const user = await getUser(req);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { searchParams } = req.nextUrl;
  const id = searchParams.get("id");
  if (!id) return NextResponse.json({ error: "ID required" }, { status: 400 });

  const groupId = await getTemplateGroupId(user.sub);
  if (!groupId) return NextResponse.json({ error: "No library found" }, { status: 404 });

  await withRetry(() =>
    prisma.quiz.deleteMany({ where: { id, sentById: user.sub, groupId } })
  );

  return NextResponse.json({ ok: true });
}
