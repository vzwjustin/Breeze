import { z } from "zod";
import { registerTrigger, type ConnectorTrigger } from "../triggers.js";
import { httpJson } from "../http.js";

const API = "https://gmail.googleapis.com/gmail/v1/users/me";

interface GmailThread {
  id: string;
  snippet: string;
  historyId: string;
}

interface GmailNewThreadItem {
  threadId: string;
  snippet: string;
  from: string;
  subject: string;
  receivedAt: string;
}

/**
 * gmail.new_thread — yields threads whose most recent message is newer
 * than the cursor (a Unix-seconds timestamp). On first run, emits the
 * current window only and advances the cursor so we don't flood the
 * action side with history.
 */
const newThread: ConnectorTrigger<{ query?: string }, GmailNewThreadItem> = {
  key: "gmail.new_thread",
  connector: "gmail",
  displayName: "New email thread",
  description: "Fires when a thread matching the query receives a new message.",
  itemShape: "{ threadId, snippet, from, subject, receivedAt }",
  inputSchema: z.object({ query: z.string().optional() }),
  async poll({ input, cursor, ctx }) {
    const sinceSeconds = cursor ? Number(cursor) : Math.floor(Date.now() / 1000);
    const query = [input.query, `after:${sinceSeconds}`].filter(Boolean).join(" ");

    const list = await httpJson<{ threads?: GmailThread[] }>({
      url: `${API}/threads`,
      query: { q: query, maxResults: 25 },
      bearer: ctx.tokens.accessToken,
      signal: ctx.signal,
    });
    const threads = list.threads ?? [];

    const items: Array<{ key: string; data: GmailNewThreadItem }> = [];
    let newestSeconds = sinceSeconds;

    for (const t of threads) {
      const full = await httpJson<{
        id: string;
        messages?: Array<{
          id: string;
          internalDate?: string;
          payload?: { headers?: Array<{ name: string; value: string }> };
        }>;
      }>({
        url: `${API}/threads/${t.id}`,
        query: { format: "metadata", metadataHeaders: "From,Subject" },
        bearer: ctx.tokens.accessToken,
        signal: ctx.signal,
      });
      const latest = (full.messages ?? []).at(-1);
      if (!latest) continue;
      const internalMs = Number(latest.internalDate ?? 0);
      const seconds = Math.floor(internalMs / 1000);
      if (seconds <= sinceSeconds) continue;
      const headers = latest.payload?.headers ?? [];
      const get = (n: string) => headers.find((h) => h.name.toLowerCase() === n.toLowerCase())?.value ?? "";
      items.push({
        key: `${t.id}:${latest.id}`,
        data: {
          threadId: t.id,
          snippet: t.snippet,
          from: get("From"),
          subject: get("Subject"),
          receivedAt: new Date(internalMs).toISOString(),
        },
      });
      if (seconds > newestSeconds) newestSeconds = seconds;
    }

    return { items, cursor: String(newestSeconds) };
  },
};

registerTrigger(newThread);
