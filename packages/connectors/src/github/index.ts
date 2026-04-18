import { z } from "zod";
import { BreezeError } from "@breeze/common";
import { registerConnector } from "../registry.js";
import type { Connector, ConnectorCapability } from "../types.js";

const listNotifications: ConnectorCapability = {
  key: "github.list_notifications",
  displayName: "List GitHub notifications",
  description: "Fetches unread notifications.",
  sensitivity: "none",
  mutatesState: false,
  approvalHint: "never",
  idempotent: true,
  inputSchema: z.object({ unreadOnly: z.boolean().default(true) }),
  outputSchema: z.object({
    notifications: z.array(
      z.object({
        id: z.string(),
        subject: z.string(),
        repo: z.string(),
        url: z.string(),
        reason: z.string(),
      })
    ),
  }),
  execute: async () => { throw new BreezeError("unknown", "github.list_notifications not implemented"); },
};

const readIssue: ConnectorCapability = {
  key: "github.read_issue",
  displayName: "Read issue or PR",
  description: "Reads an issue or pull request with recent comments.",
  sensitivity: "none",
  mutatesState: false,
  approvalHint: "never",
  idempotent: true,
  inputSchema: z.object({
    repo: z.string(),
    number: z.number().int().positive(),
  }),
  outputSchema: z.object({
    title: z.string(),
    body: z.string(),
    state: z.string(),
    comments: z.array(z.object({ author: z.string(), body: z.string() })),
  }),
  execute: async () => { throw new BreezeError("unknown", "github.read_issue not implemented"); },
};

const draftComment: ConnectorCapability = {
  key: "github.draft_comment",
  displayName: "Draft comment",
  description: "Creates a draft comment (not posted).",
  sensitivity: "low",
  mutatesState: false,
  approvalHint: "never",
  idempotent: false,
  inputSchema: z.object({
    repo: z.string(),
    number: z.number().int().positive(),
    body: z.string(),
  }),
  outputSchema: z.object({ artifactId: z.string() }),
  execute: async () => { throw new BreezeError("unknown", "github.draft_comment not implemented"); },
};

const postComment: ConnectorCapability = {
  key: "github.post_comment",
  displayName: "Post comment",
  description: "Posts a comment publicly on an issue or PR.",
  sensitivity: "high",
  mutatesState: true,
  approvalHint: "always",
  idempotent: false,
  inputSchema: z.object({
    repo: z.string(),
    number: z.number().int().positive(),
    body: z.string(),
  }),
  outputSchema: z.object({ commentId: z.string() }),
  execute: async () => { throw new BreezeError("unknown", "github.post_comment not implemented"); },
};

const listPullRequests: ConnectorCapability = {
  key: "github.list_pull_requests",
  displayName: "List pull requests",
  description: "Lists recent PRs in a repo.",
  sensitivity: "none",
  mutatesState: false,
  approvalHint: "never",
  idempotent: true,
  inputSchema: z.object({
    repo: z.string(),
    state: z.enum(["open", "closed", "all"]).default("open"),
  }),
  outputSchema: z.object({
    pullRequests: z.array(
      z.object({
        number: z.number(),
        title: z.string(),
        author: z.string(),
        state: z.string(),
      })
    ),
  }),
  execute: async () => { throw new BreezeError("unknown", "github.list_pull_requests not implemented"); },
};

const github: Connector = {
  meta: {
    key: "github",
    displayName: "GitHub",
    description: "Read notifications, PRs and issues. Draft and post comments.",
    version: "1.0.0",
    icon: "/icons/github.svg",
    oauth: {
      provider: "github",
      scopes: ["notifications", "repo:read", "repo:write"],
      consentUrlFactory: (_s) => { throw new BreezeError("unknown", "github OAuth not wired"); },
      exchangeCode: async (_c) => { throw new BreezeError("unknown", "github OAuth not wired"); },
    },
  },
  healthCheck: async () => ({ ok: false, message: "github healthcheck not implemented" }),
  capabilities: [listNotifications, readIssue, draftComment, postComment, listPullRequests],
};

registerConnector(github);
export default github;
