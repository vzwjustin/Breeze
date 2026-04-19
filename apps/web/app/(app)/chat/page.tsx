import Link from "next/link";
import { requireUser } from "@/server/auth/require-user";
import { prisma } from "@breeze/db";

const db = prisma as any;

export default async function ChatIndex() {
  const { user } = await requireUser();

  const recentChats = await db.chat.findMany({
    where: { userId: user.id, deletedAt: null },
    orderBy: { updatedAt: "desc" },
    take: 10,
    select: {
      id: true,
      title: true,
      updatedAt: true,
    },
  });

  return (
    <div style={{
      display: "flex",
      flexDirection: "column",
      alignItems: "center",
      justifyContent: "center",
      minHeight: "100vh",
      padding: 40,
      background: "var(--color-surface)",
    }}>
      <div style={{ width: "100%", maxWidth: 580 }}>
        <div style={{ textAlign: "center", marginBottom: 40 }}>
          <div style={{
            width: 60,
            height: 60,
            background: "var(--color-primary-light)",
            borderRadius: "var(--radius-lg)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            margin: "0 auto 16px",
          }}>
            <svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="var(--color-primary)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
            </svg>
          </div>
          <h1 style={{ fontSize: 26, fontWeight: 700, color: "var(--color-text)", marginBottom: 8, letterSpacing: "-0.02em" }}>
            What can I help you with?
          </h1>
          <p style={{ color: "var(--color-text-muted)", fontSize: 15 }}>
            Start a new conversation or continue a recent one.
          </p>
        </div>

        <Link
          href="/chat/new"
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            gap: 8,
            width: "100%",
            padding: "12px 20px",
            background: "var(--color-primary)",
            color: "white",
            borderRadius: "var(--radius-md)",
            fontWeight: 600,
            fontSize: 15,
            textDecoration: "none",
            boxShadow: "var(--shadow-md)",
          }}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 5v14M5 12h14"/>
          </svg>
          New conversation
        </Link>

        {recentChats.length > 0 && (
          <div style={{ marginTop: 40 }}>
            <h2 style={{ fontSize: 13, fontWeight: 600, color: "var(--color-text-muted)", letterSpacing: "0.06em", textTransform: "uppercase", marginBottom: 12 }}>
              Recent
            </h2>
            <ul style={{ listStyle: "none", display: "flex", flexDirection: "column", gap: 4 }}>
              {recentChats.map((chat: { id: string; title: string; updatedAt: string }) => (
                <li key={chat.id}>
                  <Link
                    href={`/chat/${chat.id}`}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                      padding: "10px 14px",
                      borderRadius: "var(--radius-md)",
                      border: "1px solid var(--color-border)",
                      background: "var(--color-surface)",
                      textDecoration: "none",
                    }}
                  >
                    <span style={{ fontSize: 14, color: "var(--color-text)", fontWeight: 500, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", flex: 1 }}>
                      {chat.title}
                    </span>
                    <span style={{ fontSize: 12, color: "var(--color-text-faint)", marginLeft: 12, flexShrink: 0 }}>
                      {formatRelative(new Date(chat.updatedAt))}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        )}

        <div style={{ marginTop: 40, display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
          {SUGGESTIONS.map((s) => (
            <div
              key={s.label}
              style={{
                padding: "14px 16px",
                borderRadius: "var(--radius-md)",
                border: "1px solid var(--color-border)",
                background: "var(--color-surface)",
              }}
            >
              <div style={{ fontSize: 20, marginBottom: 6 }}>{s.icon}</div>
              <div style={{ fontSize: 13, fontWeight: 600, color: "var(--color-text)", marginBottom: 4 }}>{s.label}</div>
              <div style={{ fontSize: 12, color: "var(--color-text-muted)", lineHeight: 1.5 }}>{s.description}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

const SUGGESTIONS = [
  { icon: "✉️", label: "Check email", description: "Summarize unread threads, draft replies" },
  { icon: "📅", label: "Manage calendar", description: "List events, create or update meetings" },
  { icon: "💻", label: "GitHub", description: "Review notifications, issues, and PRs" },
  { icon: "📁", label: "Files", description: "Read, summarize, and organize documents" },
];

function formatRelative(date: Date): string {
  const diffMs = Date.now() - date.getTime();
  const diffMin = Math.floor(diffMs / 60_000);
  if (diffMin < 1) return "just now";
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffH = Math.floor(diffMin / 60);
  if (diffH < 24) return `${diffH}h ago`;
  return date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}
