import { NextRequest, NextResponse } from "next/server";
import { jwtVerify } from "jose";
import { prisma, withRetry } from "@/lib/db";
import { telegram } from "@/lib/telegram";

const JWT_SECRET = new TextEncoder().encode(process.env.AUTH_SECRET || "secret");

async function getAuthorizedUser(req: NextRequest, groupId: string) {
  const token = req.cookies.get("qf_session")?.value;
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, JWT_SECRET);
    const userId = (payload as { sub: string }).sub;
    const membership = await withRetry(() =>
      prisma.groupMember.findUnique({
        where: { userId_groupId: { userId, groupId } },
        include: { group: true, user: true },
      })
    );
    if (!membership || !membership.approved) return null;
    return { membership, userId };
  } catch {
    return null;
  }
}

interface InlineButtonInput {
  text: string;
  url?: string;
  callback_data?: string;
}

interface PostRequestBody {
  text?: string;
  parseMode?: "HTML" | "Markdown" | "MarkdownV2";
  topicId?: number | null;
  mediaUrl?: string | null;
  mediaBase64?: string | null;
  mediaMimeType?: string | null;
  buttons?: InlineButtonInput[][];
  pinMessage?: boolean;
  disableNotification?: boolean;
  variables?: {
    count?: number;
    groupTitle?: string;
    title?: string;
    date?: string;
    time?: string;
    [key: string]: string | number | undefined;
  };
}

function sanitizeUrl(rawUrl?: string): string | null {
  if (!rawUrl) return null;
  let url = rawUrl.trim();
  if (!url || url === "https://" || url === "http://" || url === "tg://" || url === "#") {
    return null;
  }
  if (url.startsWith("@")) {
    url = `https://t.me/${url.slice(1)}`;
  } else if (url.startsWith("t.me/")) {
    url = `https://${url}`;
  } else if (!url.startsWith("http://") && !url.startsWith("https://") && !url.startsWith("tg://")) {
    url = `https://${url}`;
  }

  if (url.startsWith("tg://")) {
    return url.length > 5 ? url : null;
  }

  try {
    const parsed = new URL(url);
    if (!parsed.hostname || !parsed.hostname.includes(".")) {
      return null;
    }
    return parsed.toString();
  } catch {
    return null;
  }
}

function prepareTelegramHtml(text: string): string {
  // Escape bare & that is not part of an existing entity (&amp;, &lt;, &gt;, &quot;)
  let result = text.replace(/&(?!amp;|lt;|gt;|quot;|#\d+;)/g, "&amp;");
  // Escape < that is not starting a supported Telegram HTML tag
  result = result.replace(/<(?!\/?(?:a(?:\s+href="[^"]*")?|b|strong|i|em|u|ins|s|strike|del|code|pre|blockquote|tg-spoiler)>)/gi, "&lt;");
  // Escape > that is preceded or followed by whitespace or digits (e.g., "> 90%")
  result = result.replace(/(\s)>(\s|\d)/g, "$1&gt;$2");
  return result;
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ groupId: string }> }
) {
  const { groupId } = await params;
  const auth = await getAuthorizedUser(req, groupId);
  if (!auth) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const body: PostRequestBody = await req.json();
    let text = (body.text || "").trim();

    if (!text && !body.mediaUrl && !body.mediaBase64) {
      return NextResponse.json({ error: "Post content or image is required" }, { status: 400 });
    }

    const group = auth.membership.group;
    const groupTitle = group.title || "المجموعة";

    // Format fallback date/time
    const now = new Date();
    const defaultDate = now.toLocaleDateString("ar-EG", {
      year: "numeric",
      month: "short",
      day: "numeric",
    });
    const defaultTime = now.toLocaleTimeString("ar-EG", {
      hour: "2-digit",
      minute: "2-digit",
    });

    // Replace dynamic variables: {count}, {successCount}, {total}, {failedCount}, {title}, {groupTitle}, {date}, {time}
    const variables = body.variables || {};
    const countVal = variables.count !== undefined ? String(variables.count) : "0";
    const successVal = variables.successCount !== undefined ? String(variables.successCount) : countVal;
    const totalVal = variables.total !== undefined ? String(variables.total) : countVal;
    const failedVal = variables.failedCount !== undefined ? String(variables.failedCount) : "0";
    const titleVal = String(variables.groupTitle || variables.title || groupTitle);
    const dateVal = String(variables.date || defaultDate);
    const timeVal = String(variables.time || defaultTime);

    text = text
      .replace(/{count}/gi, countVal)
      .replace(/{successCount}/gi, successVal)
      .replace(/{total}/gi, totalVal)
      .replace(/{failedCount}/gi, failedVal)
      .replace(/{groupTitle}/gi, titleVal)
      .replace(/{title}/gi, titleVal)
      .replace(/{date}/gi, dateVal)
      .replace(/{time}/gi, timeVal);

    // Validate photo caption length limit (Telegram max: 1024 chars for captions)
    const hasMedia = Boolean(body.mediaBase64 || body.mediaUrl?.trim());
    if (hasMedia && text.length > 1024) {
      return NextResponse.json(
        {
          error: "طول نص رسالة الختام يتجاوز 1024 حرفاً (الحد الأقصى للتسمية التوضيحية مع الصورة في تلجرام). يرجى تقصير النص أو إرساله بدون صورة."
        },
        { status: 400 }
      );
    }

    // Build sanitized inline keyboard
    let reply_markup: { inline_keyboard: Array<Array<{ text: string; url?: string; callback_data?: string }>> } | undefined = undefined;
    if (Array.isArray(body.buttons) && body.buttons.length > 0) {
      const sanitizedRows: Array<Array<{ text: string; url?: string; callback_data?: string }>> = [];
      for (const row of body.buttons) {
        if (!Array.isArray(row)) continue;
        const validButtons: Array<{ text: string; url?: string; callback_data?: string }> = [];
        for (const b of row) {
          if (!b || typeof b.text !== "string" || !b.text.trim()) continue;
          const label = b.text.trim();
          const validUrl = sanitizeUrl(b.url);
          if (validUrl) {
            validButtons.push({ text: label, url: validUrl });
          } else if (b.callback_data && typeof b.callback_data === "string" && b.callback_data.trim()) {
            validButtons.push({ text: label, callback_data: b.callback_data.trim().slice(0, 64) });
          }
        }
        if (validButtons.length > 0) {
          sanitizedRows.push(validButtons);
        }
      }

      if (sanitizedRows.length > 0) {
        reply_markup = { inline_keyboard: sanitizedRows };
      }
    }

    const chatId = group.chatId;
    const topicId = body.topicId ? Number(body.topicId) : undefined;
    const parseMode = body.parseMode || "HTML";
    const disableNotification = Boolean(body.disableNotification);

    if (parseMode === "HTML") {
      text = prepareTelegramHtml(text);
    }

    let messageId: number | undefined;

    // Send Photo or Text message
    if (hasMedia) {
      if (body.mediaBase64) {
        try {
          const res = await telegram.sendPhotoBase64({
            chat_id: chatId,
            message_thread_id: topicId,
            photoBase64: body.mediaBase64,
            mimeType: body.mediaMimeType || "image/jpeg",
            caption: text || undefined,
            parse_mode: parseMode,
            reply_markup,
            disable_notification: disableNotification,
          });
          messageId = res.message_id;
        } catch (photoErr: any) {
          // If parse mode entity error, retry without parse_mode
          if (parseMode && String(photoErr?.message || "").includes("parse entities")) {
            const res = await telegram.sendPhotoBase64({
              chat_id: chatId,
              message_thread_id: topicId,
              photoBase64: body.mediaBase64,
              mimeType: body.mediaMimeType || "image/jpeg",
              caption: text || undefined,
              reply_markup,
              disable_notification: disableNotification,
            });
            messageId = res.message_id;
          } else {
            throw photoErr;
          }
        }
      } else if (body.mediaUrl?.trim()) {
        try {
          const res = await telegram.sendPhoto({
            chat_id: chatId,
            message_thread_id: topicId,
            photo: body.mediaUrl.trim(),
            caption: text || undefined,
            parse_mode: parseMode,
            reply_markup,
            disable_notification: disableNotification,
          });
          messageId = res.message_id;
        } catch (photoErr: any) {
          if (parseMode && String(photoErr?.message || "").includes("parse entities")) {
            const res = await telegram.sendPhoto({
              chat_id: chatId,
              message_thread_id: topicId,
              photo: body.mediaUrl.trim(),
              caption: text || undefined,
              reply_markup,
              disable_notification: disableNotification,
            });
            messageId = res.message_id;
          } else {
            throw photoErr;
          }
        }
      }
    } else {
      // Plain text message
      try {
        const res = await telegram.sendMessage({
          chat_id: chatId,
          message_thread_id: topicId,
          text: text,
          parse_mode: parseMode,
          reply_markup,
          disable_notification: disableNotification,
        });
        messageId = res.message_id;
      } catch (msgErr: any) {
        if (parseMode && String(msgErr?.message || "").includes("parse entities")) {
          const res = await telegram.sendMessage({
            chat_id: chatId,
            message_thread_id: topicId,
            text: text,
            reply_markup,
            disable_notification: disableNotification,
          });
          messageId = res.message_id;
        } else {
          throw msgErr;
        }
      }
    }

    if (!messageId) {
      return NextResponse.json({ error: "Failed to deliver message to Telegram." }, { status: 500 });
    }

    // Optional Pin
    let pinned = false;
    let pinError: string | undefined = undefined;

    if (body.pinMessage && messageId) {
      try {
        pinned = await telegram.pinChatMessage(chatId, messageId, disableNotification);
      } catch (err: any) {
        console.warn("[Post Send] Pinning message failed:", err instanceof Error ? err.message : err);
        pinError = err instanceof Error ? err.message : "Pinning not permitted";
      }
    }

    return NextResponse.json({
      ok: true,
      messageId,
      pinned,
      pinError,
      chatTitle: groupTitle,
      processedText: text,
    });
  } catch (err: any) {
    console.error("[Post Send Error]", err);
    const msg = err instanceof Error ? err.message : "Internal Server Error";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
