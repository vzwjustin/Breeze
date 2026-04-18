import { z } from "zod";
import { registerTrigger, type ConnectorTrigger } from "../triggers.js";
import { httpJson } from "../http.js";

const API = "https://www.googleapis.com/calendar/v3";

interface GCalEvent {
  id: string;
  summary?: string;
  start?: { dateTime?: string; date?: string };
  end?: { dateTime?: string; date?: string };
  attendees?: Array<{ email?: string; responseStatus?: string }>;
  location?: string;
}

interface GCalEventStartingItem {
  eventId: string;
  summary: string;
  start: string;
  end: string;
  location: string;
  attendees: string[];
}

/**
 * gcal.event_starting_in — yields events whose start is within the next
 * `withinMinutes` minutes and hasn't been emitted before. Cursor is the
 * newest event start we've emitted; we never re-emit an event id.
 */
const eventStartingIn: ConnectorTrigger<{ calendarId?: string; withinMinutes?: number }, GCalEventStartingItem> = {
  key: "gcal.event_starting_in",
  connector: "gcal",
  displayName: "Event starting soon",
  description: "Fires for each event whose start is within the configured window.",
  itemShape: "{ eventId, summary, start, end, location, attendees }",
  inputSchema: z.object({
    calendarId: z.string().default("primary"),
    withinMinutes: z.number().int().min(1).max(24 * 60).default(15),
  }),
  async poll({ input, cursor, ctx }) {
    const calendarId = input.calendarId ?? "primary";
    const withinMinutes = input.withinMinutes ?? 15;
    const now = Date.now();
    const cursorMs = cursor ? Number(cursor) : 0;
    const timeMin = new Date(Math.max(now, cursorMs + 1)).toISOString();
    const timeMax = new Date(now + withinMinutes * 60 * 1000).toISOString();

    const data = await httpJson<{ items?: GCalEvent[] }>({
      url: `${API}/calendars/${encodeURIComponent(calendarId)}/events`,
      query: { timeMin, timeMax, singleEvents: "true", orderBy: "startTime", maxResults: 50 },
      bearer: ctx.tokens.accessToken,
      signal: ctx.signal,
    });

    const items: Array<{ key: string; data: GCalEventStartingItem }> = [];
    let newest = cursorMs;

    for (const e of data.items ?? []) {
      const startIso = e.start?.dateTime ?? e.start?.date;
      const endIso = e.end?.dateTime ?? e.end?.date;
      if (!startIso) continue;
      const startMs = new Date(startIso).getTime();
      if (startMs <= cursorMs) continue;
      items.push({
        key: `${e.id}@${startMs}`,
        data: {
          eventId: e.id,
          summary: e.summary ?? "(no title)",
          start: startIso,
          end: endIso ?? startIso,
          location: e.location ?? "",
          attendees: (e.attendees ?? []).map((a) => a.email ?? "").filter(Boolean),
        },
      });
      if (startMs > newest) newest = startMs;
    }

    return { items, cursor: String(newest) };
  },
};

registerTrigger(eventStartingIn);
