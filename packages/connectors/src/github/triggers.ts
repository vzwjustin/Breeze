import { z } from "zod";
import { registerTrigger, type ConnectorTrigger } from "../triggers.js";
import { httpJson } from "../http.js";

const API = "https://api.github.com";
const GH_HEADERS = {
  "X-GitHub-Api-Version": "2022-11-28",
  Accept: "application/vnd.github+json",
};

interface GhNotification {
  id: string;
  updated_at: string;
  reason: string;
  subject: { title: string; url: string; type: string };
  repository: { full_name: string };
}

interface GhNotificationItem {
  notificationId: string;
  reason: string;
  repo: string;
  subject: string;
  subjectType: string;
  url: string;
  updatedAt: string;
}

/**
 * github.new_notification — yields unread notifications updated after
 * `since` (ISO cursor). Uses GitHub's native `since` filter.
 */
const newNotification: ConnectorTrigger<{ onlyParticipating?: boolean }, GhNotificationItem> = {
  key: "github.new_notification",
  connector: "github",
  displayName: "New GitHub notification",
  description: "Fires for each unread notification (issues, PRs, mentions, reviews).",
  itemShape: "{ notificationId, reason, repo, subject, subjectType, url, updatedAt }",
  inputSchema: z.object({ onlyParticipating: z.boolean().default(false) }),
  async poll({ input, cursor, ctx }) {
    const since = cursor ?? new Date().toISOString();
    const rows = await httpJson<GhNotification[]>({
      url: `${API}/notifications`,
      query: {
        all: "false",
        participating: input.onlyParticipating ? "true" : "false",
        since,
        per_page: 50,
      },
      headers: GH_HEADERS,
      bearer: ctx.tokens.accessToken,
      signal: ctx.signal,
    });

    const items = rows.map((n) => ({
      key: n.id,
      data: {
        notificationId: n.id,
        reason: n.reason,
        repo: n.repository.full_name,
        subject: n.subject.title,
        subjectType: n.subject.type,
        url: n.subject.url,
        updatedAt: n.updated_at,
      },
    }));

    const newest = rows.reduce((acc, n) => (n.updated_at > acc ? n.updated_at : acc), since);
    return { items, cursor: newest };
  },
};

registerTrigger(newNotification);
