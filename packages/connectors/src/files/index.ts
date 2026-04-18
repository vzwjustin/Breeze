import { z } from "zod";
import { BreezeError } from "@breeze/common";
import { registerConnector } from "../registry.js";
import type { Connector, ConnectorCapability, ConnectorExecutionContext } from "../types.js";
import { env } from "../http.js";
import * as path from "node:path";
import { promises as fs } from "node:fs";

const DEFAULT_ROOT = ".breeze/storage/files";
const MAX_READ_BYTES = 2 * 1024 * 1024; // 2 MiB
const MAX_SUMMARY_CHARS = 2000;

const TEXT_MIME: Record<string, string> = {
  ".txt": "text/plain",
  ".md": "text/markdown",
  ".json": "application/json",
  ".csv": "text/csv",
  ".yml": "application/yaml",
  ".yaml": "application/yaml",
  ".log": "text/plain",
  ".html": "text/html",
  ".htm": "text/html",
};

function userRoot(ctx: ConnectorExecutionContext): string {
  const base = env("BREEZE_FILES_ROOT") ?? DEFAULT_ROOT;
  const userId = ctx.account.userId;
  if (!userId || userId.includes("..") || userId.includes("/") || userId.includes("\\")) {
    throw new BreezeError("validation", "Invalid userId");
  }
  return path.resolve(base, userId);
}

function resolveKey(root: string, key: string): string {
  if (!key || key.startsWith("/") || key.includes("..")) {
    throw new BreezeError("validation", `Invalid key: ${key}`);
  }
  const resolved = path.resolve(root, key);
  if (!resolved.startsWith(path.resolve(root) + path.sep) && resolved !== path.resolve(root)) {
    throw new BreezeError("validation", "Path escapes user root");
  }
  return resolved;
}

async function ensureDir(dir: string): Promise<void> {
  await fs.mkdir(dir, { recursive: true });
}

async function walk(root: string, prefix: string): Promise<Array<{ key: string; name: string; size: number; modified: string }>> {
  const out: Array<{ key: string; name: string; size: number; modified: string }> = [];
  const base = resolveKey(root, prefix || ".");
  try {
    const entries = await fs.readdir(base, { withFileTypes: true });
    for (const entry of entries) {
      const full = path.join(base, entry.name);
      if (entry.isDirectory()) {
        const nested = await walk(root, path.relative(root, full));
        out.push(...nested);
        continue;
      }
      if (!entry.isFile()) continue;
      const stat = await fs.stat(full);
      const key = path.relative(root, full).split(path.sep).join("/");
      out.push({ key, name: entry.name, size: stat.size, modified: stat.mtime.toISOString() });
    }
  } catch (err) {
    if ((err as { code?: string }).code === "ENOENT") return [];
    throw err;
  }
  return out;
}

function mimeFor(name: string): string {
  const ext = path.extname(name).toLowerCase();
  return TEXT_MIME[ext] ?? "application/octet-stream";
}

async function readText(full: string, name: string): Promise<{ text: string; mime: string }> {
  const stat = await fs.stat(full);
  if (stat.size > MAX_READ_BYTES) {
    throw new BreezeError("validation", `File exceeds ${MAX_READ_BYTES} bytes`);
  }
  const mime = mimeFor(name);
  if (mime === "application/octet-stream") {
    throw new BreezeError("validation", `Cannot read binary file ${name}`);
  }
  const text = await fs.readFile(full, "utf8");
  return { text, mime };
}

// ── Capabilities ──────────────────────────────────────────────────────

const listFiles: ConnectorCapability = {
  key: "files.list_files",
  displayName: "List files",
  description: "Lists files in the user's uploaded folder.",
  sensitivity: "none",
  mutatesState: false,
  approvalHint: "never",
  idempotent: true,
  inputSchema: z.object({ prefix: z.string().optional() }),
  outputSchema: z.object({
    files: z.array(z.object({ key: z.string(), name: z.string(), size: z.number(), modified: z.string() })),
  }),
  execute: async (input, ctx) => {
    const { prefix } = input as { prefix?: string };
    const root = userRoot(ctx);
    await ensureDir(root);
    return { files: await walk(root, prefix ?? "") };
  },
};

const readFile: ConnectorCapability = {
  key: "files.read_file",
  displayName: "Read file",
  description: "Returns the parsed textual contents of a file.",
  sensitivity: "low",
  mutatesState: false,
  approvalHint: "never",
  idempotent: true,
  inputSchema: z.object({ key: z.string() }),
  outputSchema: z.object({ name: z.string(), text: z.string(), mime: z.string() }),
  execute: async (input, ctx) => {
    const { key } = input as { key: string };
    const root = userRoot(ctx);
    const full = resolveKey(root, key);
    try {
      const { text, mime } = await readText(full, path.basename(full));
      return { name: path.basename(full), text, mime };
    } catch (err) {
      if ((err as { code?: string }).code === "ENOENT") {
        throw new BreezeError("not_found", `File not found: ${key}`);
      }
      throw err;
    }
  },
};

const summarizeFile: ConnectorCapability = {
  key: "files.summarize_file",
  displayName: "Summarize file",
  description: "Generates a summary of a file's contents.",
  sensitivity: "low",
  mutatesState: false,
  approvalHint: "never",
  idempotent: false,
  inputSchema: z.object({ key: z.string() }),
  outputSchema: z.object({ summary: z.string() }),
  execute: async (input, ctx) => {
    const { key } = input as { key: string };
    const root = userRoot(ctx);
    const full = resolveKey(root, key);
    try {
      const { text } = await readText(full, path.basename(full));
      const head = text.slice(0, MAX_SUMMARY_CHARS);
      const truncated = text.length > MAX_SUMMARY_CHARS;
      // Deterministic local "summary": first non-empty lines. The AI-backed
      // summarizer is layered on top by the planner when appropriate.
      const lines = head.split(/\r?\n/).map((l) => l.trim()).filter(Boolean).slice(0, 10);
      const summary = lines.join(" · ") + (truncated ? " …" : "");
      return { summary };
    } catch (err) {
      if ((err as { code?: string }).code === "ENOENT") {
        throw new BreezeError("not_found", `File not found: ${key}`);
      }
      throw err;
    }
  },
};

const moveFile: ConnectorCapability = {
  key: "files.move_file",
  displayName: "Move file",
  description: "Moves a file within the user's storage.",
  sensitivity: "medium",
  mutatesState: true,
  approvalHint: "sometimes",
  idempotent: true,
  inputSchema: z.object({ key: z.string(), toKey: z.string() }),
  outputSchema: z.object({ ok: z.boolean() }),
  execute: async (input, ctx) => {
    const { key, toKey } = input as { key: string; toKey: string };
    if (key === toKey) return { ok: true };
    const root = userRoot(ctx);
    const src = resolveKey(root, key);
    const dst = resolveKey(root, toKey);
    try {
      await ensureDir(path.dirname(dst));
      await fs.rename(src, dst);
    } catch (err) {
      const code = (err as { code?: string }).code;
      if (code === "ENOENT") throw new BreezeError("not_found", `File not found: ${key}`);
      if (code === "EEXIST") throw new BreezeError("conflict", `Destination already exists: ${toKey}`);
      throw err;
    }
    return { ok: true };
  },
};

const deleteFile: ConnectorCapability = {
  key: "files.delete_file",
  displayName: "Delete file",
  description: "Permanently deletes a file.",
  sensitivity: "critical",
  mutatesState: true,
  approvalHint: "always",
  idempotent: true,
  inputSchema: z.object({ key: z.string() }),
  outputSchema: z.object({ ok: z.boolean() }),
  execute: async (input, ctx) => {
    const { key } = input as { key: string };
    const root = userRoot(ctx);
    const full = resolveKey(root, key);
    try {
      await fs.unlink(full);
    } catch (err) {
      const code = (err as { code?: string }).code;
      if (code === "ENOENT") return { ok: true }; // idempotent
      throw err;
    }
    return { ok: true };
  },
};

const files: Connector = {
  meta: {
    key: "files",
    displayName: "Files",
    description: "Your uploaded documents and notes.",
    version: "1.0.0",
    icon: "/icons/files.svg",
    oauth: {
      provider: "local",
      scopes: [],
      consentUrlFactory: () => "/connectors/files/connect",
      exchangeCode: async () => ({ accessToken: "local", raw: {} }),
    },
  },
  healthCheck: async (ctx) => {
    try {
      const root = userRoot(ctx);
      await ensureDir(root);
      return { ok: true, message: `root=${root}` };
    } catch (err) {
      return { ok: false, message: err instanceof Error ? err.message : String(err) };
    }
  },
  capabilities: [listFiles, readFile, summarizeFile, moveFile, deleteFile],
};

registerConnector(files);
export default files;
