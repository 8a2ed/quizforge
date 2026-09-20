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
      where: { groupId },
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
        allowAddingOptions: true,
        allowRevoting: true,
        openPeriod: true,
        tags: true,
        topicId: true,
        topicName: true,
        createdAt: true,
        collections: { select: { collectionId: true } },
      },
    })
  );

  return NextResponse.json({
    templates: templates.map(t => ({
      ...t,
      collectionIds: t.collections.map(c => c.collectionId),
      collections: undefined,
    })),
  });
}

// POST /api/templates — save a template
export async function POST(req: NextRequest) {
  const user = await getUser(req);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

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

  // Prevent duplicate options (causes Telegram poll rejection)
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

  // Telegram open_period must be between 5 and 600 seconds if set
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

  const groupId = await ensureTemplateGroup(user.sub);

  const template = await withRetry(() =>
    prisma.quiz.create({
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
        groupId,
        sentById: user.sub,
      },
    })
  );

  return NextResponse.json({
    ok: true,
    template: {
      ...template,
      collectionIds: [],
    },
  });
}

// DELETE /api/templates — delete by ?id=... or batch by body { ids: string[] }
export async function DELETE(req: NextRequest) {
  const user = await getUser(req);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const groupId = await getTemplateGroupId(user.sub);
  if (!groupId) return NextResponse.json({ error: "No library found" }, { status: 404 });

  let ids: string[] = [];
  const { searchParams } = req.nextUrl;
  const queryId = searchParams.get("id");

  if (queryId) {
    ids.push(queryId);
  } else {
    try {
      const body = await req.json();
      if (Array.isArray(body?.ids)) {
        ids = body.ids.filter((id: any) => typeof id === "string" && id.trim().length > 0);
      }
    } catch {
      // Body might be empty or not JSON
    }
  }

  if (ids.length === 0) {
    return NextResponse.json({ error: "ID(s) required" }, { status: 400 });
  }

  const result = await withRetry(() =>
    prisma.quiz.deleteMany({
      where: {
        id: { in: ids },
        sentById: user.sub,
        groupId,
      },
    })
  );

  return NextResponse.json({ ok: true, count: result.count });
}
