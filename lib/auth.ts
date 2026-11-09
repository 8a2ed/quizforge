/**
 * Return the configured secret used to sign and verify dashboard sessions.
 * A missing or weak secret must never silently fall back to a public default.
 */
export function getAuthSecret(): Uint8Array {
  const secret = process.env.AUTH_SECRET?.trim();
  if (!secret || Buffer.byteLength(secret, "utf8") < 32) {
    throw new Error("AUTH_SECRET must be configured with at least 32 characters.");
  }

  return new TextEncoder().encode(secret);
}

