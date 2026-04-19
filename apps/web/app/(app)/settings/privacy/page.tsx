import { requireUser } from "@/server/auth/require-user";
import { prisma } from "@breeze/db";
import { PrivacyActions } from "./privacy-actions";

const db = prisma as any;

export default async function PrivacyPage() {
  const { user } = await requireUser();

  const [memoryCount, chatCount] = await Promise.all([
    db.memory.count({ where: { userId: user.id, deletedAt: null } }),
    db.chat.count({ where: { userId: user.id, deletedAt: null } }),
  ]);

  return (
    <div style={{ maxWidth: 640, margin: "0 auto", padding: "40px 24px" }}>
      <h1 style={{ fontSize: 24, fontWeight: 700, color: "var(--color-text)", marginBottom: 4, letterSpacing: "-0.02em" }}>
        Privacy
      </h1>
      <p style={{ color: "var(--color-text-muted)", fontSize: 14, marginBottom: 32 }}>
        Manage what Breeze stores about you and your conversations.
      </p>

      <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
        <div style={{
          padding: "20px",
          borderRadius: "var(--radius-lg)",
          border: "1px solid var(--color-border)",
          background: "var(--color-surface)",
        }}>
          <h2 style={{ fontSize: 15, fontWeight: 600, color: "var(--color-text)", marginBottom: 4 }}>
            Memory
          </h2>
          <p style={{ fontSize: 13, color: "var(--color-text-muted)", marginBottom: 16, lineHeight: 1.6 }}>
            Breeze stores {memoryCount} memory {memoryCount === 1 ? "item" : "items"} to personalize your experience.
            You can clear all memories at any time.
          </p>
          <PrivacyActions action="clear-memory" label="Clear all memory" destructive />
        </div>

        <div style={{
          padding: "20px",
          borderRadius: "var(--radius-lg)",
          border: "1px solid var(--color-border)",
          background: "var(--color-surface)",
        }}>
          <h2 style={{ fontSize: 15, fontWeight: 600, color: "var(--color-text)", marginBottom: 4 }}>
            Chat history
          </h2>
          <p style={{ fontSize: 13, color: "var(--color-text-muted)", marginBottom: 16, lineHeight: 1.6 }}>
            You have {chatCount} conversation{chatCount === 1 ? "" : "s"} stored.
            Deleting chat history cannot be undone.
          </p>
          <PrivacyActions action="clear-chats" label="Delete all chats" destructive />
        </div>

        <div style={{
          padding: "20px",
          borderRadius: "var(--radius-lg)",
          border: "1px solid var(--color-border-muted, var(--color-border))",
          background: "var(--color-surface)",
        }}>
          <h2 style={{ fontSize: 15, fontWeight: 600, color: "var(--color-text)", marginBottom: 4 }}>
            Data retention
          </h2>
          <p style={{ fontSize: 13, color: "var(--color-text-muted)", lineHeight: 1.6 }}>
            Conversation memories expire after 30 days. Working memories (used during task runs) expire after 24 hours.
            User-declared preferences are kept until you delete them.
          </p>
        </div>
      </div>
    </div>
  );
}
