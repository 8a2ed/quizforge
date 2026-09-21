import { NextRequest, NextResponse } from "next/server";
import { jwtVerify } from "jose";
import { prisma, withRetry } from "@/lib/db";
import { telegram, STANDARD_FORUM_TOPICS, type TelegramForumTopic } from "@/lib/telegram";

const JWT_SECRET = new TextEncoder().encode(process.env.AUTH_SECRET || "secret");

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

// GET — fetch topics from DB & sync Telegram status (NO aggressive historical resurrection)
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ groupId: string }> }
) {
  const { groupId } = await params;
  const membership = await getAuth(req, groupId);
  if (!membership) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const group = membership.group;
  const shouldAutoCreate = req.nextUrl.searchParams.get("autoCreate") === "true";

  let isForum = group.isForum;
  let canManageTopics = false;
  let forumWarning: string | null = null;
  let permissionWarning: string | null = null;
  let createdCount = 0;

  // 1. Verify chat status in Telegram
  try {
    const chat = await telegram.getChat(group.chatId);
    if (chat.is_forum !== undefined && chat.is_forum !== group.isForum) {
      isForum = Boolean(chat.is_forum);
      await withRetry(() =>
        prisma.group.update({ where: { id: groupId }, data: { isForum } })
      );
    } else if (chat.is_forum) {
      isForum = true;
    }
  } catch (e) {
    console.warn("[topics] getChat error:", e);
  }

  // 2. Check bot rights in the group
  try {
    const me = await telegram.getMe();
    const chatMember = await telegram.getChatMember(group.chatId, me.id);
    const isAdmin = chatMember.status === "creator" || chatMember.status === "administrator";
    const hasTopicRight = Boolean(
      chatMember.status === "creator" ||
      chatMember.can_manage_topics ||
      (chatMember as unknown as Record<string, unknown>).can_manage_chat
    );
    canManageTopics = isAdmin && hasTopicRight;

    if (!isForum) {
      forumWarning = "المجموعة غير مفعلة بنظام الموضوعات (Topics). لتفعيلها، افتح إعدادات المجموعة في تليجرام وقم بتفعيل خيار 'الموضوعات (Topics)'.";
    } else if (!canManageTopics) {
      permissionWarning = "البوت بحاجة إلى صلاحية 'إدارة الموضوعات' (Manage Topics) في المجموعة ليتمكن من إنشاء وتعديل التوبيكس تلقائياً. يرجى تفعيلها من صلاحيات المشرف للبوت.";
    }
  } catch (e) {
    console.warn("[topics] getChatMember error:", e);
  }

  // 3. Auto-create standard topics ONLY if explicitly requested via ?autoCreate=true
  if (shouldAutoCreate) {
    if (!isForum) {
      return NextResponse.json({
        ok: false,
        error: "FORUM_NOT_ENABLED",
        forumWarning,
        message: forumWarning || "المجموعة ليست مفعلة كنظام منتديات (Topics).",
      }, { status: 400 });
    }

    if (!canManageTopics) {
      return NextResponse.json({
        ok: false,
        error: "BOT_PERMISSION_DENIED",
        permissionWarning,
        message: permissionWarning || "البوت يحتاج إلى صلاحية 'إدارة الموضوعات' (Manage Topics).",
      }, { status: 403 });
    }

    const currentTopics = await withRetry(() =>
      prisma.topic.findMany({ where: { groupId } })
    );

    for (const std of STANDARD_FORUM_TOPICS) {
      const coreWord = std.name.replace(/[^\u0621-\u064A\w]/g, "").slice(0, 7);
      const exists = currentTopics.some(t => {
        const cleanExisting = t.name.replace(/[^\u0621-\u064A\w]/g, "");
        return cleanExisting.includes(coreWord) || coreWord.includes(cleanExisting);
      });

      if (!exists) {
        try {
          const created = await telegram.createForumTopic({
            chat_id: group.chatId,
            name: std.name,
            icon_color: std.icon_color,
          });

          await withRetry(() =>
            prisma.topic.upsert({
              where: { groupId_topicId: { groupId, topicId: created.message_thread_id } },
              update: { name: created.name, iconColor: created.icon_color },
              create: {
                groupId,
                topicId: created.message_thread_id,
                name: created.name,
                iconColor: created.icon_color,
                isClosed: false,
              },
            })
          );
          createdCount++;
        } catch (e) {
          console.error(`[topics] failed to create topic ${std.name}:`, e);
        }
      }
    }
  }

  // 4. Fetch topics strictly from the Topic table (respects deletions & edits)
  const dbTopics = await withRetry(() =>
    prisma.topic.findMany({
      where: { groupId },
      orderBy: { topicId: "asc" },
    })
  );

  const topics: TelegramForumTopic[] = dbTopics.map((t) => ({
    message_thread_id: t.topicId,
    name: t.name,
    icon_color: t.iconColor ?? 0,
    icon_custom_emoji_id: t.iconCustomEmojiId ?? undefined,
    is_closed: t.isClosed,
  }));

  return NextResponse.json({
    ok: true,
    topics,
    isForum,
    canManageTopics,
    createdCount,
    forumWarning,
    permissionWarning,
  });
}

// POST — create topic directly in Telegram, link existing by ID, or bulk import
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ groupId: string }> }
) {
  const { groupId } = await params;
  const membership = await getAuth(req, groupId);
  if (!membership) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const group = membership.group;
  const body = await req.json().catch(() => ({}));

  // Bulk import mode: Array<{ name: string; topicId: number; iconColor?: number }>
  if (Array.isArray(body.bulkTopics) && body.bulkTopics.length > 0) {
    const saved: Array<{ topicId: number; name: string }> = [];
    for (const item of body.bulkTopics) {
      const topicId = Number(item.topicId);
      const name = String(item.name || "").trim() || `Topic #${topicId}`;
      const iconColor = item.iconColor ? Number(item.iconColor) : 7322096;

      if (topicId && !isNaN(topicId) && topicId > 0) {
        const row = await withRetry(() =>
          prisma.topic.upsert({
            where: { groupId_topicId: { groupId, topicId } },
            update: { name, iconColor },
            create: { groupId, topicId, name, iconColor, isClosed: false },
          })
        );
        saved.push({ topicId: row.topicId, name: row.name });
      }
    }

    return NextResponse.json({ ok: true, count: saved.length, topics: saved });
  }

  const name = String(body.name || "").trim();
  const rawTopicId = body.topicId !== undefined && body.topicId !== "" ? Number(body.topicId) : null;
  const iconColor = body.iconColor ? Number(body.iconColor) : 7322096;
  const createInTelegram = body.createInTelegram !== false && !rawTopicId;

  if (!name && !rawTopicId) {
    return NextResponse.json({ error: "اسم الموضوع مطلوب" }, { status: 400 });
  }

  // Create directly in Telegram via Bot API
  if (createInTelegram) {
    if (!name) {
      return NextResponse.json({ error: "يرجى كتابة اسم الموضوع" }, { status: 400 });
    }

    try {
      const created = await telegram.createForumTopic({
        chat_id: group.chatId,
        name,
        icon_color: iconColor,
      });

      const topic = await withRetry(() =>
        prisma.topic.upsert({
          where: { groupId_topicId: { groupId, topicId: created.message_thread_id } },
          update: { name: created.name, iconColor: created.icon_color },
          create: {
            groupId,
            topicId: created.message_thread_id,
            name: created.name,
            iconColor: created.icon_color,
            iconCustomEmojiId: created.icon_custom_emoji_id ?? null,
            isClosed: false,
          },
        })
      );

      return NextResponse.json({
        ok: true,
        topic: { message_thread_id: topic.topicId, name: topic.name, icon_color: topic.iconColor },
        createdInTelegram: true,
      });
    } catch (err: unknown) {
      const errorMsg = (err as Error)?.message || "فشل إنشاء التوبيك في تليجرام";
      return NextResponse.json({ error: errorMsg }, { status: 400 });
    }
  }

  // Manual link mode (with existing topicId)
  if (!rawTopicId || isNaN(rawTopicId)) {
    return NextResponse.json({ error: "رقم الـ Topic ID غير صالح" }, { status: 400 });
  }

  const topicName = name || `Topic #${rawTopicId}`;
  const topic = await withRetry(() =>
    prisma.topic.upsert({
      where: { groupId_topicId: { groupId, topicId: rawTopicId } },
      update: { name: topicName, iconColor },
      create: { groupId, topicId: rawTopicId, name: topicName, iconColor, isClosed: false },
    })
  );

  return NextResponse.json({
    ok: true,
    topic: { message_thread_id: topic.topicId, name: topic.name },
    linkedManually: true,
  });
}

// PATCH — rename topic in Telegram, Topic table, and Quiz/Exam tables
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ groupId: string }> }
) {
  const { groupId } = await params;
  const membership = await getAuth(req, groupId);
  if (!membership) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const group = membership.group;
  const body = await req.json().catch(() => ({}));
  const topicId = Number(body.topicId);
  const name = String(body.name || "").trim();

  if (!topicId || !name) {
    return NextResponse.json({ error: "topicId and name are required" }, { status: 400 });
  }

  // Edit in Telegram
  try {
    await telegram.editForumTopic({
      chat_id: group.chatId,
      message_thread_id: topicId,
      name,
    });
  } catch (e) {
    console.warn("[topics] editForumTopic error:", e);
  }

  // Update in Topic table
  const updated = await withRetry(() =>
    prisma.topic.update({
      where: { groupId_topicId: { groupId, topicId } },
      data: { name },
    })
  );

  // Synchronize name in past quizzes and exams
  await withRetry(() =>
    prisma.quiz.updateMany({
      where: { groupId, topicId },
      data: { topicName: name },
    })
  ).catch(() => {});

  await withRetry(() =>
    prisma.exam.updateMany({
      where: { groupId, topicId },
      data: { topicName: name },
    })
  ).catch(() => {});

  return NextResponse.json({ ok: true, topic: { message_thread_id: updated.topicId, name: updated.name } });
}

// DELETE — permanently remove topic and unlink from past quizzes/exams so it NEVER returns
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ groupId: string }> }
) {
  const { groupId } = await params;
  const membership = await getAuth(req, groupId);
  if (!membership) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const group = membership.group;
  const body = await req.json().catch(() => ({}));

  // Support single ID or array of IDs for batch deletion
  const rawIds = Array.isArray(body.topicIds)
    ? body.topicIds
    : body.topicId !== undefined
    ? [body.topicId]
    : [];

  const topicIds = rawIds
    .map((id: unknown) => Number(id))
    .filter((n: number) => !isNaN(n) && n > 0);

  const deleteFromTelegram = Boolean(body.deleteFromTelegram);

  if (topicIds.length === 0) {
    return NextResponse.json({ error: "topicId or topicIds is required" }, { status: 400 });
  }

  for (const topicId of topicIds) {
    // 1. Optionally delete from Telegram directly
    if (deleteFromTelegram) {
      try {
        await telegram.deleteForumTopic(group.chatId, topicId);
      } catch (e) {
        console.warn(`[topics] deleteForumTopic ${topicId} error:`, e);
      }
    }

    // 2. Permanently delete from Topic table
    await withRetry(() =>
      prisma.topic.deleteMany({ where: { groupId, topicId } })
    );

    // 3. Completely unlink from old Quizzes & Exams so it can NEVER resurrect
    await withRetry(() =>
      prisma.quiz.updateMany({
        where: { groupId, topicId },
        data: { topicId: null, topicName: null },
      })
    );
    await withRetry(() =>
      prisma.exam.updateMany({
        where: { groupId, topicId },
        data: { topicId: null, topicName: null },
      })
    );
  }

  return NextResponse.json({ ok: true, deletedCount: topicIds.length });
}
