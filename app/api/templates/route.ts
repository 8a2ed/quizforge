import { NextRequest, NextResponse } from "next/server";
import { jwtVerify } from "jose";
import { prisma } from "@/lib/db";

const JWT_SECRET = new TextEncoder().encode(process.env.AUTH_SECRET || "secret");

async function getUser(req: NextRequest) {
  const token = req.cookies.get("qf_session")?.value;
  if (!token) return null;
  const { payload } = await jwtVerify(token, JWT_SECRET).catch(() => ({ payload: null }));
  return payload ? (payload as { sub: string }) : null;
}

// GET /api/templates — list user's saved templates
export async function GET(req: NextRequest) {
  const user = await getUser(req);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  // Use a special group marker "template" stored in quiz with groupId = user.sub
  const templates = await prisma.quiz.findMany({
    where: { sentById: user.sub, groupId: `template:${user.sub}` },
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
      createdAt: true,
    },
  });

  return NextResponse.json({ templates });
}

// POST /api/templates — save a template
export async function POST(req: NextRequest) {
  const user = await getUser(req);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json();
  const { question, options, type, isAnonymous, correctOptionId, explanation, allowsMultiple, openPeriod } = body;

  if (!question?.trim() || !options?.length) {
    return NextResponse.json({ error: "Question and options are required" }, { status: 400 });
  }

  // Ensure template group exists (virtual group for user templates)
  const templateGroupId = `template:${user.sub}`;

  // We need a real group for the foreign key — use a virtual placeholder
  let group = await prisma.group.findUnique({ where: { chatId: templateGroupId } });
  if (!group) {
    group = await prisma.group.create({
      data: {
        chatId: templateGroupId,
        title: "Templates",
        isForum: false,
        botConfig: { create: {} },
      },
    });
    // Add user as owner of this template group
    await prisma.groupMember.create({
      data: { userId: user.sub, groupId: group.id, role: "OWNER" },
    });
  }

  const template = await prisma.quiz.create({
    data: {
      question: question.trim(),
      options,
      type: type === "poll" ? "POLL" : "QUIZ",
      isAnonymous: isAnonymous ?? true,
      correctOptionId: type === "quiz" ? correctOptionId : null,
      explanation: explanation?.trim() || null,
      allowsMultiple: allowsMultiple ?? false,
      openPeriod: openPeriod || null,
      groupId: group.id,
      sentById: user.sub,
    },
  });

  return NextResponse.json({ ok: true, template });
}

// DELETE /api/templates/[id]
export async function DELETE(req: NextRequest) {
  const user = await getUser(req);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { searchParams } = req.nextUrl;
  const id = searchParams.get("id");
  if (!id) return NextResponse.json({ error: "ID required" }, { status: 400 });

  await prisma.quiz.deleteMany({
    where: { id, sentById: user.sub, groupId: { startsWith: "template:" } },
  });

  return NextResponse.json({ ok: true });
}
