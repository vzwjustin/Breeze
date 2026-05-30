import { z } from "zod";
import { BreezeError, newId } from "@breeze/common";
import { registerConnector } from "../registry.js";
import type { Connector, ConnectorCapability, ConnectorTokens } from "../types.js";
import { httpJson, requireEnv, env } from "../http.js";

const API = "https://api.github.com";
const GH_HEADERS = {
  "X-GitHub-Api-Version": "2022-11-28",
  Accept: "application/vnd.github+json",
};

/** In-process draft store until artifacts are wired through the broker. */
const commentDrafts = new Map<string, { repo: string; number: number; body: string }>();

function splitRepo(repo: string): { owner: string; name: string } {
  const [owner, name] = repo.split("/");
  if (!owner || !name) throw new BreezeError("validation", `repo must be "owner/name", got "${repo}"`);
  return { owner, name };
}

// ── Capabilities ──────────────────────────────────────────────────────

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
  execute: async (input, ctx) => {
    const { unreadOnly } = input as { unreadOnly: boolean };
    const rows = await httpJson<
      Array<{
        id: string;
        subject: { title: string; url: string };
        repository: { full_name: string };
        reason: string;
      }>
    >({
      url: `${API}/notifications`,
      query: { all: (!unreadOnly).toString() },
      headers: GH_HEADERS,
      bearer: ctx.tokens.accessToken,
      signal: ctx.signal,
    });
    return {
      notifications: rows.map((n) => ({
        id: n.id,
        subject: n.subject.title,
        repo: n.repository.full_name,
        url: n.subject.url,
        reason: n.reason,
      })),
    };
  },
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
  execute: async (input, ctx) => {
    const { repo, number } = input as { repo: string; number: number };
    const { owner, name } = splitRepo(repo);
    const [issue, comments] = await Promise.all([
      httpJson<{ title: string; body: string | null; state: string }>({
        url: `${API}/repos/${owner}/${name}/issues/${number}`,
        headers: GH_HEADERS,
        bearer: ctx.tokens.accessToken,
        signal: ctx.signal,
      }),
      httpJson<Array<{ user: { login: string } | null; body: string | null }>>({
        url: `${API}/repos/${owner}/${name}/issues/${number}/comments`,
        query: { per_page: 50 },
        headers: GH_HEADERS,
        bearer: ctx.tokens.accessToken,
        signal: ctx.signal,
      }),
    ]);
    return {
      title: issue.title,
      body: issue.body ?? "",
      state: issue.state,
      comments: comments.map((c) => ({ author: c.user?.login ?? "ghost", body: c.body ?? "" })),
    };
  },
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
  execute: async (input) => {
    const { repo, number, body } = input as { repo: string; number: number; body: string };
    if (!body.trim()) throw new BreezeError("validation", "Comment body is empty");
    const artifactId = newId();
    commentDrafts.set(artifactId, { repo, number, body: body.trim() });
    return { artifactId };
  },
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
    body: z.string().optional(),
    artifactId: z.string().optional(),
  }),
  outputSchema: z.object({ commentId: z.string() }),
  execute: async (input, ctx) => {
    const parsed = input as { repo: string; number: number; body?: string; artifactId?: string };
    let body = parsed.body?.trim();
    if (parsed.artifactId) {
      const draft = commentDrafts.get(parsed.artifactId);
      if (!draft) throw new BreezeError("not_found", `Draft ${parsed.artifactId} not found`);
      if (draft.repo !== parsed.repo || draft.number !== parsed.number) {
        throw new BreezeError("validation", "Draft does not match repo/number");
      }
      body = draft.body;
      commentDrafts.delete(parsed.artifactId);
    }
    if (!body) throw new BreezeError("validation", "Comment body is empty");
    const { repo, number } = parsed;
    const { owner, name } = splitRepo(repo);
    const res = await httpJson<{ id: number }>({
      url: `${API}/repos/${owner}/${name}/issues/${number}/comments`,
      method: "POST",
      headers: GH_HEADERS,
      bearer: ctx.tokens.accessToken,
      body: { body },
      signal: ctx.signal,
    });
    return { commentId: String(res.id) };
  },
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
  execute: async (input, ctx) => {
    const { repo, state } = input as { repo: string; state: "open" | "closed" | "all" };
    const { owner, name } = splitRepo(repo);
    const rows = await httpJson<
      Array<{ number: number; title: string; state: string; user: { login: string } | null }>
    >({
      url: `${API}/repos/${owner}/${name}/pulls`,
      query: { state, per_page: 50 },
      headers: GH_HEADERS,
      bearer: ctx.tokens.accessToken,
      signal: ctx.signal,
    });
    return {
      pullRequests: rows.map((p) => ({
        number: p.number,
        title: p.title,
        author: p.user?.login ?? "ghost",
        state: p.state,
      })),
    };
  },
};

// ── OAuth ─────────────────────────────────────────────────────────────

const OAUTH_AUTHORIZE = "https://github.com/login/oauth/authorize";
const OAUTH_TOKEN = "https://github.com/login/oauth/access_token";

function consentUrl(state: string): string {
  const clientId = requireEnv("GITHUB_CLIENT_ID");
  const redirectUri = requireEnv("GITHUB_REDIRECT_URI");
  const scopes = (env("GITHUB_OAUTH_SCOPES") ?? "notifications,repo").split(",").map((s) => s.trim()).join(" ");
  const u = new URL(OAUTH_AUTHORIZE);
  u.searchParams.set("client_id", clientId);
  u.searchParams.set("redirect_uri", redirectUri);
  u.searchParams.set("scope", scopes);
  u.searchParams.set("state", state);
  u.searchParams.set("allow_signup", "false");
  return u.toString();
}

async function exchangeCode(code: string): Promise<ConnectorTokens> {
  const clientId = requireEnv("GITHUB_CLIENT_ID");
  const clientSecret = requireEnv("GITHUB_CLIENT_SECRET");
  const redirectUri = requireEnv("GITHUB_REDIRECT_URI");
  const res = await fetch(OAUTH_TOKEN, {
    method: "POST",
    headers: { Accept: "application/json", "Content-Type": "application/json" },
    body: JSON.stringify({ client_id: clientId, client_secret: clientSecret, code, redirect_uri: redirectUri }),
  });
  if (!res.ok) throw new BreezeError("auth", `GitHub token exchange failed: ${res.status}`);
  const json = (await res.json()) as {
    access_token?: string;
    refresh_token?: string;
    expires_in?: number;
    refresh_token_expires_in?: number;
    error?: string;
    error_description?: string;
  };
  if (json.error || !json.access_token) {
    throw new BreezeError("auth", `GitHub token exchange rejected: ${json.error_description ?? json.error ?? "unknown"}`);
  }
  return {
    accessToken: json.access_token,
    refreshToken: json.refresh_token,
    expiresAt: json.expires_in ? new Date(Date.now() + json.expires_in * 1000) : undefined,
    raw: json as Record<string, unknown>,
  };
}

// ── Connector ─────────────────────────────────────────────────────────

const github: Connector = {
  meta: {
    key: "github",
    displayName: "GitHub",
    description: "Read notifications, PRs and issues. Draft and post comments.",
    version: "1.0.0",
    icon: "/icons/github.svg",
    oauth: {
      provider: "github",
      scopes: ["notifications", "repo"],
      consentUrlFactory: consentUrl,
      exchangeCode,
    },
  },
  healthCheck: async (ctx) => {
    try {
      const me = await httpJson<{ login: string }>({
        url: `${API}/user`,
        headers: GH_HEADERS,
        bearer: ctx.tokens.accessToken,
        signal: ctx.signal,
      });
      return { ok: true, message: `authenticated as @${me.login}` };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return { ok: false, message: msg };
    }
  },
  capabilities: [listNotifications, readIssue, draftComment, postComment, listPullRequests],
};

registerConnector(github);
export default github;
