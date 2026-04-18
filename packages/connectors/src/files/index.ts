import { z } from "zod";
import { BreezeError } from "@breeze/common";
import { registerConnector } from "../registry.js";
import type { Connector, ConnectorCapability } from "../types.js";

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
  execute: async () => { throw new BreezeError("unknown", "files.list_files not implemented"); },
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
  execute: async () => { throw new BreezeError("unknown", "files.read_file not implemented"); },
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
  execute: async () => { throw new BreezeError("unknown", "files.summarize_file not implemented"); },
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
  execute: async () => { throw new BreezeError("unknown", "files.move_file not implemented"); },
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
  execute: async () => { throw new BreezeError("unknown", "files.delete_file not implemented"); },
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
  healthCheck: async () => ({ ok: true }),
  capabilities: [listFiles, readFile, summarizeFile, moveFile, deleteFile],
};

registerConnector(files);
export default files;
