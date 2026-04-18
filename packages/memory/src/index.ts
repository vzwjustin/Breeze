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
