/**
 * Key rotation: re-encrypt ConnectorCredential rows to the current key version.
 *
 * Env:
 *   BREEZE_DATA_KEY      — current (new) key, base64 32 bytes
 *   BREEZE_DATA_KEY_OLD  — previous key, base64 32 bytes
 *
 * Usage:
 *   pnpm --filter @breeze/db exec tsx scripts/rotate-keys.ts
 */
import { createDecipheriv, createCipheriv, randomBytes } from "node:crypto";
import { prisma, KEY_VERSION } from "../src/index.js";

const ALG = "aes-256-gcm";
const IV_LEN = 12;
const TAG_LEN = 16;
const BATCH = 100;

function parseKey(raw: string | undefined, name: string): Buffer {
  if (!raw) throw new Error(`${name} is not set`);
  const k = Buffer.from(raw, "base64");
  if (k.length !== 32) throw new Error(`${name} must decode to 32 bytes`);
  return k;
}

function decryptWithKey(buf: Buffer, key: Buffer): string {
  const iv = buf.subarray(1, 1 + IV_LEN);
  const tag = buf.subarray(1 + IV_LEN, 1 + IV_LEN + TAG_LEN);
  const ct = buf.subarray(1 + IV_LEN + TAG_LEN);
  const d = createDecipheriv(ALG, key, iv);
  d.setAuthTag(tag);
  return Buffer.concat([d.update(ct), d.final()]).toString("utf8");
}

function encryptWithKey(plaintext: string, key: Buffer): Buffer {
  const iv = randomBytes(IV_LEN);
  const c = createCipheriv(ALG, key, iv);
  const ct = Buffer.concat([c.update(Buffer.from(plaintext, "utf8")), c.final()]);
  const tag = c.getAuthTag();
  return Buffer.concat([Buffer.from([KEY_VERSION]), iv, tag, ct]);
}

async function main() {
  const newKey = parseKey(process.env.BREEZE_DATA_KEY, "BREEZE_DATA_KEY");
  const oldKey = parseKey(process.env.BREEZE_DATA_KEY_OLD, "BREEZE_DATA_KEY_OLD");

  let rotated = 0;
  let cursor: string | undefined;

  for (;;) {
    const rows = await (prisma as unknown as {
      connectorCredential: {
        findMany: (args: unknown) => Promise<Array<{ id: string; encryptedTokens: Buffer; keyVersion: number }>>;
      };
    }).connectorCredential.findMany({
      where: { keyVersion: { lt: KEY_VERSION } },
      take: BATCH,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      orderBy: { id: "asc" },
    });

    if (rows.length === 0) break;

    for (const row of rows) {
      const plaintext = decryptWithKey(row.encryptedTokens, oldKey);
      const reencrypted = encryptWithKey(plaintext, newKey);
      await (prisma as unknown as {
        connectorCredential: { update: (args: unknown) => Promise<unknown> };
      }).connectorCredential.update({
        where: { id: row.id },
        data: { encryptedTokens: reencrypted, keyVersion: KEY_VERSION },
      });
      rotated++;
    }

    cursor = rows[rows.length - 1]!.id;
    console.log(`rotated ${rotated} rows…`);
  }

  console.log(`done. total rotated: ${rotated}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
