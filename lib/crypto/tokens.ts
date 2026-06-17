/**
 * AES-256-GCM encryption for LinkedIn OAuth tokens.
 *
 * The key (TOKEN_ENC_KEY) is supplied via the environment / host keystore and
 * is NEVER stored in the database. Compromising the DB alone yields only
 * ciphertext. See docs/07-security-privacy.md §7.2.
 *
 * Storage layout: the 16-byte GCM auth tag is appended to the ciphertext, and
 * the 12-byte IV is stored separately as the "nonce".
 */
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { env } from "@/lib/env";

const ALGO = "aes-256-gcm";
const IV_LEN = 12;
const TAG_LEN = 16;

function getKey(): Buffer {
  const key = Buffer.from(env.TOKEN_ENC_KEY, "base64");
  if (key.length !== 32) {
    throw new Error(
      "TOKEN_ENC_KEY must be a base64-encoded 32-byte key (got " +
        key.length +
        " bytes). Generate with: openssl rand -base64 32",
    );
  }
  return key;
}

export interface EncryptedToken {
  ciphertext: Buffer; // encrypted bytes || 16-byte auth tag
  nonce: Buffer; // 12-byte IV
}

export function encryptToken(plaintext: string): EncryptedToken {
  const iv = randomBytes(IV_LEN);
  const cipher = createCipheriv(ALGO, getKey(), iv);
  const encrypted = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();
  return { ciphertext: Buffer.concat([encrypted, tag]), nonce: iv };
}

export function decryptToken(token: EncryptedToken): string {
  const { ciphertext, nonce } = token;
  const tag = ciphertext.subarray(ciphertext.length - TAG_LEN);
  const data = ciphertext.subarray(0, ciphertext.length - TAG_LEN);
  const decipher = createDecipheriv(ALGO, getKey(), nonce);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(data), decipher.final()]).toString("utf8");
}
