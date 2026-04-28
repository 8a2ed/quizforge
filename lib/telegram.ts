const BASE = `https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}`;

async function call<T>(method: string, body?: Record<string, unknown>): Promise<T> {
  const res = await fetch(`${BASE}/${method}`, {
    method: body ? "POST" : "GET",
    headers: { "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
    cache: "no-store",
  });
  const json = await res.json();
  if (!json.ok) throw new Error(json.description || `Telegram API error (${method})`);
  return json.result as T;
}

// ─── Types ────────────────────────────────────────────────────────────────────

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
  photo: string; // URL or file_id
  caption?: string;
  parse_mode?: "HTML" | "MarkdownV2" | "Markdown";
  reply_to_message_id?: number;
}

export interface TelegramPhotoMessage {
  message_id: number;
}

// ─── API Methods ──────────────────────────────────────────────────────────────

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
    return call("sendPoll", params as unknown as Record<string, unknown>);
  },

  sendPhoto(params: SendPhotoParams): Promise<TelegramPhotoMessage> {
    return call("sendPhoto", params as unknown as Record<string, unknown>);
  },

  /** Upload a base64-encoded image to Telegram via multipart (Node 18+ native Blob) */
  async sendPhotoBase64(params: {
    chat_id: string | number;
    message_thread_id?: number;
    photoBase64: string;  // raw base64, no data-URL prefix
    mimeType?: string;
    caption?: string;
  }): Promise<TelegramPhotoMessage> {
    const mimeType = params.mimeType || "image/jpeg";
    // Convert base64 → Blob via data-URL fetch (works in Node 18+, no Buffer needed)
    const dataUrl = `data:${mimeType};base64,${params.photoBase64}`;
    const blobRes = await fetch(dataUrl);
    const blob = await blobRes.blob();

    const fd = new FormData();
    fd.append("chat_id", String(params.chat_id));
    if (params.message_thread_id) fd.append("message_thread_id", String(params.message_thread_id));
    if (params.caption) fd.append("caption", params.caption);
    fd.append("photo", blob, "photo.jpg");

    const res = await fetch(`${BASE}/sendPhoto`, { method: "POST", body: fd, cache: "no-store" });
    const json = await res.json();
    if (!json.ok) throw new Error(json.description || "Telegram sendPhoto error");
    return json.result as TelegramPhotoMessage;
  },

  deleteMessage(chat_id: string | number, message_id: number): Promise<boolean> {
    return call("deleteMessage", { chat_id, message_id });
  },

  setWebhook(url: string, secret_token?: string): Promise<boolean> {
    return call("setWebhook", {
      url,
      ...(secret_token ? { secret_token } : {}),
      allowed_updates: ["poll_answer", "poll", "message"],
      drop_pending_updates: false,
    });
  },

  deleteWebhook(): Promise<boolean> {
    return call("deleteWebhook");
  },

  getWebhookInfo(): Promise<Record<string, unknown>> {
    return call("getWebhookInfo");
  },
};
