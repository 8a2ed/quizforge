import { getAuthSecret } from "@/lib/auth";
import { NextRequest, NextResponse } from "next/server";
import { jwtVerify } from "jose";
import { prisma } from "@/lib/db";
import { telegram } from "@/lib/telegram";

const JWT_SECRET = getAuthSecret();

// GET /api/debug/topics/[id]
// id can be: DB group ID (cuid), Telegram chat ID (+/- prefix), or "all"
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ groupId: string }> }
) {
  if (process.env.NODE_ENV === "production") {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const { groupId: rawId } = await params;
  const token = req.cookies.get("qf_session")?.value;
  if (!token) return NextResponse.json({ error: "Unauthorized — log in first" }, { status: 401 });

  let userId: string;
  try {
    const { payload } = await jwtVerify(token, JWT_SECRET);
    if (typeof payload.sub !== "string") throw new Error("Missing subject");
    userId = payload.sub;
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

  const group = await prisma.group.findFirst({
    where: {
      OR: [
        { id: rawId },
        { chatId: { in: possibleChatIds } },
      ],
    },
  });

  // If "all" — show all groups summary
  if (rawId === "all") {
    const memberships = await prisma.groupMember.findMany({
      where: { userId, approved: true, role: { in: ["OWNER", "ADMIN"] } },
      include: { group: { select: { id: true, chatId: true, title: true, isForum: true } } },
    });
    return NextResponse.json({ groups: memberships.map(({ group }) => group) });
  }

  if (!group) {
    return NextResponse.json({
      error: `Group not found for id="${rawId}"`,
    }, { status: 404 });
  }

  const membership = await prisma.groupMember.findUnique({
    where: { userId_groupId: { userId, groupId: group.id } },
    select: { role: true, approved: true },
  });
  if (!membership?.approved || (membership.role !== "OWNER" && membership.role !== "ADMIN")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const results: Record<string, unknown> = {
    group: { id: group.id, chatId: group.chatId, title: group.title, isForum: group.isForum },
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

  // Test 4: Forum topic capabilities info
  results.telegramForumCapabilities = {
    supportedMethods: [
      "createForumTopic",
      "editForumTopic",
      "closeForumTopic",
      "reopenForumTopic",
      "deleteForumTopic",
      "unpinAllForumTopicMessages"
    ],
    getForumTopicsNativeApi: "Not provided by Telegram HTTP Bot API — QuizForge manages topics via createForumTopic & webhook events",
  };

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
