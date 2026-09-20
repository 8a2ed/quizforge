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

// GET — fetch topics (with auto-sync from history & optional auto-creation in Telegram)
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

  // 3. Sync historical topics from past quizzes & exams in QuizForge
  try {
    const pastQuizzes = await withRetry(() =>
      prisma.quiz.findMany({
        where: { groupId, topicId: { not: null } },
        select: { topicId: true, topicName: true },
        distinct: ["topicId"],
      })
    );
    const pastExams = await withRetry(() =>
      prisma.exam.findMany({
        where: { groupId, topicId: { not: null } },
        select: { topicId: true, topicName: true },
        distinct: ["topicId"],
      })
    );

    const historical = new Map<number, string | null>();
    for (const q of pastQuizzes) {
      if (q.topicId) historical.set(q.topicId, q.topicName);
    }
    for (const ex of pastExams) {
      if (ex.topicId && !historical.has(ex.topicId)) historical.set(ex.topicId, ex.topicName);
    }

    for (const [tId, tName] of historical.entries()) {
      await withRetry(() =>
        prisma.topic.upsert({
          where: { groupId_topicId: { groupId, topicId: tId } },
          update: tName ? { name: tName } : {},
          create: {
            groupId,
            topicId: tId,
            name: tName || `Topic #${tId}`,
            iconColor: 0,
            isClosed: false,
          },
        })
      );
    }
  } catch (e) {
    console.warn("[topics] historical sync error:", e);
  }

  // 4. Auto-create standard topics in Telegram if requested and bot has rights
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

    // Check what topics currently exist in DB
    const currentTopics = await withRetry(() =>
      prisma.topic.findMany({ where: { groupId } })
    );

    for (const std of STANDARD_FORUM_TOPICS) {
      // Check if already created (e.g. includes "إعلانات" or "اختبارات" etc.)
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

  // 5. Fetch and return all topics for this group
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

// POST — create topic directly in Telegram (default) or link existing topic by ID
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ groupId: string }> }
) {
  const { groupId } = await params;
  const membership = await getAuth(req, groupId);
  if (!membership) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const group = membership.group;
  const body = await req.json().catch(() => ({}));
  const name = String(body.name || "").trim();
  const rawTopicId = body.topicId !== undefined && body.topicId !== "" ? Number(body.topicId) : null;
  const iconColor = body.iconColor ? Number(body.iconColor) : 7322096;
  const createInTelegram = body.createInTelegram !== false && !rawTopicId;

  if (!name && !rawTopicId) {
    return NextResponse.json({ error: "اسم الموضوع مطلوب" }, { status: 400 });
  }

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
      update: { name: topicName },
      create: { groupId, topicId: rawTopicId, name: topicName, iconColor: 0, isClosed: false },
    })
  );

  return NextResponse.json({
    ok: true,
    topic: { message_thread_id: topic.topicId, name: topic.name },
    linkedManually: true,
  });
}

// PATCH — rename topic in Telegram and DB
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

  // Attempt to edit in Telegram
  try {
    await telegram.editForumTopic({
      chat_id: group.chatId,
      message_thread_id: topicId,
      name,
    });
  } catch (e) {
    console.warn("[topics] editForumTopic error:", e);
  }

  // Update in DB
  const updated = await withRetry(() =>
    prisma.topic.update({
      where: { groupId_topicId: { groupId, topicId } },
      data: { name },
    })
  );

  return NextResponse.json({ ok: true, topic: { message_thread_id: updated.topicId, name: updated.name } });
}

// DELETE — remove topic from DB, optionally deleting from Telegram
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ groupId: string }> }
) {
  const { groupId } = await params;
  const membership = await getAuth(req, groupId);
  if (!membership) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const group = membership.group;
  const body = await req.json().catch(() => ({}));
  const topicId = Number(body.topicId);
  const deleteFromTelegram = Boolean(body.deleteFromTelegram);

  if (!topicId) {
    return NextResponse.json({ error: "topicId is required" }, { status: 400 });
  }

  if (deleteFromTelegram) {
    try {
      await telegram.deleteForumTopic(group.chatId, topicId);
    } catch (e) {
      console.warn("[topics] deleteForumTopic error:", e);
    }
  }

  await withRetry(() =>
    prisma.topic.deleteMany({ where: { groupId, topicId } })
  );

  return NextResponse.json({ ok: true, deletedFromTelegram: deleteFromTelegram });
}
