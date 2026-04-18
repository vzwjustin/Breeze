import { z } from "zod";
import { BreezeError } from "@breeze/common";
import { registerConnector } from "../registry.js";
import type { Connector, ConnectorCapability } from "../types.js";
import { httpJson } from "../http.js";
import { googleConsentUrl, googleExchangeCode, googleRefresh } from "../google-oauth.js";

const API = "https://www.googleapis.com/calendar/v3";
const SCOPES = ["https://www.googleapis.com/auth/calendar.events"];

interface GCalEvent {
  id: string;
  summary?: string;
  description?: string;
  start?: { dateTime?: string; date?: string };
  end?: { dateTime?: string; date?: string };
  attendees?: Array<{ email?: string; responseStatus?: string }>;
}

function whenFor(e: GCalEvent["start"]): string {
  return e?.dateTime ?? e?.date ?? "";
}

const listEvents: ConnectorCapability = {
  key: "gcal.list_events",
  displayName: "List calendar events",
  description: "Lists events in a time range.",
  sensitivity: "none",
  mutatesState: false,
  approvalHint: "never",
  idempotent: true,
  inputSchema: z.object({
    calendarId: z.string().default("primary"),
    from: z.string(),
    to: z.string(),
  }),
  outputSchema: z.object({
    events: z.array(
      z.object({
        id: z.string(),
        summary: z.string(),
        start: z.string(),
        end: z.string(),
        attendees: z.array(z.string()).optional(),
      })
    ),
  }),
  execute: async (input, ctx) => {
    const { calendarId, from, to } = input as { calendarId: string; from: string; to: string };
    const data = await httpJson<{ items?: GCalEvent[] }>({
      url: `${API}/calendars/${encodeURIComponent(calendarId)}/events`,
      query: { timeMin: from, timeMax: to, singleEvents: "true", orderBy: "startTime", maxResults: 100 },
      bearer: ctx.tokens.accessToken,
      signal: ctx.signal,
    });
    return {
      events: (data.items ?? []).map((e) => ({
        id: e.id,
        summary: e.summary ?? "(no title)",
        start: whenFor(e.start),
        end: whenFor(e.end),
        attendees: e.attendees?.map((a) => a.email ?? "").filter(Boolean),
      })),
    };
  },
};

const createEvent: ConnectorCapability = {
  key: "gcal.create_event",
  displayName: "Create calendar event",
  description: "Creates a new calendar event.",
  sensitivity: "high",
  mutatesState: true,
  approvalHint: "always",
  idempotent: false,
  inputSchema: z.object({
    calendarId: z.string().default("primary"),
    summary: z.string(),
    start: z.string(),
    end: z.string(),
    attendees: z.array(z.string()).optional(),
    description: z.string().optional(),
  }),
  outputSchema: z.object({ eventId: z.string() }),
  execute: async (input, ctx) => {
    const { calendarId, summary, start, end, attendees, description } = input as {
      calendarId: string;
      summary: string;
      start: string;
      end: string;
      attendees?: string[];
      description?: string;
    };
    const res = await httpJson<{ id: string }>({
      url: `${API}/calendars/${encodeURIComponent(calendarId)}/events`,
      method: "POST",
      bearer: ctx.tokens.accessToken,
      body: {
        summary,
        description,
        start: { dateTime: start },
        end: { dateTime: end },
        attendees: attendees?.map((email) => ({ email })),
      },
      signal: ctx.signal,
    });
    return { eventId: res.id };
  },
};

const updateEvent: ConnectorCapability = {
  key: "gcal.update_event",
  displayName: "Update event",
  description: "Updates an existing event.",
  sensitivity: "high",
  mutatesState: true,
  approvalHint: "always",
  idempotent: true,
  inputSchema: z.object({
    calendarId: z.string().default("primary"),
    eventId: z.string(),
    patch: z.object({
      summary: z.string().optional(),
      description: z.string().optional(),
      location: z.string().optional(),
      start: z.union([
        z.object({ dateTime: z.string(), timeZone: z.string().optional() }),
        z.object({ date: z.string() }),
      ]).optional(),
      end: z.union([
        z.object({ dateTime: z.string(), timeZone: z.string().optional() }),
        z.object({ date: z.string() }),
      ]).optional(),
    }).partial().strict(),
  }),
  outputSchema: z.object({ ok: z.boolean() }),
  execute: async (input, ctx) => {
    const { calendarId, eventId, patch } = input as {
      calendarId: string;
      eventId: string;
      patch: Record<string, unknown>;
    };
    await httpJson({
      url: `${API}/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`,
      method: "PATCH",
      bearer: ctx.tokens.accessToken,
      body: patch,
      signal: ctx.signal,
    });
    return { ok: true };
  },
};

const deleteEvent: ConnectorCapability = {
  key: "gcal.delete_event",
  displayName: "Delete event",
  description: "Deletes an event.",
  sensitivity: "critical",
  mutatesState: true,
  approvalHint: "always",
  idempotent: true,
  inputSchema: z.object({
    calendarId: z.string().default("primary"),
    eventId: z.string(),
  }),
  outputSchema: z.object({ ok: z.boolean() }),
  execute: async (input, ctx) => {
    const { calendarId, eventId } = input as { calendarId: string; eventId: string };
    await httpJson({
      url: `${API}/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`,
      method: "DELETE",
      bearer: ctx.tokens.accessToken,
      signal: ctx.signal,
    });
    return { ok: true };
  },
};

const respondInvite: ConnectorCapability = {
  key: "gcal.respond_invite",
  displayName: "Respond to invite",
  description: "Accepts, declines, or tentatively accepts an invite.",
  sensitivity: "medium",
  mutatesState: true,
  approvalHint: "sometimes",
  idempotent: true,
  inputSchema: z.object({
    calendarId: z.string().default("primary"),
    eventId: z.string(),
    response: z.enum(["accepted", "declined", "tentative"]),
  }),
  outputSchema: z.object({ ok: z.boolean() }),
  execute: async (input, ctx) => {
    const { calendarId, eventId, response } = input as {
      calendarId: string;
      eventId: string;
      response: "accepted" | "declined" | "tentative";
    };
    // Look up the user's email, then patch their own attendee entry.
    const [me, event] = await Promise.all([
      httpJson<{ id: string; summary?: string }>({
        url: `${API}/calendars/primary`,
        bearer: ctx.tokens.accessToken,
        signal: ctx.signal,
      }),
      httpJson<GCalEvent>({
        url: `${API}/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`,
        bearer: ctx.tokens.accessToken,
        signal: ctx.signal,
      }),
    ]);
    const email = me.id;
    const attendees = (event.attendees ?? []).map((a) =>
      a.email === email ? { ...a, responseStatus: response } : a
    );
    if (!attendees.some((a) => a.email === email)) {
      throw new BreezeError("not_found", `You are not an attendee of event ${eventId}`);
    }
    await httpJson({
      url: `${API}/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`,
      method: "PATCH",
      bearer: ctx.tokens.accessToken,
      body: { attendees },
      signal: ctx.signal,
    });
    return { ok: true };
  },
};

const gcal: Connector = {
  meta: {
    key: "gcal",
    displayName: "Google Calendar",
    description: "Read and manage your calendar.",
    version: "1.0.0",
    icon: "/icons/gcal.svg",
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
      const cal = await httpJson<{ id?: string; summary?: string }>({
        url: `${API}/calendars/primary`,
        bearer: ctx.tokens.accessToken,
        signal: ctx.signal,
      });
      return { ok: true, message: cal.summary ? `primary calendar: ${cal.summary}` : "ok" };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return { ok: false, message: msg };
    }
  },
  capabilities: [listEvents, createEvent, updateEvent, deleteEvent, respondInvite],
};

registerConnector(gcal);
export default gcal;
