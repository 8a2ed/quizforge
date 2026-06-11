import { NextRequest, NextResponse } from "next/server";
import { jwtVerify } from "jose";
import { prisma, withRetry } from "@/lib/db";
import { telegram } from "@/lib/telegram";

const JWT_SECRET = new TextEncoder().encode(process.env.AUTH_SECRET || "secret");

async function getUser(req: NextRequest) {
  const token = req.cookies.get("qf_session")?.value;
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, JWT_SECRET);
    return payload as { sub: string };
  } catch { return null; }
}

// GET /api/groups/[groupId]/messages — list sent messages + group members
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ groupId: string }> }
) {
  const { groupId } = await params;
  const user = await getUser(req);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const membership = await withRetry(() =>
    prisma.groupMember.findUnique({ where: { userId_groupId: { userId: user.sub, groupId } } })
  );
  if (!membership) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  // Get users who have answered polls in this group (have a telegramId)
  const answerers = await withRetry(() =>
    prisma.pollAnswer.findMany({
      where: { quiz: { groupId } },
      select: {
        telegramUserId: true,
        firstName: true,
        username: true,
      },
      distinct: ["telegramUserId"],
      orderBy: { answeredAt: "desc" },
      take: 200,
    })
  );

  // Also get registered users who are members
  const members = await withRetry(() =>
    prisma.groupMember.findMany({
      where: { groupId },
      include: { user: { select: { telegramId: true, firstName: true, username: true, photoUrl: true } } },
    })
  );

  const memberContacts = members
    .filter(m => m.user.telegramId)
    .map(m => ({
      telegramId: m.user.telegramId!,
      firstName: m.user.firstName,
      username: m.user.username,
      photoUrl: m.user.photoUrl,
      source: "admin" as const,
    }));

  const answererContacts = answerers.map(a => ({
    telegramId: a.telegramUserId,
    firstName: a.firstName || "Unknown",
    username: a.username,
    photoUrl: null,
    source: "respondent" as const,
  }));

  // Merge, deduplicate by telegramId (prefer admin entries)
  const seen = new Set<string>();
  const contacts = [];
  for (const c of [...memberContacts, ...answererContacts]) {
    if (!seen.has(c.telegramId)) {
      seen.add(c.telegramId);
      contacts.push(c);
    }
  }

  return NextResponse.json({ contacts, total: contacts.length });
}

// POST /api/groups/[groupId]/messages — send a message to one or more users
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ groupId: string }> }
) {
  const { groupId } = await params;
  const user = await getUser(req);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const membership = await withRetry(() =>
    prisma.groupMember.findUnique({ where: { userId_groupId: { userId: user.sub, groupId } } })
  );
  if (!membership) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const body = await req.json() as {
    recipients: string[];       // telegramIds
    type: "text" | "photo" | "document" | "audio" | "video" | "poll";
    text?: string;
    parseMode?: "HTML" | "Markdown";
    mediaUrl?: string;
    caption?: string;
    buttons?: { text: string; url?: string; callback?: string }[][];
    // poll fields
    pollQuestion?: string;
    pollOptions?: string[];
    pollAnonymous?: boolean;
    // broadcast delay
    delayMs?: number;
  };

  if (!body.recipients?.length) return NextResponse.json({ error: "No recipients" }, { status: 400 });

  const results: { telegramId: string; ok: boolean; error?: string }[] = [];
  const delayMs = Math.max(300, Math.min(body.delayMs || 800, 3000));

  for (let i = 0; i < body.recipients.length; i++) {
    const chatId = body.recipients[i];
    try {
      const reply_markup = body.buttons?.length
        ? { inline_keyboard: body.buttons.map(row => row.map(btn => btn.url ? { text: btn.text, url: btn.url } : { text: btn.text, callback_data: btn.callback || btn.text })) }
        : undefined;

      if (body.type === "text") {
        await telegram.sendMessage({
          chat_id: chatId,
          text: body.text || "",
          parse_mode: body.parseMode || "HTML",
          ...(reply_markup ? { reply_markup } : {}),
        });
      } else if (body.type === "photo") {
        await telegram.sendPhoto({
          chat_id: chatId,
          photo: body.mediaUrl!,
          caption: body.caption,
          parse_mode: body.parseMode || "HTML",
        });
        if (reply_markup) {
          await telegram.sendMessage({ chat_id: chatId, text: "​", reply_markup }); // zero-width space
        }
      } else if (body.type === "document" || body.type === "audio" || body.type === "video") {
        await telegram.sendFile({
          chat_id: chatId,
          fileType: body.type,
          fileUrl: body.mediaUrl!,
          caption: body.caption,
          parse_mode: body.parseMode || "HTML",
          ...(reply_markup ? { reply_markup } : {}),
        });
      } else if (body.type === "poll") {
        await telegram.sendPoll({
          chat_id: chatId,
          question: body.pollQuestion || "Question",
          options: (body.pollOptions || []).map(o => ({ text: o })),
          is_anonymous: body.pollAnonymous ?? true,
        });
      }

      results.push({ telegramId: chatId, ok: true });
    } catch (err) {
      results.push({ telegramId: chatId, ok: false, error: err instanceof Error ? err.message : "Unknown error" });
    }

    // Rate-limit delay between sends (except after last)
    if (i < body.recipients.length - 1) {
      await new Promise(r => setTimeout(r, delayMs));
    }
  }

  const sent = results.filter(r => r.ok).length;
  const failed = results.filter(r => !r.ok).length;

  return NextResponse.json({ ok: true, sent, failed, results });
}
