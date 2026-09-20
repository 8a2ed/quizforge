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

async function getTemplateGroupId(userId: string): Promise<string | null> {
  const group = await withRetry(() =>
    prisma.group.findUnique({
      where: { chatId: `template:${userId}` },
      select: { id: true },
    })
  );
  return group?.id ?? null;
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
  const { question, options, type, isAnonymous, correctOptionId, explanation, allowsMultiple, openPeriod, tags, allowAddingOptions, allowRevoting } = body;

  const cleanQuestion = String(question || "").trim();
  if (!cleanQuestion) {
    return NextResponse.json({ error: "Question is required." }, { status: 400 });
  }
  if (cleanQuestion.length > 300) {
    return NextResponse.json({ error: "Question cannot exceed 300 characters." }, { status: 400 });
  }

  if (!Array.isArray(options) || options.length < 2) {
    return NextResponse.json({ error: "At least 2 options are required." }, { status: 400 });
  }
  if (options.length > 10) {
    return NextResponse.json({ error: "Maximum 10 options allowed." }, { status: 400 });
  }

  const cleanOptions: string[] = options.map((o: any) => String(o || "").trim());
  if (cleanOptions.some(o => !o)) {
    return NextResponse.json({ error: "Options cannot be empty." }, { status: 400 });
  }
  if (cleanOptions.some(o => o.length > 100)) {
    return NextResponse.json({ error: "Each option must be 100 characters or less." }, { status: 400 });
  }

  // Prevent duplicate options
  const lowerOptions = cleanOptions.map(o => o.toLowerCase());
  if (new Set(lowerOptions).size !== lowerOptions.length) {
    return NextResponse.json({ error: "Options must be unique (duplicate options detected)." }, { status: 400 });
  }

  const normalizedType = String(type || "").toUpperCase() === "POLL" ? "POLL" : "QUIZ";

  let validatedCorrectOptionId: number | null = null;
  let validatedExplanation: string | null = null;

  if (normalizedType === "QUIZ") {
    const cid = Number(correctOptionId);
    if (isNaN(cid) || cid < 0 || cid >= cleanOptions.length) {
      return NextResponse.json({ error: "A valid correct option must be selected for quiz." }, { status: 400 });
    }
    validatedCorrectOptionId = cid;

    if (explanation) {
      const exp = String(explanation).trim();
      if (exp.length > 200) {
        return NextResponse.json({ error: "Explanation cannot exceed 200 characters." }, { status: 400 });
      }
      validatedExplanation = exp || null;
    }
  }

  let validatedOpenPeriod: number | null = null;
  if (openPeriod) {
    const op = Number(openPeriod);
    if (!isNaN(op) && op >= 5 && op <= 600) {
      validatedOpenPeriod = op;
    }
  }

  const sanitizedTags = Array.isArray(tags)
    ? tags
        .map((t: any) => String(t || "").trim())
        .filter(Boolean)
        .slice(0, 20)
    : [];

  // Resolve real DB groupId
  const groupId = await getTemplateGroupId(user.sub);
  if (!groupId) return NextResponse.json({ error: "Library not found" }, { status: 404 });

  const updated = await withRetry(() =>
    prisma.quiz.updateMany({
      where: { id, sentById: user.sub, groupId },
      data: {
        question: cleanQuestion,
        options: cleanOptions,
        type: normalizedType,
        isAnonymous: isAnonymous ?? true,
        correctOptionId: validatedCorrectOptionId,
        explanation: validatedExplanation,
        allowsMultiple: normalizedType === "POLL" ? Boolean(allowsMultiple) : false,
        allowAddingOptions: normalizedType === "POLL" ? Boolean(allowAddingOptions) : false,
        allowRevoting: normalizedType === "POLL" ? Boolean(allowRevoting) : false,
        openPeriod: validatedOpenPeriod,
        tags: sanitizedTags,
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

  const groupId = await getTemplateGroupId(user.sub);
  if (!groupId) return NextResponse.json({ error: "Library not found" }, { status: 404 });

  const deleted = await withRetry(() =>
    prisma.quiz.deleteMany({ where: { id, sentById: user.sub, groupId } })
  );

  if (deleted.count === 0) {
    return NextResponse.json({ error: "Template not found" }, { status: 404 });
  }

  return NextResponse.json({ ok: true });
}
