import { NextRequest, NextResponse } from "next/server";
import { jwtVerify } from "jose";
import { prisma } from "@/lib/db";
import { telegram } from "@/lib/telegram";

const JWT_SECRET = new TextEncoder().encode(process.env.AUTH_SECRET || "secret");

// GET /api/debug/topics/[groupId] — diagnose topics issues
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ groupId: string }> }
) {
  const { groupId } = await params;
  const token = req.cookies.get("qf_session")?.value;
  if (!token) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    await jwtVerify(token, JWT_SECRET);

    const group = await prisma.group.findUnique({ where: { id: groupId } });
    if (!group) return NextResponse.json({ error: "Group not found" }, { status: 404 });

    const results: Record<string, unknown> = {
      group: {
        chatId: group.chatId,
        title: group.title,
        isForum: group.isForum,
      },
      botToken: process.env.TELEGRAM_BOT_TOKEN ? "SET (masked)" : "MISSING!",
    };

    // Test 1: getChat
    try {
      const chat = await telegram.getChat(group.chatId);
      results.getChat = { ok: true, is_forum: chat.is_forum, type: chat.type };
    } catch (e: unknown) {
      results.getChat = { ok: false, error: String(e) };
    }

    // Test 2: getMe
    try {
      const me = await telegram.getMe();
      results.getMe = { ok: true, username: me.username, id: me.id };
    } catch (e: unknown) {
      results.getMe = { ok: false, error: String(e) };
    }

    // Test 3: getChatMember (bot's own status)
    try {
      const me = await telegram.getMe();
      const member = await telegram.getChatMember(group.chatId, me.id);
      results.botMembership = {
        ok: true,
        status: member.status,
        can_manage_chat: member.can_manage_chat,
        can_post_messages: member.can_post_messages,
      };
    } catch (e: unknown) {
      results.botMembership = { ok: false, error: String(e) };
    }

    // Test 4: getForumTopics
    try {
      const topics = await telegram.getForumTopics(group.chatId);
      results.getForumTopics = { ok: true, count: topics.topics?.length, sample: topics.topics?.slice(0, 3) };
    } catch (e: unknown) {
      results.getForumTopics = { ok: false, error: String(e) };
    }

    // Test 5: Cached topics in DB
    const cached = await prisma.topic.findMany({ where: { groupId } });
    results.cachedTopics = { count: cached.length, topics: cached.slice(0, 5) };

    return NextResponse.json(results, { headers: { "Content-Type": "application/json" } });
  } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
}
