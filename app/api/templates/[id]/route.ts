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

// PATCH /api/templates/[id] — update a template
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getUser(req);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const body = await req.json();
  const { question, options, type, isAnonymous, correctOptionId, explanation, allowsMultiple, openPeriod, tags } = body;

  if (!question?.trim() || !options?.length) {
    return NextResponse.json({ error: "Question and options required" }, { status: 400 });
  }

  const updated = await withRetry(() =>
    prisma.quiz.updateMany({
      where: { id, sentById: user.sub, groupId: { startsWith: "template:" } },
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
      },
    })
  );

  if (updated.count === 0) {
    return NextResponse.json({ error: "Template not found" }, { status: 404 });
  }

  return NextResponse.json({ ok: true });
}

// DELETE /api/templates/[id] — delete a single template
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getUser(req);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;

  const deleted = await withRetry(() =>
    prisma.quiz.deleteMany({
      where: { id, sentById: user.sub, groupId: { startsWith: "template:" } },
    })
  );

  if (deleted.count === 0) {
    return NextResponse.json({ error: "Template not found" }, { status: 404 });
  }

  return NextResponse.json({ ok: true });
}
