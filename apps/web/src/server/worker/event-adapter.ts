import { prisma } from "@breeze/db";
import type { EventEnvelope } from "@breeze/common";
import type { EventDispatcherDeps } from "@breeze/workflows";

const db = prisma as any;

export function createEventDispatcherDeps(): EventDispatcherDeps {
  return {
    outbox: {
      async drainBatch(limit: number): Promise<EventEnvelope[]> {
        const rows = await db.eventOutbox.findMany({
          where: { publishedAt: null },
          orderBy: { createdAt: "asc" },
          take: limit,
        });
        return rows.map((row: { id: string; type: string; payload: unknown; createdAt: Date }) => {
          const payload = row.payload as EventEnvelope;
          return {
            ...payload,
            id: row.id,
            type: (payload.type ?? row.type) as EventEnvelope["type"],
            createdAt: payload.createdAt ?? row.createdAt.toISOString(),
          };
        });
      },
      async markPublished(ids: string[]) {
        if (ids.length === 0) return;
        await db.eventOutbox.updateMany({
          where: { id: { in: ids } },
          data: { publishedAt: new Date() },
        });
      },
    },
    audit: {
      async writeSubset(events: EventEnvelope[]) {
        for (const e of events) {
          const subject = e.subject as { type?: string; id?: string } | undefined;
          await db.auditEvent.create({
            data: {
              userId: e.userId ?? null,
              type: e.type,
              subjectType: subject?.type ?? null,
              subjectId: subject?.id ?? null,
              correlationId: e.correlationId ?? null,
              data: e.payload as object,
            },
          });
        }
      },
    },
    pubsub: {
      async publish(_events: EventEnvelope[]) {
        // SSE bridge via Redis is future work; outbox drain + audit is enough for v1.
      },
    },
  };
}
