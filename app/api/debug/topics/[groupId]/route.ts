import { NextRequest, NextResponse } from "next/server";
import { jwtVerify } from "jose";
import { prisma } from "@/lib/db";
import { telegram } from "@/lib/telegram";

const JWT_SECRET = new TextEncoder().encode(process.env.AUTH_SECRET || "secret");

// GET /api/debug/topics/[id]
// id can be: DB group ID (cuid), Telegram chat ID (+/- prefix), or "all"
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ groupId: string }> }
) {
  const { groupId: rawId } = await params;
  const token = req.cookies.get("qf_session")?.value;
  if (!token) return NextResponse.json({ error: "Unauthorized — log in first" }, { status: 401 });

  try {
    await jwtVerify(token, JWT_SECRET);
  } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Try to find the group flexibly:
  // 1. Direct DB id match
  // 2. Telegram chatId match (with/without -100 prefix)
  const possibleChatIds = [
    rawId,
    `-${rawId}`,
    `-100${rawId}`,
    rawId.replace(/^-100/, "").replace(/^-/, ""),
  ];

  let group = await prisma.group.findFirst({
    where: {
      OR: [
        { id: rawId },
        { chatId: { in: possibleChatIds } },
      ],
    },
  });

  // If "all" — show all groups summary
  if (rawId === "all") {
    const allGroups = await prisma.group.findMany();
    return NextResponse.json({ groups: allGroups.map(g => ({ id: g.id, chatId: g.chatId, title: g.title, isForum: g.isForum })) });
  }

  if (!group) {
    const allGroups = await prisma.group.findMany({ select: { id: true, chatId: true, title: true } });
    return NextResponse.json({
      error: `Group not found for id="${rawId}"`,
      hint: "Use one of the group IDs or chatIds below in the URL",
      availableGroups: allGroups,
    }, { status: 404 });
  }

  const results: Record<string, unknown> = {
    group: { id: group.id, chatId: group.chatId, title: group.title, isForum: group.isForum },
    botToken: process.env.TELEGRAM_BOT_TOKEN ? `SET (ends in ...${process.env.TELEGRAM_BOT_TOKEN.slice(-6)})` : "⚠ MISSING",
  };

  // Test 1: getMe
  try {
    const me = await telegram.getMe();
    results.getMe = { ok: true, username: `@${me.username}`, id: me.id };
  } catch (e: unknown) {
    results.getMe = { ok: false, error: String(e) };
  }

  // Test 2: getChat
  try {
    const chat = await telegram.getChat(group.chatId);
    results.getChat = { ok: true, is_forum: chat.is_forum, type: chat.type, title: chat.title };
  } catch (e: unknown) {
    results.getChat = { ok: false, error: String(e) };
  }

  // Test 3: Bot membership status
  try {
    const me = await telegram.getMe();
    const member = await telegram.getChatMember(group.chatId, me.id);
    const m = member as unknown as Record<string, unknown>;
    results.botMembership = {
      ok: true,
      status: member.status,
      can_manage_chat: m.can_manage_chat,
      can_manage_topics: m.can_manage_topics,
    };
  } catch (e: unknown) {
    results.botMembership = { ok: false, error: String(e) };
  }

  // Test 4: getForumTopics (with @username fallback)
  try {
    let topicsResult: { topics: TelegramForumTopic[] } | null = null;
    let usedIdentifier = group.chatId;
    try {
      topicsResult = await telegram.getForumTopics(group.chatId);
    } catch {
      // Try @username
      const chatForUsername = await telegram.getChat(group.chatId);
      if (chatForUsername.username) {
        usedIdentifier = `@${chatForUsername.username}`;
        topicsResult = await telegram.getForumTopics(usedIdentifier);
      } else throw new Error("No username available");
    }
    const list = topicsResult?.topics || [];
    results.getForumTopics = {
      ok: true,
      usedIdentifier,
      count: list.length,
      topics: list.map((t: TelegramForumTopic) => ({ id: t.message_thread_id, name: t.name, closed: t.is_closed })),
    };
  } catch (e: unknown) {
    results.getForumTopics = {
      ok: false,
      error: String(e),
      fix: "Telegram returned 'Not Found' — numeric chatId and @username both failed",
    };
  }

  // Test 5: DB cache
  const cached = await prisma.topic.findMany({ where: { groupId: group.id } });
  results.cachedTopics = {
    count: cached.length,
    topics: cached.map(t => ({ id: t.topicId, name: t.name })),
  };

  return NextResponse.json(results, {
    headers: { "Content-Type": "application/json" },
  });
}
