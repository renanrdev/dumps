// domain/id_generator.ts — CSPRNG-based base62 ID and deletion token generation.
// No I/O. Uses the Web Crypto API available in both Workers and Node.js (18+).

const BASE62_CHARS =
  "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
const ID_LENGTH = 10;
const TOKEN_LENGTH = 32;

/**
 * Generate a cryptographically secure base62 ID.
 * Uses rejection sampling to avoid modular bias.
 */
export function generateId(length = ID_LENGTH): string {
  const result: string[] = [];
  // We need `length` chars. Each char maps to one of 62 values.
  // 256 / 62 = 4.12... so rejection rate < 20% per byte — negligible.
  while (result.length < length) {
    const buf = new Uint8Array(length * 2); // oversample to reduce loops
    crypto.getRandomValues(buf);
    for (const byte of buf) {
      if (byte < 248) {
        // 248 = floor(256/62)*62 — above this biases toward 0–5
        result.push(BASE62_CHARS[byte % 62] as string);
        if (result.length === length) break;
      }
    }
  }
  return result.join("");
}

/**
 * Generate a secure deletion token with "del_" prefix.
 * Returns the raw token (to be sent to the caller) and its SHA-256 hex hash
 * (to be stored in metadata — we never store the raw token).
 */
export async function generateDeletionToken(): Promise<{
  token: string;
  hash: string;
}> {
  const raw = "del_" + generateId(TOKEN_LENGTH);
  const encoder = new TextEncoder();
  const data = encoder.encode(raw);
  const hashBuf = await crypto.subtle.digest("SHA-256", data.buffer as ArrayBuffer);
  const hashHex = Array.from(new Uint8Array(hashBuf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  return { token: raw, hash: "sha256:" + hashHex };
}

/**
 * Verify a provided deletion token against a stored hash.
 */
export async function verifyDeletionToken(
  token: string,
  storedHash: string
): Promise<boolean> {
  if (!storedHash.startsWith("sha256:")) return false;
  const encoder = new TextEncoder();
  const data = encoder.encode(token);
  const hashBuf = await crypto.subtle.digest("SHA-256", data);
  const computed =
    "sha256:" +
    Array.from(new Uint8Array(hashBuf))
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");
  // Timing-safe comparison using SubtleCrypto is not available for strings,
  // but since we control both sides and the stored hash is not secret, a
  // simple string compare is acceptable here. The token itself is the secret.
  return computed === storedHash;
}
