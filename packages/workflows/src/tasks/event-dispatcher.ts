/**
 * Event dispatcher: transactional outbox pattern. Runs every few seconds.
 * Drains `EventOutbox` rows, writes to AuditEvent (subset) and fans out to
 * Redis pub/sub for SSE.
 */
import type { EventEnvelope } from "@breeze/common";

export interface EventDispatcherDeps {
  outbox: {
    drainBatch: (limit: number) => Promise<EventEnvelope[]>;
    markPublished: (ids: string[]) => Promise<void>;
  };
  audit: {
    writeSubset: (events: EventEnvelope[]) => Promise<void>;
  };
  pubsub: {
    publish: (events: EventEnvelope[]) => Promise<void>;
  };
}

const AUDITED_TYPES = new Set([
  "action.completed",
  "action.failed",
  "approval.requested",
  "approval.approved",
  "approval.denied",
  "approval.expired",
  "connector.connected",
  "connector.disconnected",
  "memory.saved",
  "memory.deleted",
  "policy.decision",
  "task.created",
  "task.paused",
  "task.resumed",
]);

export async function runEventDispatcher(deps: EventDispatcherDeps, batch = 100): Promise<void> {
  const events = await deps.outbox.drainBatch(batch);
  if (events.length === 0) return;
  const audited = events.filter((e) => AUDITED_TYPES.has(e.type));
  if (audited.length) await deps.audit.writeSubset(audited);
  await deps.pubsub.publish(events);
  await deps.outbox.markPublished(events.map((e) => e.id));
}
