import { z } from "zod";
import { BreezeError } from "@breeze/common";
import { registerConnector } from "../registry.js";
import type { Connector, ConnectorCapability } from "../types.js";
import { httpJson } from "../http.js";
import { googleConsentUrl, googleExchangeCode, googleRefresh } from "../google-oauth.js";

const API = "https://gmail.googleapis.com/gmail/v1/users/me";
const SCOPES = ["https://www.googleapis.com/auth/gmail.modify"];

function b64urlEncode(input: string): string {
  const bytes = new TextEncoder().encode(input);
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  // btoa is part of the standard DOM lib referenced in tsconfig.base.
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function b64urlDecode(input: string): string {
  const padded = input.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(input.length / 4) * 4, "=");
  const bin = atob(padded);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new TextDecoder("utf-8").decode(bytes);
}

function parseMessage(msg: {
  id: string;
  payload?: { headers?: Array<{ name: string; value: string }>; parts?: unknown[]; body?: { data?: string } };
}): { id: string; from: string; subject: string; body: string } {
  const headers = msg.payload?.headers ?? [];
  const get = (n: string) => headers.find((h) => h.name.toLowerCase() === n.toLowerCase())?.value ?? "";

  const walk = (p: unknown): string => {
    const part = p as {
      mimeType?: string;
      body?: { data?: string };
      parts?: unknown[];
    };
    if (part.mimeType === "text/plain" && part.body?.data) return b64urlDecode(part.body.data);
    if (part.parts) {
      for (const sub of part.parts) {
        const t = walk(sub);
        if (t) return t;
      }
    }
    if (part.mimeType === "text/html" && part.body?.data) return b64urlDecode(part.body.data);
    return "";
  };

  const body = msg.payload ? walk(msg.payload) : "";
  return { id: msg.id, from: get("from"), subject: get("subject"), body };
}

function sanitizeHeaderValue(v: string): string {
  if (/[\r\n\0]/.test(v)) {
    throw new BreezeError("validation", "Header injection detected");
  }
  return v;
}

// ── Capabilities ──────────────────────────────────────────────────────

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
  execute: async (input, ctx) => {
    const { query, maxResults } = input as { query?: string; maxResults: number };
    const list = await httpJson<{ threads?: Array<{ id: string; snippet: string; historyId: string }> }>({
      url: `${API}/threads`,
      query: { q: query, maxResults },
      bearer: ctx.tokens.accessToken,
      signal: ctx.signal,
    });
    const threads = list.threads ?? [];
    const enriched = await Promise.all(
      threads.map(async (t) => {
        const full = await httpJson<{
          id: string;
          snippet: string;
          messages?: Array<{ labelIds?: string[] }>;
        }>({
          url: `${API}/threads/${t.id}`,
          query: { format: "minimal" },
          bearer: ctx.tokens.accessToken,
          signal: ctx.signal,
        });
        const unread = (full.messages ?? []).some((m) => (m.labelIds ?? []).includes("UNREAD"));
        return { id: full.id, snippet: full.snippet ?? "", unread };
      })
    );
    return { threads: enriched };
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
  execute: async (input, ctx) => {
    const { messageId } = input as { messageId: string };
    const msg = await httpJson<Parameters<typeof parseMessage>[0]>({
      url: `${API}/messages/${messageId}`,
      query: { format: "full" },
      bearer: ctx.tokens.accessToken,
      signal: ctx.signal,
    });
    return parseMessage(msg);
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
  execute: async (input, ctx) => {
    const { threadId, body } = input as { threadId: string; body: string };
    // Resolve thread root to build a proper reply (In-Reply-To + subject).
    const thread = await httpJson<{
      messages?: Array<{ id: string; payload?: { headers?: Array<{ name: string; value: string }> } }>;
    }>({
      url: `${API}/threads/${threadId}`,
      query: { format: "metadata", metadataHeaders: "From,Subject,Message-ID,References" },
      bearer: ctx.tokens.accessToken,
      signal: ctx.signal,
    });
    const last = thread.messages?.[thread.messages.length - 1];
    if (!last) throw new BreezeError("not_found", `Thread ${threadId} has no messages`);
    const headers = last.payload?.headers ?? [];
    const get = (n: string) => headers.find((h) => h.name.toLowerCase() === n.toLowerCase())?.value ?? "";
    const to = sanitizeHeaderValue(get("From"));
    const subject = sanitizeHeaderValue(get("Subject"));
    const inReplyTo = sanitizeHeaderValue(get("Message-ID"));
    const references = sanitizeHeaderValue([get("References"), inReplyTo].filter(Boolean).join(" "));

    const raw = b64urlEncode(
      [
        `To: ${to}`,
        `Subject: ${subject.startsWith("Re:") ? subject : `Re: ${subject}`}`,
        inReplyTo ? `In-Reply-To: ${inReplyTo}` : "",
        references ? `References: ${references}` : "",
        "Content-Type: text/plain; charset=UTF-8",
        "MIME-Version: 1.0",
        "",
        body,
      ]
        .filter(Boolean)
        .join("\r\n")
    );

    const created = await httpJson<{ id: string }>({
      url: `${API}/drafts`,
      method: "POST",
      bearer: ctx.tokens.accessToken,
      body: { message: { threadId, raw } },
      signal: ctx.signal,
    });
    return { draftId: created.id };
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
  execute: async (input, ctx) => {
    const { threadId, body } = input as { threadId: string; body: string };
    const thread = await httpJson<{
      messages?: Array<{ payload?: { headers?: Array<{ name: string; value: string }> } }>;
    }>({
      url: `${API}/threads/${threadId}`,
      query: { format: "metadata", metadataHeaders: "From,Subject,Message-ID,References" },
      bearer: ctx.tokens.accessToken,
      signal: ctx.signal,
    });
    const last = thread.messages?.[thread.messages.length - 1];
    if (!last) throw new BreezeError("not_found", `Thread ${threadId} has no messages`);
    const headers = last.payload?.headers ?? [];
    const get = (n: string) => headers.find((h) => h.name.toLowerCase() === n.toLowerCase())?.value ?? "";
    const to = sanitizeHeaderValue(get("From"));
    const subject = sanitizeHeaderValue(get("Subject"));
    const inReplyTo = sanitizeHeaderValue(get("Message-ID"));
    const references = sanitizeHeaderValue([get("References"), inReplyTo].filter(Boolean).join(" "));
    const raw = b64urlEncode(
      [
        `To: ${to}`,
        `Subject: ${subject.startsWith("Re:") ? subject : `Re: ${subject}`}`,
        inReplyTo ? `In-Reply-To: ${inReplyTo}` : "",
        references ? `References: ${references}` : "",
        "Content-Type: text/plain; charset=UTF-8",
        "MIME-Version: 1.0",
        "",
        body,
      ]
        .filter(Boolean)
        .join("\r\n")
    );
    const sent = await httpJson<{ id: string }>({
      url: `${API}/messages/send`,
      method: "POST",
      bearer: ctx.tokens.accessToken,
      body: { threadId, raw },
      signal: ctx.signal,
    });
    return { messageId: sent.id };
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
  execute: async (input, ctx) => {
    const { threadId } = input as { threadId: string };
    await httpJson({
      url: `${API}/threads/${threadId}/modify`,
      method: "POST",
      bearer: ctx.tokens.accessToken,
      body: { removeLabelIds: ["INBOX"] },
      signal: ctx.signal,
    });
    return { ok: true };
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
  execute: async (input, ctx) => {
    const { threadId, addLabels, removeLabels } = input as {
      threadId: string;
      addLabels?: string[];
      removeLabels?: string[];
    };
    if (!addLabels?.length && !removeLabels?.length) {
      throw new BreezeError("validation", "At least one of addLabels or removeLabels is required");
    }
    await httpJson({
      url: `${API}/threads/${threadId}/modify`,
      method: "POST",
      bearer: ctx.tokens.accessToken,
      body: {
        addLabelIds: addLabels,
        removeLabelIds: removeLabels,
      },
      signal: ctx.signal,
    });
    return { ok: true };
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
  execute: async (input, ctx) => {
    const { threadId } = input as { threadId: string };
    await httpJson({
      url: `${API}/threads/${threadId}/trash`,
      method: "POST",
      bearer: ctx.tokens.accessToken,
      signal: ctx.signal,
    });
    return { ok: true };
  },
};

// ── Connector ─────────────────────────────────────────────────────────

const gmail: Connector = {
  meta: {
    key: "gmail",
    displayName: "Gmail",
    description: "Read and manage your Gmail.",
    version: "1.0.0",
    icon: "/icons/gmail.svg",
    oauth: {
      provider: "google",
      scopes: SCOPES,
      consentUrlFactory: (state) => googleConsentUrl(state, SCOPES),
      exchangeCode: googleExchangeCode,
      refresh: googleRefresh,
    },
  },
  healthCheck: async (ctx) => {
    try {
      const profile = await httpJson<{ emailAddress?: string }>({
        url: `${API}/profile`,
        bearer: ctx.tokens.accessToken,
        signal: ctx.signal,
      });
      return { ok: true, message: profile.emailAddress ? `authenticated as ${profile.emailAddress}` : "ok" };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return { ok: false, message: msg };
    }
  },
  capabilities: [listThreads, readMessage, draftReply, sendReply, archiveThread, labelThread, deleteThread],
};

registerConnector(gmail);
export default gmail;
