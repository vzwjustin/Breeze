import type { ID, ISO } from "./types.js";

export type BreezeEventType =
  | "chat.message_received"
  | "chat.turn_started"
  | "chat.turn_completed"
  | "chat.turn_failed"
  | "plan.created"
  | "plan.failed"
  | "plan.canceled"
  | "step.started"
  | "step.completed"
  | "step.failed"
  | "action.requested"
  | "action.started"
  | "action.completed"
  | "action.failed"
  | "approval.requested"
  | "approval.approved"
  | "approval.denied"
  | "approval.expired"
  | "task.created"
  | "task.updated"
  | "task.paused"
  | "task.resumed"
  | "task.run_started"
  | "task.run_completed"
  | "task.run_failed"
  | "connector.connected"
  | "connector.reauth_required"
  | "connector.refresh_failed"
  | "connector.disconnected"
  | "memory.saved"
  | "memory.updated"
  | "memory.deleted"
  | "policy.decision";

export interface EventEnvelope<
  T extends BreezeEventType = BreezeEventType,
  P = unknown
> {
  id: ID;
  type: T;
  source: "app" | "worker";
  userId?: ID;
  correlationId?: ID;
  causationId?: ID;
  subject?: { type: string; id: ID };
  payload: P;
  createdAt: ISO;
  traceId?: string;
}
