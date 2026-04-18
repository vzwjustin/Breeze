import type { ReactNode } from "react";
import Link from "next/link";

/**
 * Authenticated app shell. In production this wraps everything in
 * <Sidebar>, <Topbar>, <CommandMenu>, <ToastProvider>, and requires a
 * session via requireUser().
 */
export default function AppShell({ children }: { children: ReactNode }) {
  return (
    <div style={{ display: "grid", gridTemplateColumns: "240px 1fr", minHeight: "100dvh" }}>
      <aside aria-label="Primary navigation" style={{ borderRight: "1px solid #eee", padding: 16 }}>
        <nav>
          <ul style={{ listStyle: "none", padding: 0, margin: 0, display: "grid", gap: 8 }}>
            <li><Link href="/">Home</Link></li>
            <li><Link href="/chat">Chat</Link></li>
            <li><Link href="/tasks">Tasks</Link></li>
            <li><Link href="/approvals">Approvals</Link></li>
            <li><Link href="/connectors">Connectors</Link></li>
            <li><Link href="/memory">Memory</Link></li>
            <li><Link href="/settings">Settings</Link></li>
          </ul>
        </nav>
      </aside>
      <main id="main-content" style={{ padding: 24 }}>{children}</main>
    </div>
  );
}
