import { z } from "zod";
import { BreezeError } from "@breeze/common";
import { registerTrigger, type ConnectorTrigger } from "../triggers.js";
import { env } from "../http.js";
import * as path from "node:path";
import { promises as fs } from "node:fs";

const DEFAULT_ROOT = ".breeze/storage/files";

interface FileCreatedItem {
  key: string;
  name: string;
  size: number;
  modified: string;
}

function userRoot(userId: string): string {
  const base = env("BREEZE_FILES_ROOT") ?? DEFAULT_ROOT;
  if (!userId || userId.includes("..") || userId.includes("/") || userId.includes("\\")) {
    throw new BreezeError("validation", "Invalid userId");
  }
  return path.resolve(base, userId);
}

async function walk(root: string, rel: string): Promise<Array<{ key: string; name: string; mtimeMs: number; size: number }>> {
  const out: Array<{ key: string; name: string; mtimeMs: number; size: number }> = [];
  const base = path.resolve(root, rel || ".");
  if (!base.startsWith(path.resolve(root))) return [];
  try {
    const entries = await fs.readdir(base, { withFileTypes: true });
    for (const entry of entries) {
      const full = path.join(base, entry.name);
      if (entry.isDirectory()) {
        out.push(...(await walk(root, path.relative(root, full))));
        continue;
      }
      if (!entry.isFile()) continue;
      const stat = await fs.stat(full);
      out.push({
        key: path.relative(root, full).split(path.sep).join("/"),
        name: entry.name,
        mtimeMs: stat.mtimeMs,
        size: stat.size,
      });
    }
  } catch (err) {
    if ((err as { code?: string }).code === "ENOENT") return [];
    throw err;
  }
  return out;
}

/**
 * files.file_created — yields files whose mtime is newer than the cursor.
 * Cursor is mtime in milliseconds. Initial run establishes the cursor
 * without emitting existing files.
 */
const fileCreated: ConnectorTrigger<{ prefix?: string }, FileCreatedItem> = {
  key: "files.file_created",
  connector: "files",
  displayName: "New or updated file",
  description: "Fires when a file appears or is modified under the watched prefix.",
  itemShape: "{ key, name, size, modified }",
  inputSchema: z.object({ prefix: z.string().optional() }),
  async poll({ input, cursor, ctx }) {
    const root = userRoot(ctx.account.userId);
    await fs.mkdir(root, { recursive: true });
    const cursorMs = cursor ? Number(cursor) : Date.now();
    const scanned = await walk(root, input.prefix ?? "");

    const items: Array<{ key: string; data: FileCreatedItem }> = [];
    let newest = cursorMs;
    for (const f of scanned) {
      if (f.mtimeMs <= cursorMs) continue;
      items.push({
        key: `${f.key}@${Math.floor(f.mtimeMs)}`,
        data: {
          key: f.key,
          name: f.name,
          size: f.size,
          modified: new Date(f.mtimeMs).toISOString(),
        },
      });
      if (f.mtimeMs > newest) newest = f.mtimeMs;
    }

    return { items, cursor: String(Math.floor(newest)) };
  },
};

registerTrigger(fileCreated);
