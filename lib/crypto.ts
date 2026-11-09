import crypto from "crypto";

/**
 * Verifies a Telegram Login Widget authentication response.
 * https://core.telegram.org/widgets/login#checking-authorization
 */
export function verifyTelegramHash(data: Record<string, string>): boolean {
  const { hash, ...rest } = data;
  if (!hash) return false;

  const botToken = process.env.TELEGRAM_BOT_TOKEN;
  if (!botToken || !/^[a-f\d]{64}$/i.test(hash)) return false;
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
  const authDate = Number(rest.auth_date);
  const now = Math.floor(Date.now() / 1000);
  if (!Number.isSafeInteger(authDate) || authDate <= 0 || now - authDate > 86400 || authDate - now > 300) return false;

  return safeSecretEquals(hmac, hash);
}

/**
 * Generates a cryptographically random webhook secret
 */
export function generateWebhookSecret(): string {
  return crypto.randomBytes(32).toString("hex");
}

/** Compare a supplied secret without leaking character-by-character timing. */
export function safeSecretEquals(
  supplied: string | null | undefined,
  expected: string | null | undefined
): boolean {
  if (!supplied || !expected) return false;
  const suppliedBytes = Buffer.from(supplied, "utf8");
  const expectedBytes = Buffer.from(expected, "utf8");
  return suppliedBytes.length === expectedBytes.length && crypto.timingSafeEqual(suppliedBytes, expectedBytes);
}
