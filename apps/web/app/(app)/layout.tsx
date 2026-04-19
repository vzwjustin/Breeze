import type { ReactNode } from "react";
import { requireUser } from "@/server/auth/require-user";
import { NavItem } from "./nav-item";

export default async function AppShell({ children }: { children: ReactNode }) {
  const { user } = await requireUser();

  return (
    <div style={{ display: "flex", minHeight: "100dvh", background: "var(--color-surface-muted)" }}>
      <aside style={{
        width: 240,
        background: "var(--color-sidebar-bg)",
        display: "flex",
        flexDirection: "column",
        flexShrink: 0,
        position: "fixed",
        top: 0,
        left: 0,
        bottom: 0,
        zIndex: 40,
      }}>
        <div style={{ padding: "20px 16px 12px", borderBottom: "1px solid var(--color-sidebar-border)" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <div style={{
              width: 32,
              height: 32,
              background: "var(--color-primary)",
              borderRadius: "var(--radius-md)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              flexShrink: 0,
            }}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2z"/>
                <path d="M12 6v6l4 2"/>
              </svg>
            </div>
            <span style={{ color: "white", fontWeight: 600, fontSize: 16, letterSpacing: "-0.01em" }}>
              Breeze
            </span>
          </div>
        </div>

        <nav style={{ flex: 1, padding: "12px 8px", overflow: "auto" }} aria-label="Primary navigation">
          <ul style={{ listStyle: "none", display: "flex", flexDirection: "column", gap: 2, marginBottom: 16, padding: 0, margin: "0 0 16px" }}>
            <NavItem href="/chat" icon="chat" label="Chat" />
            <NavItem href="/tasks" icon="task" label="Tasks" />
            <NavItem href="/approvals" icon="approval" label="Approvals" />
          </ul>

          <div style={{
            color: "var(--color-sidebar-text-muted)",
            fontSize: 11,
            fontWeight: 600,
            letterSpacing: "0.08em",
            textTransform: "uppercase",
            padding: "4px 10px 8px",
          }}>
            Manage
          </div>

          <ul style={{ listStyle: "none", display: "flex", flexDirection: "column", gap: 2, padding: 0, margin: 0 }}>
            <NavItem href="/connectors" icon="connector" label="Connectors" />
            <NavItem href="/memory" icon="memory" label="Memory" />
          </ul>
        </nav>

        <div style={{ padding: "12px 8px", borderTop: "1px solid var(--color-sidebar-border)" }}>
          <ul style={{ listStyle: "none", padding: 0, margin: "0 0 8px" }}>
            <NavItem href="/settings" icon="settings" label="Settings" />
          </ul>
          <div style={{ padding: "8px 10px", display: "flex", alignItems: "center", gap: 10 }}>
            <div style={{
              width: 28,
              height: 28,
              borderRadius: "var(--radius-full)",
              background: "var(--color-primary)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              flexShrink: 0,
            }}>
              <span style={{ color: "white", fontSize: 11, fontWeight: 600 }}>
                {user.email[0]?.toUpperCase() ?? "?"}
              </span>
            </div>
            <span style={{
              color: "var(--color-sidebar-text)",
              fontSize: 13,
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}>
              {user.email}
            </span>
          </div>
        </div>
      </aside>

      <main
        id="main-content"
        style={{
          flex: 1,
          marginLeft: 240,
          display: "flex",
          flexDirection: "column",
          minHeight: "100dvh",
        }}
      >
        {children}
      </main>
    </div>
  );
}
