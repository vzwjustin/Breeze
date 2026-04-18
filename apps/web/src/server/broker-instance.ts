import { createBroker, type Broker } from "@breeze/broker";
import { createLogger } from "@breeze/common";

/**
 * Singleton broker wired to real ports. In the scaffold this throws —
 * replace with Prisma/Redis-backed implementations.
 */
let broker: Broker | null = null;

const brokerLogger = createLogger({ component: "broker" });

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
      info: (msg: string, data?: unknown) =>
        brokerLogger.info(msg, data !== undefined ? (data as Record<string, unknown>) : undefined),
      warn: (msg: string, data?: unknown) =>
        brokerLogger.warn(msg, data !== undefined ? (data as Record<string, unknown>) : undefined),
      error: (msg: string, data?: unknown) =>
        brokerLogger.error(msg, data !== undefined ? (data as Record<string, unknown>) : undefined),
    },
  });
  return broker;
}
