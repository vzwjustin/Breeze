/**
 * Memory framework. Three kinds: conversation / user / working.
 * See BLUEPRINT §14. No vectors in v1.
 */
import type { MemoryRecord, MemoryType } from "@breeze/common";

export interface MemoryReader {
  pack(args: {
    userId: string;
    chatId?: string;
    taskRunId?: string;
    intentTags?: string[];
    limit?: number;
  }): Promise<MemoryRecord[]>;
}

export interface MemoryWriter {
  save(rec: Omit<MemoryRecord, "id" | "createdAt" | "updatedAt">): Promise<MemoryRecord>;
  update(id: string, patch: Partial<Pick<MemoryRecord, "value" | "reason" | "expiresAt">>): Promise<MemoryRecord>;
  delete(id: string): Promise<void>;
  prune(): Promise<{ deleted: number }>;
}

export const RETENTION: Record<MemoryType, { ttlMs?: number; prunePolicy: string }> = {
  conversation: { prunePolicy: "Roll/summarize when chat exceeds 6k tokens." },
  user: { prunePolicy: "Never auto-expire. User-deletable only." },
  working: { ttlMs: 24 * 60 * 60 * 1000, prunePolicy: "Hard-delete 24h after task run ends." },
};

function mapRow(row: Record<string, unknown>): MemoryRecord {
  return {
    id: String(row.id),
    userId: String(row.userId),
    type: String(row.type).toLowerCase() as MemoryRecord["type"],
    scope: row.scope ? String(row.scope) : undefined,
    key: String(row.key),
    value: row.value,
    source: row.source as MemoryRecord["source"],
    reason: String(row.reason),
    visibility: String(row.visibility).toLowerCase() as MemoryRecord["visibility"],
    expiresAt: row.expiresAt ? new Date(row.expiresAt as string).toISOString() : undefined,
    createdAt: new Date(row.createdAt as string).toISOString(),
    updatedAt: new Date(row.updatedAt as string).toISOString(),
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function createMemoryStore(prisma: any): MemoryReader & MemoryWriter {
  return {
    async pack({ userId, limit = 50 }) {
      const rows = await prisma.memory.findMany({
        where: {
          userId,
          deletedAt: null,
          OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
        },
        orderBy: { updatedAt: "desc" },
        take: Math.min(limit, 200),
      });

      return rows.map(mapRow);
    },

    async save(rec) {
      const visMap: Record<string, string> = {
        user_visible: "USER_VISIBLE",
        internal: "INTERNAL",
      };
      const typeMap: Record<string, string> = {
        conversation: "CONVERSATION",
        user: "USER",
        working: "WORKING",
      };

      const row = await prisma.memory.create({
        data: {
          userId: rec.userId,
          type: typeMap[rec.type] ?? "USER",
          scope: rec.scope ?? null,
          key: rec.key,
          value: rec.value,
          source: rec.source as object,
          reason: rec.reason,
          visibility: visMap[rec.visibility] ?? "USER_VISIBLE",
          expiresAt: rec.expiresAt ? new Date(rec.expiresAt) : null,
        },
      });

      return mapRow(row as Record<string, unknown>);
    },

    async update(id, patch) {
      const row = await prisma.memory.update({
        where: { id },
        data: {
          ...(patch.value !== undefined ? { value: patch.value } : {}),
          ...(patch.reason !== undefined ? { reason: patch.reason } : {}),
          ...(patch.expiresAt !== undefined ? { expiresAt: new Date(patch.expiresAt) } : {}),
        },
      });
      return mapRow(row as Record<string, unknown>);
    },

    async delete(id) {
      await prisma.memory.update({ where: { id }, data: { deletedAt: new Date() } });
    },

    async prune() {
      const result = await prisma.memory.deleteMany({
        where: {
          OR: [{ expiresAt: { lt: new Date() } }, { deletedAt: { not: null } }],
        },
      });
      return { deleted: result.count };
    },
  };
}
