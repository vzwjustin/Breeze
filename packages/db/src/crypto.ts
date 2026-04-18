/**
 * Token encryption helpers (AES-256-GCM) for ConnectorCredential.
 *
 * Key is read from BREEZE_DATA_KEY (32 bytes, base64-encoded).
 * Rotate by bumping `keyVersion` on the credential row and re-encrypting.
 *
 * This is intentionally tiny so the security surface is obvious.
 */
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

const ALG = "aes-256-gcm";
const IV_LEN = 12;
const TAG_LEN = 16;

function loadKey(): Buffer {
  const raw = process.env.BREEZE_DATA_KEY;
  if (!raw) throw new Error("BREEZE_DATA_KEY is not set");
  const key = Buffer.from(raw, "base64");
  if (key.length !== 32) {
    throw new Error("BREEZE_DATA_KEY must decode to 32 bytes (AES-256)");
  }
  return key;
}

export function encryptString(plaintext: string): Buffer {
  const key = loadKey();
  const iv = randomBytes(IV_LEN);
  const cipher = createCipheriv(ALG, key, iv);
  const ct = Buffer.concat([
    cipher.update(Buffer.from(plaintext, "utf8")),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();
  // Layout: [iv (12) | tag (16) | ciphertext]
  return Buffer.concat([iv, tag, ct]);
}

export function decryptString(buf: Buffer): string {
  const key = loadKey();
  const iv = buf.subarray(0, IV_LEN);
  const tag = buf.subarray(IV_LEN, IV_LEN + TAG_LEN);
  const ct = buf.subarray(IV_LEN + TAG_LEN);
  const decipher = createDecipheriv(ALG, key, iv);
  decipher.setAuthTag(tag);
  const pt = Buffer.concat([decipher.update(ct), decipher.final()]);
  return pt.toString("utf8");
}
