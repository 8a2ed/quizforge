const BASE = `https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}`;

// ── Default timeouts ──────────────────────────────────────────────────────────
const DEFAULT_TIMEOUT_MS = 15_000; // 15s for regular calls
const SEND_TIMEOUT_MS    = 25_000; // 25s for send operations (polls, photos)

async function call<T>(
  method: string,
  body?: Record<string, unknown>,
  timeoutMs = DEFAULT_TIMEOUT_MS
): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch(`${BASE}/${method}`, {
      method: body ? "POST" : "GET",
      headers: { "Content-Type": "application/json" },
      body: body ? JSON.stringify(body) : undefined,
      cache: "no-store",
      signal: controller.signal,
    });

    if (!res.ok) {
      // Telegram sometimes returns HTTP errors before JSON
      throw new Error(`Telegram HTTP ${res.status} on ${method}`);
    }

    const json = await res.json();
    if (!json.ok) {
      throw new Error(json.description || `Telegram API error (${method})`);
    }
    return json.result as T;
  } catch (err) {
    if ((err as { name?: string }).name === "AbortError") {
      throw new Error(`Telegram API timeout after ${timeoutMs}ms (${method})`);
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

// ── Types ─────────────────────────────────────────────────────────────────────

export interface TelegramUser {
  id: number;
  is_bot: boolean;
  first_name: string;
  last_name?: string;
  username?: string;
  photo_url?: string;
}

export interface TelegramChat {
  id: number;
  type: string;
  title?: string;
  username?: string;
  is_forum?: boolean;
  photo?: { small_file_id: string; big_file_id: string };
  member_count?: number;
}

export interface TelegramChatMember {
  status: "creator" | "administrator" | "member" | "restricted" | "left" | "kicked";
  user: TelegramUser;
  can_post_messages?: boolean;
  can_manage_chat?: boolean;
  can_manage_topics?: boolean;
}

export interface TelegramForumTopic {
  message_thread_id: number;
  name: string;
  icon_color: number;
  icon_custom_emoji_id?: string;
  is_closed?: boolean;
}

export interface TelegramMessage {
  message_id: number;
  poll?: { id: string; question: string };
}

export interface SendPollParams {
  chat_id: string | number;
  message_thread_id?: number;
  question: string;
  question_parse_mode?: "HTML" | "MarkdownV2" | "Markdown";
  options: Array<{ text: string }>;
  type?: "quiz" | "regular";
  is_anonymous?: boolean;
  correct_option_id?: number;
  explanation?: string;
  explanation_parse_mode?: "HTML" | "MarkdownV2" | "Markdown";
  allows_multiple_answers?: boolean;
  allows_adding_options?: boolean;
  allows_revoting?: boolean;
  open_period?: number;
  is_closed?: boolean;
  reply_to_message_id?: number;
}

export interface SendPhotoParams {
  chat_id: string | number;
  message_thread_id?: number;
  photo: string;
  caption?: string;
  parse_mode?: "HTML" | "MarkdownV2" | "Markdown";
  reply_to_message_id?: number;
}

export interface TelegramPhotoMessage {
  message_id: number;
}

// ── API Methods ───────────────────────────────────────────────────────────────

export const telegram = {
  getMe(): Promise<TelegramUser> {
    return call("getMe");
  },

  getChat(chat_id: string | number): Promise<TelegramChat> {
    return call("getChat", { chat_id });
  },

  getChatMember(chat_id: string | number, user_id: number): Promise<TelegramChatMember> {
    return call("getChatMember", { chat_id, user_id });
  },

  getChatAdministrators(chat_id: string | number): Promise<TelegramChatMember[]> {
    return call("getChatAdministrators", { chat_id });
  },

  getChatMemberCount(chat_id: string | number): Promise<number> {
    return call("getChatMemberCount", { chat_id });
  },

  getForumTopics(chat_id: string | number): Promise<{ topics: TelegramForumTopic[] }> {
    return call("getForumTopics", { chat_id });
  },

  sendPoll(params: SendPollParams): Promise<TelegramMessage> {
    return call("sendPoll", params as unknown as Record<string, unknown>, SEND_TIMEOUT_MS);
  },

  sendPhoto(params: SendPhotoParams): Promise<TelegramPhotoMessage> {
    return call("sendPhoto", params as unknown as Record<string, unknown>, SEND_TIMEOUT_MS);
  },

  sendMessage(params: Record<string, unknown>): Promise<TelegramMessage> {
    return call("sendMessage", params, SEND_TIMEOUT_MS);
  },

  stopPoll(chat_id: string | number, message_id: number): Promise<Record<string, unknown>> {
    return call("stopPoll", { chat_id, message_id }, SEND_TIMEOUT_MS);
  },

  answerCallbackQuery(callback_query_id: string, text?: string, show_alert?: boolean): Promise<boolean> {
    return call("answerCallbackQuery", {
      callback_query_id,
      ...(text ? { text } : {}),
      ...(show_alert ? { show_alert } : {}),
    });
  },

  /** Upload a base64-encoded image to Telegram via multipart */
  async sendPhotoBase64(params: {
    chat_id: string | number;
    message_thread_id?: number;
    photoBase64: string;
    mimeType?: string;
    caption?: string;
  }): Promise<TelegramPhotoMessage> {
    const mimeType = params.mimeType || "image/jpeg";
    const dataUrl = `data:${mimeType};base64,${params.photoBase64}`;
    const blobRes = await fetch(dataUrl);
    const blob = await blobRes.blob();

    const fd = new FormData();
    fd.append("chat_id", String(params.chat_id));
    if (params.message_thread_id) fd.append("message_thread_id", String(params.message_thread_id));
    if (params.caption) fd.append("caption", params.caption);
    fd.append("photo", blob, "photo.jpg");

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), SEND_TIMEOUT_MS);
    try {
      const res = await fetch(`${BASE}/sendPhoto`, {
        method: "POST", body: fd, cache: "no-store", signal: controller.signal,
      });
      const json = await res.json();
      if (!json.ok) throw new Error(json.description || "Telegram sendPhoto error");
      return json.result as TelegramPhotoMessage;
    } finally {
      clearTimeout(timer);
    }
  },

  deleteMessage(chat_id: string | number, message_id: number): Promise<boolean> {
    return call("deleteMessage", { chat_id, message_id });
  },

  setWebhook(url: string, secret_token?: string): Promise<boolean> {
    return call("setWebhook", {
      url,
      ...(secret_token ? { secret_token } : {}),
      // Include callback_query for the Exam system inline buttons
      allowed_updates: ["poll_answer", "poll", "message", "callback_query"],
      drop_pending_updates: false,
    });
  },

  deleteWebhook(): Promise<boolean> {
    return call("deleteWebhook");
  },

  getWebhookInfo(): Promise<Record<string, unknown>> {
    return call("getWebhookInfo");
  },

  /** Send document, audio, or video by URL */
  sendFile(params: {
    chat_id: string | number;
    message_thread_id?: number;
    fileType: "document" | "audio" | "video" | "animation" | "voice";
    fileUrl: string;
    caption?: string;
    parse_mode?: "HTML" | "MarkdownV2" | "Markdown";
    reply_markup?: Record<string, unknown>;
    duration?: number;
    title?: string;
  }): Promise<TelegramMessage> {
    const { fileType, fileUrl, ...rest } = params;
    const method = `send${fileType.charAt(0).toUpperCase()}${fileType.slice(1)}`;
    return call(method, { ...rest, [fileType]: fileUrl } as Record<string, unknown>, SEND_TIMEOUT_MS);
  },

  /** Send multiple media items as an album */
  sendMediaGroup(params: {
    chat_id: string | number;
    message_thread_id?: number;
    media: Array<{
      type: "photo" | "video" | "document" | "audio";
      media: string;
      caption?: string;
      parse_mode?: "HTML" | "MarkdownV2" | "Markdown";
    }>;
  }): Promise<TelegramMessage[]> {
    return call("sendMediaGroup", params as unknown as Record<string, unknown>, SEND_TIMEOUT_MS);
  },

  /** Forward a message from one chat to another */
  forwardMessage(params: {
    chat_id: string | number;
    from_chat_id: string | number;
    message_id: number;
    message_thread_id?: number;
    disable_notification?: boolean;
  }): Promise<TelegramMessage> {
    return call("forwardMessage", params as unknown as Record<string, unknown>, SEND_TIMEOUT_MS);
  },

  /** Pin a message in a chat */
  pinChatMessage(chat_id: string | number, message_id: number, disable_notification = false): Promise<boolean> {
    return call("pinChatMessage", { chat_id, message_id, disable_notification });
  },

  /** Unpin a message */
  unpinChatMessage(chat_id: string | number, message_id: number): Promise<boolean> {
    return call("unpinChatMessage", { chat_id, message_id });
  },

  /** Copy a message without a forward header */
  copyMessage(params: {
    chat_id: string | number;
    from_chat_id: string | number;
    message_id: number;
    caption?: string;
    parse_mode?: string;
    reply_markup?: Record<string, unknown>;
  }): Promise<{ message_id: number }> {
    return call("copyMessage", params as unknown as Record<string, unknown>, SEND_TIMEOUT_MS);
  },
};
