import crypto from "crypto";

/**
 * Verifies a Telegram Login Widget authentication response.
 * https://core.telegram.org/widgets/login#checking-authorization
 */
export function verifyTelegramHash(data: Record<string, string>): boolean {
  const { hash, ...rest } = data;
  if (!hash) return false;

  const botToken = process.env.TELEGRAM_BOT_TOKEN!;
  const secretKey = crypto.createHash("sha256").update(botToken).digest();

  const checkString = Object.keys(rest)
    .sort()
    .map((k) => `${k}=${rest[k]}`)
    .join("\n");

  const hmac = crypto
    .createHmac("sha256", secretKey)
    .update(checkString)
    .digest("hex");

  // Also verify auth_date is not older than 24 hours
  const authDate = parseInt(rest.auth_date || "0", 10);
  const now = Math.floor(Date.now() / 1000);
  if (now - authDate > 86400) return false;

  return hmac === hash;
}

/**
 * Generates a cryptographically random webhook secret
 */
export function generateWebhookSecret(): string {
  return crypto.randomBytes(32).toString("hex");
}
