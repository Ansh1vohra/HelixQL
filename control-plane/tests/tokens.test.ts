import { describe, it, expect } from "vitest";
import {
  generateVerificationToken,
  hashVerificationToken,
  generateApiToken,
  computeApiTokenLookupHash,
  encryptApiToken,
  decryptApiToken,
} from "@/lib/auth/tokens";

describe("verification tokens", () => {
  it("produces a raw token whose hash matches hashVerificationToken", () => {
    const { raw, tokenHash } = generateVerificationToken();
    expect(hashVerificationToken(raw)).toBe(tokenHash);
  });

  it("generates unique tokens on each call", () => {
    const a = generateVerificationToken();
    const b = generateVerificationToken();
    expect(a.raw).not.toBe(b.raw);
  });
});

describe("api_token", () => {
  it("has the expected prefix", () => {
    expect(generateApiToken()).toMatch(/^hql_live_/);
  });

  it("produces a deterministic lookup hash for the same token", () => {
    const token = generateApiToken();
    expect(computeApiTokenLookupHash(token)).toBe(computeApiTokenLookupHash(token));
  });

  it("produces different lookup hashes for different tokens", () => {
    expect(computeApiTokenLookupHash(generateApiToken())).not.toBe(computeApiTokenLookupHash(generateApiToken()));
  });

  it("round-trips through encryption", () => {
    const token = generateApiToken();
    const encrypted = encryptApiToken(token);
    expect(encrypted).not.toContain(token);
    expect(decryptApiToken(encrypted)).toBe(token);
  });

  it("fails to decrypt a tampered ciphertext", () => {
    const token = generateApiToken();
    const encrypted = encryptApiToken(token);
    const [ivB64, tagB64, ctB64] = encrypted.split(".") as [string, string, string];

    // Flip one bit in the decoded ciphertext bytes (not the base64 text) to
    // guarantee the plaintext content actually changes, then re-encode.
    const ciphertextBytes = Buffer.from(ctB64, "base64url");
    ciphertextBytes[0] = ciphertextBytes[0]! ^ 0xff;
    const tampered = [ivB64, tagB64, ciphertextBytes.toString("base64url")].join(".");

    expect(() => decryptApiToken(tampered)).toThrow();
  });
});
