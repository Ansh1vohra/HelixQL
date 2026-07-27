import { randomBytes, createHash, createHmac, createCipheriv, createDecipheriv } from "node:crypto";
import { getEnv } from "@/lib/env";

const AES_ALGO = "aes-256-gcm";
const IV_LENGTH = 12; // recommended nonce length for GCM

function base64url(buf: Buffer): string {
  return buf.toString("base64url");
}

/**
 * Generic AES-256-GCM encrypt/decrypt for values we must be able to recover
 * in plaintext later (unlike passwords, which are one-way hashed). Used only
 * for the api_token, and only ever decrypted server-side within an
 * authenticated request handler.
 */
function encryptWithKey(plaintext: string, hexKey: string): string {
  const key = Buffer.from(hexKey, "hex");
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(AES_ALGO, key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return [base64url(iv), base64url(authTag), base64url(ciphertext)].join(".");
}

function decryptWithKey(payload: string, hexKey: string): string {
  const [ivB64, tagB64, ctB64] = payload.split(".");
  if (!ivB64 || !tagB64 || !ctB64) {
    throw new Error("Malformed encrypted payload");
  }
  const key = Buffer.from(hexKey, "hex");
  const iv = Buffer.from(ivB64, "base64url");
  const authTag = Buffer.from(tagB64, "base64url");
  const ciphertext = Buffer.from(ctB64, "base64url");
  const decipher = createDecipheriv(AES_ALGO, key, iv);
  decipher.setAuthTag(authTag);
  const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  return plaintext.toString("utf8");
}

// --- Email verification tokens ---
// High-entropy, single-use, never need to be recovered once issued, so a
// plain one-way SHA-256 hash is sufficient (no HMAC secret needed).

export function generateVerificationToken(): { raw: string; tokenHash: string } {
  const raw = base64url(randomBytes(32));
  const tokenHash = createHash("sha256").update(raw).digest("hex");
  return { raw, tokenHash };
}

export function hashVerificationToken(raw: string): string {
  return createHash("sha256").update(raw).digest("hex");
}

// --- api_token (long-lived desktop/gateway credential) ---
// Needs to be both (a) validated quickly via an indexed lookup and (b)
// recoverable in plaintext to hand back to the user on login. See
// User model comments for why this uses two separate representations.

const API_TOKEN_PREFIX = "hql_live_";

export function generateApiToken(): string {
  return `${API_TOKEN_PREFIX}${base64url(randomBytes(32))}`;
}

export function computeApiTokenLookupHash(rawToken: string): string {
  const { API_TOKEN_HMAC_SECRET } = getEnv();
  return createHmac("sha256", API_TOKEN_HMAC_SECRET).update(rawToken).digest("hex");
}

export function encryptApiToken(rawToken: string): string {
  const { API_TOKEN_ENCRYPTION_KEY } = getEnv();
  return encryptWithKey(rawToken, API_TOKEN_ENCRYPTION_KEY);
}

export function decryptApiToken(encrypted: string): string {
  const { API_TOKEN_ENCRYPTION_KEY } = getEnv();
  return decryptWithKey(encrypted, API_TOKEN_ENCRYPTION_KEY);
}
