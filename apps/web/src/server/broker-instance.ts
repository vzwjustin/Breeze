import { createBroker, type Broker } from "@breeze/broker";

/**
 * Singleton broker wired to real ports. In the scaffold this throws —
 * replace with Prisma/Redis-backed implementations.
 */
let broker: Broker | null = null;

export function getBroker(): Broker {
  if (broker) return broker;
  broker = createBroker({
    policy: {
      forUser: async () => { throw new Error("broker.policy.forUser not wired"); },
    },
    connectors: {
      getAccount: async () => { throw new Error("broker.connectors.getAccount not wired"); },
      getFreshTokens: async () => { throw new Error("broker.connectors.getFreshTokens not wired"); },
    },
    executions: {
      findByIdempotencyKey: async () => undefined,
      start: async () => { throw new Error("broker.executions.start not wired"); },
      complete: async () => { throw new Error("broker.executions.complete not wired"); },
      fail: async () => { throw new Error("broker.executions.fail not wired"); },
    },
    approvals: {
      create: async () => { throw new Error("broker.approvals.create not wired"); },
      requireApproved: async () => { throw new Error("broker.approvals.requireApproved not wired"); },
    },
    preview: {
      build: async () => { throw new Error("broker.preview.build not wired"); },
    },
    events: {
      emit: async () => { /* outbox write goes here */ },
    },
    logger: {
      info: (msg, data) => console.log("[broker]", msg, data ?? ""),
      warn: (msg, data) => console.warn("[broker]", msg, data ?? ""),
      error: (msg, data) => console.error("[broker]", msg, data ?? ""),
    },
  });
  return broker;
}
