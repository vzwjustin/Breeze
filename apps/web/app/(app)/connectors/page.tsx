import Link from "next/link";
import { listConnectors } from "@breeze/connectors";
import { requireUser } from "@/server/auth/require-user";
import { prisma } from "@breeze/db";

const db = prisma as any;

const CONNECTOR_ICONS: Record<string, string> = {
  gmail: "M",
  gcal: "C",
  github: "G",
  files: "F",
};

export default async function ConnectorsPage() {
  const { user } = await requireUser();
  const connectors = listConnectors();

  const accounts: Array<{ connectorKey: string; status: string }> = await db.connectorAccount.findMany({
    where: { userId: user.id, deletedAt: null },
    select: { connectorKey: true, status: true },
  });

  const connectedMap = new Map(accounts.map((a) => [a.connectorKey, a.status]));

  return (
    <div style={{ maxWidth: 680, margin: "0 auto", padding: "40px 24px" }}>
      <h1 style={{ fontSize: 24, fontWeight: 700, color: "var(--color-text)", marginBottom: 4, letterSpacing: "-0.02em" }}>
        Connectors
      </h1>
      <p style={{ color: "var(--color-text-muted)", fontSize: 14, marginBottom: 32 }}>
        Connect your accounts to give Breeze the ability to act on your behalf.
      </p>

      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        {connectors.map((c) => {
          const status = connectedMap.get(c.meta.key);
          const isConnected = status === "ACTIVE";
          const needsReauth = status === "NEEDS_REAUTH";

          return (
            <div
              key={c.meta.key}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 16,
                padding: "18px 20px",
                borderRadius: "var(--radius-lg)",
                border: `1px solid ${isConnected ? "var(--color-success-muted, #bbf7d0)" : "var(--color-border)"}`,
                background: "var(--color-surface)",
              }}
            >
              <div style={{
                width: 44,
                height: 44,
                borderRadius: "var(--radius-md)",
                background: isConnected ? "var(--color-success-light, #f0fdf4)" : "var(--color-surface-muted)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                flexShrink: 0,
                fontSize: 18,
                fontWeight: 700,
                color: isConnected ? "var(--color-success)" : "var(--color-text-faint)",
                fontFamily: "serif",
              }}>
                {CONNECTOR_ICONS[c.meta.key] ?? c.meta.key[0]?.toUpperCase()}
              </div>

              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 2 }}>
                  <span style={{ fontSize: 15, fontWeight: 600, color: "var(--color-text)" }}>
                    {c.meta.displayName}
                  </span>
                  {isConnected && (
                    <span style={{
                      fontSize: 11,
                      fontWeight: 600,
                      letterSpacing: "0.04em",
                      textTransform: "uppercase",
                      color: "var(--color-success)",
                      background: "var(--color-success-light, #f0fdf4)",
                      padding: "2px 6px",
                      borderRadius: "var(--radius-sm)",
                    }}>
                      Connected
                    </span>
                  )}
                  {needsReauth && (
                    <span style={{
                      fontSize: 11,
                      fontWeight: 600,
                      letterSpacing: "0.04em",
                      textTransform: "uppercase",
                      color: "var(--color-warning, #d97706)",
                      background: "var(--color-warning-light, #fffbeb)",
                      padding: "2px 6px",
                      borderRadius: "var(--radius-sm)",
                    }}>
                      Needs reauth
                    </span>
                  )}
                </div>
                <div style={{ fontSize: 13, color: "var(--color-text-muted)" }}>
                  {c.meta.description}
                </div>
                <div style={{ fontSize: 11, color: "var(--color-text-faint)", marginTop: 4 }}>
                  {c.capabilities.length} {c.capabilities.length === 1 ? "capability" : "capabilities"}
                </div>
              </div>

              <Link
                href={`/api/connectors/auth/${c.meta.key}/connect`}
                style={{
                  padding: "7px 16px",
                  borderRadius: "var(--radius-md)",
                  border: isConnected ? "1px solid var(--color-border)" : "none",
                  background: isConnected ? "transparent" : "var(--color-primary)",
                  color: isConnected ? "var(--color-text-muted)" : "white",
                  fontSize: 13,
                  fontWeight: 600,
                  textDecoration: "none",
                  flexShrink: 0,
                }}
              >
                {isConnected ? "Reconnect" : needsReauth ? "Re-authorize" : "Connect"}
              </Link>
            </div>
          );
        })}
      </div>
    </div>
  );
}
