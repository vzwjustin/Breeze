import { z } from "zod";
import { BreezeError } from "@breeze/common";
import { registerConnector } from "../registry.js";
import type { Connector, ConnectorCapability } from "../types.js";

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
    events: z.array(z.object({
      id: z.string(),
      summary: z.string(),
      start: z.string(),
      end: z.string(),
      attendees: z.array(z.string()).optional(),
    })),
  }),
  execute: async (_i, _c) => { throw new BreezeError("unknown", "gcal.list_events not implemented"); },
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
  execute: async (_i, _c) => { throw new BreezeError("unknown", "gcal.create_event not implemented"); },
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
    patch: z.record(z.unknown()),
  }),
  outputSchema: z.object({ ok: z.boolean() }),
  execute: async (_i, _c) => { throw new BreezeError("unknown", "gcal.update_event not implemented"); },
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
  execute: async (_i, _c) => { throw new BreezeError("unknown", "gcal.delete_event not implemented"); },
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
  execute: async (_i, _c) => { throw new BreezeError("unknown", "gcal.respond_invite not implemented"); },
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
      scopes: ["https://www.googleapis.com/auth/calendar.events"],
      consentUrlFactory: (_s) => { throw new BreezeError("unknown", "gcal OAuth not wired"); },
      exchangeCode: async (_c) => { throw new BreezeError("unknown", "gcal OAuth not wired"); },
    },
  },
  healthCheck: async () => ({ ok: false, message: "gcal healthcheck not implemented" }),
  capabilities: [listEvents, createEvent, updateEvent, deleteEvent, respondInvite],
};

registerConnector(gcal);
export default gcal;
