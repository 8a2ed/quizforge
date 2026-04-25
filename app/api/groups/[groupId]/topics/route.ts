import { NextRequest, NextResponse } from "next/server";
import { jwtVerify } from "jose";
import { prisma, withRetry } from "@/lib/db";
import { telegram, type TelegramForumTopic } from "@/lib/telegram";

const JWT_SECRET = new TextEncoder().encode(process.env.AUTH_SECRET || "secret");

interface ForumTopicsResult {
  topics: TelegramForumTopic[];
  via: string;
}

// Try getForumTopics with numeric ID, then @username fallback
async function tryGetForumTopics(chatId: string): Promise<ForumTopicsResult | null> {
  // Attempt 1: numeric chatId
  try {
    const r = await telegram.getForumTopics(chatId);
    return { topics: r.topics || [], via: chatId };
  } catch { /* fall through to username */ }

  // Attempt 2: @username
  try {
    const chat = await telegram.getChat(chatId);
    if (chat.username) {
      const r = await telegram.getForumTopics(`@${chat.username}`);
      return { topics: r.topics || [], via: `@${chat.username}` };
    }
  } catch { /* fall through */ }

  return null;
}

async function getAuth(req: NextRequest, groupId: string) {
  const token = req.cookies.get("qf_session")?.value;
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, JWT_SECRET);
    const userId = (payload as { sub: string }).sub;
    const membership = await withRetry(() =>
      prisma.groupMember.findUnique({
        where: { userId_groupId: { userId, groupId } },
        include: { group: true },
      })
    );
    return membership || null;
  } catch {
    return null;
  }
}

// GET — fetch topics (Telegram live → @username → DB cache)
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ groupId: string }> }
) {
  const { groupId } = await params;
  const membership = await getAuth(req, groupId);
  if (!membership) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const group = membership.group;
  let topics: TelegramForumTopic[] = [];
  let fetchedFromTelegram = false;
  let telegramError: string | null = null;

  const result = await tryGetForumTopics(group.chatId);

  if (result) {
    topics = result.topics;
    fetchedFromTelegram = true;

    if (topics.length > 0 && !group.isForum) {
      await withRetry(() =>
        prisma.group.update({ where: { id: groupId }, data: { isForum: true } })
      );
    }

    await Promise.all(
      topics.map((t) =>
        withRetry(() =>
          prisma.topic.upsert({
            where: { groupId_topicId: { groupId, topicId: t.message_thread_id } },
            update: { name: t.name, iconColor: t.icon_color, isClosed: t.is_closed ?? false },
            create: {
              groupId,
              topicId: t.message_thread_id,
              name: t.name,
              iconColor: t.icon_color,
              iconCustomEmojiId: t.icon_custom_emoji_id ?? null,
              isClosed: t.is_closed ?? false,
            },
          })
        )
      )
    );
  } else {
    telegramError =
      "Telegram API returned Not Found for getForumTopics on this group — add topics manually";

    const cached = await withRetry(() =>
      prisma.topic.findMany({ where: { groupId }, orderBy: { topicId: "asc" } })
    );
    topics = cached.map((t) => ({
      message_thread_id: t.topicId,
      name: t.name,
      icon_color: t.iconColor ?? 0,
      is_closed: t.isClosed,
    }));
  }

  return NextResponse.json({ topics, fromCache: !fetchedFromTelegram, telegramError });
}

// POST — manually add a topic
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ groupId: string }> }
) {
  const { groupId } = await params;
  const membership = await getAuth(req, groupId);
  if (!membership) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json();
  const topicId = Number(body.topicId);
  const name = String(body.name || "").trim();

  if (!topicId || !name) {
    return NextResponse.json({ error: "topicId and name are required" }, { status: 400 });
  }

  const topic = await withRetry(() =>
    prisma.topic.upsert({
      where: { groupId_topicId: { groupId, topicId } },
      update: { name },
      create: { groupId, topicId, name, iconColor: 0, isClosed: false },
    })
  );

  return NextResponse.json({
    ok: true,
    topic: { message_thread_id: topic.topicId, name: topic.name },
  });
}

// DELETE — remove a topic from QuizForge (not from Telegram)
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ groupId: string }> }
) {
  const { groupId } = await params;
  const membership = await getAuth(req, groupId);
  if (!membership) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json();
  await withRetry(() =>
    prisma.topic.deleteMany({ where: { groupId, topicId: Number(body.topicId) } })
  );
  return NextResponse.json({ ok: true });
}
