import type { z } from "zod";
import { BreezeError } from "@breeze/common";
import type { ConnectorExecutionContext } from "./types.js";

/**
 * A connector trigger — the "if this" half of a Recipe. Triggers are
 * polled by the recipe runner; each poll returns the new items since
 * `cursor` plus an advanced cursor to persist for the next run.
 *
 * Triggers are pure reads. They never mutate remote state.
 */
export interface ConnectorTriggerPollInput<I = unknown> {
  input: I;
  cursor?: string;
  ctx: ConnectorExecutionContext;
}

export interface ConnectorTriggerPollResult<T = unknown> {
  items: Array<{ key: string; data: T }>;
  cursor?: string;
}

export interface ConnectorTrigger<I = unknown, T = unknown> {
  key: string; // e.g. "gmail.new_thread"
  connector: string; // e.g. "gmail"
  displayName: string;
  description: string;
  itemShape: string; // human-readable description of each item
  inputSchema: z.ZodSchema<I>;
  poll: (args: ConnectorTriggerPollInput<I>) => Promise<ConnectorTriggerPollResult<T>>;
}

const triggers = new Map<string, ConnectorTrigger>();

export function registerTrigger<I, T>(t: ConnectorTrigger<I, T>): void {
  if (triggers.has(t.key)) {
    throw new Error(`Duplicate trigger key: ${t.key}`);
  }
  triggers.set(t.key, t as unknown as ConnectorTrigger);
}

export function getTrigger(key: string): ConnectorTrigger | undefined {
  return triggers.get(key);
}

export function listTriggers(): ConnectorTrigger[] {
  return [...triggers.values()];
}

export function requireTrigger(key: string): ConnectorTrigger {
  const t = triggers.get(key);
  if (!t) throw new BreezeError("validation", `Unknown trigger: ${key}`);
  return t;
}

export interface PublicTrigger {
  key: string;
  connector: string;
  displayName: string;
  description: string;
  itemShape: string;
}

export function publicTriggerCatalog(connectedKeys: Set<string>): PublicTrigger[] {
  return [...triggers.values()]
    .filter((t) => connectedKeys.has(t.connector))
    .map((t) => ({
      key: t.key,
      connector: t.connector,
      displayName: t.displayName,
      description: t.description,
      itemShape: t.itemShape,
    }));
}
