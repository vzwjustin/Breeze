import { z } from "zod";
import { BreezeError } from "@breeze/common";
import { registerConnector } from "../registry.js";
import type { Connector, ConnectorCapability } from "../types.js";

// ── capabilities ──────────────────────────────────────────────────────
const listThreads: ConnectorCapability = {
  key: "gmail.list_threads",
  displayName: "List Gmail threads",
  description: "Lists recent email threads matching a query.",
  sensitivity: "none",
  mutatesState: false,
  approvalHint: "never",
  idempotent: true,
  inputSchema: z.object({ query: z.string().optional(), maxResults: z.number().int().min(1).max(100).default(25) }),
  outputSchema: z.object({
    threads: z.array(z.object({ id: z.string(), snippet: z.string(), unread: z.boolean() })),
  }),
  execute: async (_input, _ctx) => {
    throw new BreezeError("unknown", "gmail.list_threads not implemented");
  },
};

const readMessage: ConnectorCapability = {
  key: "gmail.read_message",
  displayName: "Read Gmail message",
  description: "Reads the full body of a message.",
  sensitivity: "low",
  mutatesState: false,
  approvalHint: "never",
  idempotent: true,
  inputSchema: z.object({ messageId: z.string() }),
  outputSchema: z.object({ id: z.string(), from: z.string(), subject: z.string(), body: z.string() }),
  execute: async (_input, _ctx) => {
    throw new BreezeError("unknown", "gmail.read_message not implemented");
  },
};

const draftReply: ConnectorCapability = {
  key: "gmail.draft_reply",
  displayName: "Draft reply",
  description: "Creates a Gmail draft in reply to a thread.",
  sensitivity: "low",
  mutatesState: false,
  approvalHint: "never",
  idempotent: false,
  inputSchema: z.object({ threadId: z.string(), body: z.string() }),
  outputSchema: z.object({ draftId: z.string() }),
  execute: async (_input, _ctx) => {
    throw new BreezeError("unknown", "gmail.draft_reply not implemented");
  },
};

const sendReply: ConnectorCapability = {
  key: "gmail.send_reply",
  displayName: "Send reply",
  description: "Sends a reply on a thread.",
  sensitivity: "high",
  mutatesState: true,
  approvalHint: "always",
  idempotent: false,
  inputSchema: z.object({ threadId: z.string(), body: z.string() }),
  outputSchema: z.object({ messageId: z.string() }),
  execute: async (_input, _ctx) => {
    throw new BreezeError("unknown", "gmail.send_reply not implemented");
  },
};

const archiveThread: ConnectorCapability = {
  key: "gmail.archive_thread",
  displayName: "Archive thread",
  description: "Archives a thread.",
  sensitivity: "medium",
  mutatesState: true,
  approvalHint: "sometimes",
  idempotent: true,
  inputSchema: z.object({ threadId: z.string() }),
  outputSchema: z.object({ ok: z.boolean() }),
  execute: async (_input, _ctx) => {
    throw new BreezeError("unknown", "gmail.archive_thread not implemented");
  },
};

const labelThread: ConnectorCapability = {
  key: "gmail.label_thread",
  displayName: "Label thread",
  description: "Applies/removes labels on a thread.",
  sensitivity: "low",
  mutatesState: true,
  approvalHint: "never",
  idempotent: true,
  inputSchema: z.object({
    threadId: z.string(),
    addLabels: z.array(z.string()).optional(),
    removeLabels: z.array(z.string()).optional(),
  }),
  outputSchema: z.object({ ok: z.boolean() }),
  execute: async (_input, _ctx) => {
    throw new BreezeError("unknown", "gmail.label_thread not implemented");
  },
};

const deleteThread: ConnectorCapability = {
  key: "gmail.delete_thread",
  displayName: "Delete thread",
  description: "Moves a thread to trash. Irreversible after 30 days.",
  sensitivity: "critical",
  mutatesState: true,
  approvalHint: "always",
  idempotent: true,
  inputSchema: z.object({ threadId: z.string() }),
  outputSchema: z.object({ ok: z.boolean() }),
  execute: async (_input, _ctx) => {
    throw new BreezeError("unknown", "gmail.delete_thread not implemented");
  },
};

const gmail: Connector = {
  meta: {
    key: "gmail",
    displayName: "Gmail",
    description: "Read and manage your Gmail.",
    version: "1.0.0",
    icon: "/icons/gmail.svg",
    oauth: {
      provider: "google",
      scopes: ["https://www.googleapis.com/auth/gmail.modify"],
      consentUrlFactory: (_state) => {
        throw new BreezeError("unknown", "Gmail OAuth not wired yet");
      },
      exchangeCode: async (_code) => {
        throw new BreezeError("unknown", "Gmail OAuth not wired yet");
      },
    },
  },
  healthCheck: async (_ctx) => ({ ok: false, message: "Gmail healthcheck not implemented" }),
  capabilities: [listThreads, readMessage, draftReply, sendReply, archiveThread, labelThread, deleteThread],
};

registerConnector(gmail);
export default gmail;
