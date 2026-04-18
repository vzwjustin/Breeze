import type { ReactNode } from "react";

/**
 * Authenticated app shell. In production this wraps everything in
 * <Sidebar>, <Topbar>, <CommandMenu>, <ToastProvider>, and requires a
 * session via requireUser().
 */
export default function AppShell({ children }: { children: ReactNode }) {
  return (
    <div style={{ display: "grid", gridTemplateColumns: "240px 1fr", minHeight: "100dvh" }}>
      <aside style={{ borderRight: "1px solid #eee", padding: 16 }}>
        <nav>
          <ul style={{ listStyle: "none", padding: 0, margin: 0, display: "grid", gap: 8 }}>
            <li><a href="/">Home</a></li>
            <li><a href="/chat">Chat</a></li>
            <li><a href="/tasks">Tasks</a></li>
            <li><a href="/approvals">Approvals</a></li>
            <li><a href="/connectors">Connectors</a></li>
            <li><a href="/memory">Memory</a></li>
            <li><a href="/settings">Settings</a></li>
          </ul>
        </nav>
      </aside>
      <main style={{ padding: 24 }}>{children}</main>
    </div>
  );
}
