import { NextRequest, NextResponse } from "next/server";
import { jwtVerify } from "jose";
import { prisma, withRetry } from "@/lib/db";
import { telegram, type TelegramForumTopic } from "@/lib/telegram";

const JWT_SECRET = new TextEncoder().encode(process.env.AUTH_SECRET || "secret");

async function getAuth(req: NextRequest, groupId: string) {
  const token = req.cookies.get("qf_session")?.value;
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, JWT_SECRET);
    const userId = (payload as { sub: string }).sub;
    const membership = await withRetry(() => prisma.groupMember.findUnique({
      where: { userId_groupId: { userId, groupId } },
      include: { group: true },
    }));
    return membership || null;
  } catch { return null; }
}

// GET — fetch topics (live from Telegram, fall back to DB cache)
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

  // Always attempt to fetch live from Telegram first
  try {
    const result = await telegram.getForumTopics(group.chatId);
    topics = result.topics || [];
    fetchedFromTelegram = true;

    // Update isForum flag if stale
    if (topics.length > 0 && !group.isForum) {
      await withRetry(() => prisma.group.update({ where: { id: groupId }, data: { isForum: true } }));
    }

    // Cache/sync all topics in DB
    if (topics.length > 0) {
      await Promise.all(
        topics.map((t) => withRetry(() => prisma.topic.upsert({
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
        }))
      ));
    }
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    telegramError = msg;
    console.warn(`[Topics] Telegram fetch failed for group ${groupId}:`, msg);

    // Fall back to DB cache
    const cached = await withRetry(() => prisma.topic.findMany({
      where: { groupId },
      orderBy: { topicId: "asc" },
    }));
    topics = cached.map((t) => ({
      message_thread_id: t.topicId,
      name: t.name,
      icon_color: t.iconColor ?? 0,
      is_closed: t.isClosed,
    }));
  }

  return NextResponse.json({ topics, fromCache: !fetchedFromTelegram, telegramError });
}

// POST — manually add/import a topic by ID (fallback when bot can't fetch automatically)
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ groupId: string }> }
) {
  const { groupId } = await params;
  const membership = await getAuth(req, groupId);
  if (!membership) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { topicId, name } = await req.json();
  if (!topicId || !name?.trim()) {
    return NextResponse.json({ error: "topicId and name are required" }, { status: 400 });
  }

  const topic = await withRetry(() => prisma.topic.upsert({
    where: { groupId_topicId: { groupId, topicId: Number(topicId) } },
    update: { name: name.trim() },
    create: {
      groupId,
      topicId: Number(topicId),
      name: name.trim(),
      iconColor: 0,
      isClosed: false,
    },
  }));

  return NextResponse.json({
    ok: true,
    topic: { message_thread_id: topic.topicId, name: topic.name },
  });
}

// DELETE — remove a manually-added topic
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ groupId: string }> }
) {
  const { groupId } = await params;
  const membership = await getAuth(req, groupId);
  if (!membership) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { topicId } = await req.json();
  await withRetry(() => prisma.topic.deleteMany({
    where: { groupId, topicId: Number(topicId) },
  }));

  return NextResponse.json({ ok: true });
}
