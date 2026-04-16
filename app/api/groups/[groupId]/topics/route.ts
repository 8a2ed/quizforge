import { NextRequest, NextResponse } from "next/server";
import { jwtVerify } from "jose";
import { prisma, withRetry } from "@/lib/db";
import { telegram, type TelegramForumTopic } from "@/lib/telegram";

const JWT_SECRET = new TextEncoder().encode(process.env.AUTH_SECRET || "secret");

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ groupId: string }> }
) {
  const { groupId } = await params;
  const token = req.cookies.get("qf_session")?.value;
  if (!token) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const { payload } = await jwtVerify(token, JWT_SECRET);
    const userId = (payload as { sub: string }).sub;

    const membership = await withRetry(() => prisma.groupMember.findUnique({
      where: { userId_groupId: { userId, groupId } },
      include: { group: true },
    }));
    if (!membership) return NextResponse.json({ error: "Not a member" }, { status: 403 });

    const group = membership.group;
    let topics: TelegramForumTopic[] = [];
    let fetchedFromTelegram = false;

    // Always attempt to fetch from Telegram regardless of the isForum DB flag.
    // The flag may be stale (set to false during dev-mode group import).
    try {
      const result = await telegram.getForumTopics(group.chatId);
      topics = result.topics || [];
      fetchedFromTelegram = true;

      // If we got topics, the group IS a forum — update the flag if it was wrong
      if (topics.length > 0 && !group.isForum) {
        await withRetry(() => prisma.group.update({
          where: { id: groupId },
          data: { isForum: true },
        }));
      }

      // Cache topics in DB
      if (topics.length > 0) {
        await Promise.all(
          topics.map((t) =>
            withRetry(() => prisma.topic.upsert({
              where: { groupId_topicId: { groupId, topicId: t.message_thread_id } },
              update: { name: t.name, iconColor: t.icon_color, isClosed: t.is_closed || false },
              create: {
                groupId,
                topicId: t.message_thread_id,
                name: t.name,
                iconColor: t.icon_color,
                iconCustomEmojiId: t.icon_custom_emoji_id || null,
                isClosed: t.is_closed || false,
              },
            }))
          )
        );
      }
    } catch (telegramErr: any) {
      // Telegram says it's not a forum group, or bot doesn't have rights
      const msg = telegramErr?.message || "";
      
      // If the error explicitly says not a forum, fall through to cached topics
      // If it's a bot access error, return helpful message
      if (msg.includes("not a supergroup") || msg.includes("PEER_ID_INVALID")) {
        return NextResponse.json({ topics: [], warning: "Group not accessible by bot" });
      }

      // Fall back to DB-cached topics from previous successful fetches
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

    return NextResponse.json({ topics, fromCache: !fetchedFromTelegram });
  } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
}
