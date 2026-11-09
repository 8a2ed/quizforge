import { getErrorMessage } from "@/lib/errors";
import { readJsonObject } from "@/lib/http";
import { getAuthSecret } from "@/lib/auth";
import { NextRequest, NextResponse } from "next/server";
import { jwtVerify } from "jose";
import { prisma, withRetry } from "@/lib/db";
import { telegram } from "@/lib/telegram";
import { generateWebhookSecret } from "@/lib/crypto";

const JWT_SECRET = getAuthSecret();
const IS_DEV = process.env.NODE_ENV === "development";

async function getUserFromRequest(req: NextRequest) {
  const token = req.cookies.get("qf_session")?.value;
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, JWT_SECRET);
    return payload as { sub: string; telegramId: string };
  } catch {
    return null;
  }
}

// GET /api/groups — list user's groups
export async function GET(req: NextRequest) {
  const user = await getUserFromRequest(req);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const memberships = await withRetry(() => prisma.groupMember.findMany({
    where: { userId: user.sub, approved: true },
    include: {
      group: {
        include: {
          _count: { select: { quizzes: true } },
        },
      },
    },
    orderBy: { joinedAt: "desc" },
  }));

  return NextResponse.json({
    groups: memberships
      .filter((m) => !m.group.chatId.startsWith("template:"))
      .map((m) => ({
        ...m.group,
        role: m.role,
        quizCount: m.group._count.quizzes,
      })),
  });
}

// POST /api/groups — add a new group
export async function POST(req: NextRequest) {
  const user = await getUserFromRequest(req);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await readJsonObject(req);
  if (!body) return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  const rawChatId = body.chatId;
  const chatId = typeof rawChatId === "string"
    ? rawChatId.trim()
    : typeof rawChatId === "number" && Number.isSafeInteger(rawChatId)
    ? String(rawChatId)
    : "";
  if (!chatId || (!/^-?\d+$/.test(chatId) && !/^@[A-Za-z0-9_]{5,32}$/.test(chatId))) {
    return NextResponse.json({ error: "A valid Telegram chat ID or public group username is required" }, { status: 400 });
  }

  // ─── Step 1: Verify bot can access the chat ───────────────────────────────
  let chat: { title?: string; username?: string; is_forum?: boolean } | undefined;
  try {
    chat = await telegram.getChat(chatId);
  } catch (err: unknown) {
    const msg = getErrorMessage(err, "");
    // Give specific diagnostics
    if (msg.includes("chat not found") || msg.includes("Bad Request")) {
      return NextResponse.json({
        error: `Chat ID "${chatId}" not found. Double-check the ID (it should be negative for groups, e.g. -1001234567890).`,
      }, { status: 400 });
    }
    if (IS_DEV) {
      // In dev mode: if the bot isn't in the group yet, still allow adding it
      // so you can register the group and send quizzes once you add the bot
      console.warn(`[Dev] Could not reach chat ${chatId}: ${msg}. Proceeding in dev mode.`);
    } else {
      return NextResponse.json({
        error: `Could not reach this group. Make sure @${process.env.NEXT_PUBLIC_BOT_USERNAME || "agridmu_bot"} is added as an admin to your group first, then try again.`,
      }, { status: 400 });
    }
  }

  // ─── Step 2: Verify the user is an admin in this group ───────────────────
  let memberRole: "OWNER" | "ADMIN" = "ADMIN";
  let memberVerified = false;

  try {
    const telegramUserId = Number(user.telegramId);
    if (!Number.isSafeInteger(telegramUserId) || telegramUserId <= 0) {
      return NextResponse.json({ error: "Your account is not linked to a Telegram user" }, { status: 403 });
    }
    const member = await telegram.getChatMember(chatId, telegramUserId);
    if (!["creator", "administrator"].includes(member.status)) {
      return NextResponse.json({
        error: "You must be an admin or owner of this group to add it.",
      }, { status: 403 });
    }
    memberRole = member.status === "creator" ? "OWNER" : "ADMIN";
    memberVerified = true;
  } catch {
    if (IS_DEV) {
      // In dev: if bot isn't in group, getChatMember fails.
      // Default to OWNER role so you can still manage the group in dev.
      console.warn(`[Dev] Could not verify admin status for user ${user.telegramId}. Defaulting to OWNER in dev mode.`);
      memberRole = "OWNER";
      memberVerified = false;
    } else {
      return NextResponse.json({
        error: `Could not verify your admin status. Make sure @${process.env.NEXT_PUBLIC_BOT_USERNAME || "agridmu_bot"} is in the group and you are an admin.`,
      }, { status: 400 });
    }
  }

  // ─── Step 3: Save group to DB ─────────────────────────────────────────────
  let group = await withRetry(() => prisma.group.findUnique({ where: { chatId: String(chatId) } }));

  if (!group) {
    group = await withRetry(() => prisma.group.create({
      data: {
        chatId: String(chatId),
        title: chat?.title || `Group ${chatId}`,
        username: chat?.username || null,
        isForum: chat?.is_forum || false,
        botConfig: {
          create: {
            webhookSecret: generateWebhookSecret(),
          },
        },
      },
    }));

    // Set webhook only on production (not localhost)
    const webhookUrl = `${process.env.WEBHOOK_BASE_URL}/api/webhook`;
    const isLocalhost = webhookUrl.includes("localhost") || webhookUrl.includes("127.0.0.1") || webhookUrl.includes("192.168.");
    if (!isLocalhost) {
      const config = await withRetry(() => prisma.botConfig.findUnique({ where: { groupId: group!.id } }));
      if (config) {
        await telegram.setWebhook(webhookUrl, config.webhookSecret).catch(console.error);
      }
    } else {
      console.log("[Dev] Webhook registration skipped on localhost. Use sendPoll directly to send quizzes.");
    }
  }

  // ─── Step 4: Add user as member ───────────────────────────────────────────
  await withRetry(() => prisma.groupMember.upsert({
    where: { userId_groupId: { userId: user.sub, groupId: group!.id } },
    update: { role: memberRole, approved: true },
    create: { userId: user.sub, groupId: group!.id, role: memberRole, approved: true },
  }));

  const devWarning = IS_DEV && !memberVerified
    ? "⚠️ Dev mode: Added group without full bot verification. Add @agridmu_bot as admin to this group in Telegram to enable quiz sending."
    : null;

  return NextResponse.json({ ok: true, group, devWarning });
}
