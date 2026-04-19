import { requireUser } from "@/server/auth/require-user";
import { prisma } from "@breeze/db";
import type { MemoryRecord } from "@breeze/common";

const db = prisma as any;

const TYPE_LABELS: Record<string, string> = {
  conversation: "Conversation",
  user: "About you",
  working: "Working",
};

const VISIBILITY_LABELS: Record<string, string> = {
  user_visible: "Visible",
  internal: "Internal",
};

export default async function MemoryPage() {
  const { user } = await requireUser();

  const rows = await db.memory.findMany({
    where: {
      userId: user.id,
      deletedAt: null,
      OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
    },
    orderBy: { updatedAt: "desc" },
    take: 100,
    select: {
      id: true,
      type: true,
      key: true,
      value: true,
      reason: true,
      visibility: true,
      expiresAt: true,
      updatedAt: true,
    },
  });

  const memories: Array<{
    id: string;
    type: string;
    key: string;
    value: unknown;
    reason: string;
    visibility: string;
    expiresAt: Date | null;
    updatedAt: Date;
  }> = rows;

  const grouped = memories.reduce<Record<string, typeof memories>>((acc, m) => {
    const t = m.type.toLowerCase();
    if (!acc[t]) acc[t] = [];
    acc[t]!.push(m);
    return acc;
  }, {});

  return (
    <div style={{ maxWidth: 680, margin: "0 auto", padding: "40px 24px" }}>
      <h1 style={{ fontSize: 24, fontWeight: 700, color: "var(--color-text)", marginBottom: 4, letterSpacing: "-0.02em" }}>
        Memory
      </h1>
      <p style={{ color: "var(--color-text-muted)", fontSize: 14, marginBottom: 32 }}>
        What Breeze knows about you. Every item shows why it was saved.
      </p>

      {memories.length === 0 ? (
        <div style={{
          padding: "40px 24px",
          textAlign: "center",
          borderRadius: "var(--radius-lg)",
          border: "1px dashed var(--color-border)",
          color: "var(--color-text-muted)",
          fontSize: 14,
        }}>
          No memories yet. They appear as you use Breeze.
        </div>
      ) : (
        Object.entries(grouped).map(([type, items]) => (
          <div key={type} style={{ marginBottom: 32 }}>
            <h2 style={{
              fontSize: 12,
              fontWeight: 700,
              letterSpacing: "0.08em",
              textTransform: "uppercase",
              color: "var(--color-text-muted)",
              marginBottom: 12,
            }}>
              {TYPE_LABELS[type] ?? type} ({items.length})
            </h2>
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              {items.map((m) => (
                <div
                  key={m.id}
                  style={{
                    padding: "14px 16px",
                    borderRadius: "var(--radius-md)",
                    border: "1px solid var(--color-border)",
                    background: "var(--color-surface)",
                  }}
                >
                  <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12, marginBottom: 6 }}>
                    <span style={{ fontSize: 13, fontWeight: 600, color: "var(--color-text)" }}>
                      {m.key}
                    </span>
                    <span style={{ fontSize: 11, color: "var(--color-text-faint)", flexShrink: 0 }}>
                      {new Date(m.updatedAt).toLocaleDateString(undefined, { month: "short", day: "numeric" })}
                    </span>
                  </div>
                  <div style={{ fontSize: 13, color: "var(--color-text)", marginBottom: 6, wordBreak: "break-word" }}>
                    {typeof m.value === "string" ? m.value : JSON.stringify(m.value)}
                  </div>
                  <div style={{ fontSize: 12, color: "var(--color-text-faint)" }}>
                    {m.reason}
                  </div>
                </div>
              ))}
            </div>
          </div>
        ))
      )}
    </div>
  );
}
