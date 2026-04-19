import { ApprovalService } from "@/server/services/approval-service";
import { requireUser } from "@/server/auth/require-user";
import { ApprovalActions } from "./approval-actions";
import type { Approval } from "@breeze/common";

const RISK_COLORS: Record<string, { bg: string; text: string }> = {
  none: { bg: "var(--color-surface-muted)", text: "var(--color-text-faint)" },
  low: { bg: "var(--color-success-light, #f0fdf4)", text: "var(--color-success)" },
  medium: { bg: "var(--color-warning-light, #fffbeb)", text: "var(--color-warning, #d97706)" },
  high: { bg: "var(--color-error-light, #fef2f2)", text: "var(--color-error)" },
  critical: { bg: "var(--color-error-light, #fef2f2)", text: "var(--color-error)" },
};

const STATUS_LABELS: Record<string, string> = {
  approved: "Approved",
  denied: "Denied",
  expired: "Expired",
  canceled: "Canceled",
  superseded: "Superseded",
};

export default async function ApprovalsPage() {
  const { user } = await requireUser();
  const pending = await ApprovalService.listPending(user.id);
  const decided = await ApprovalService.listRecentDecided(user.id);

  return (
    <div style={{ maxWidth: 720, margin: "0 auto", padding: "40px 24px" }}>
      <h1 style={{ fontSize: 24, fontWeight: 700, color: "var(--color-text)", marginBottom: 4, letterSpacing: "-0.02em" }}>
        Approvals
      </h1>
      <p style={{ color: "var(--color-text-muted)", fontSize: 14, marginBottom: 32 }}>
        Actions that need your sign-off before Breeze proceeds.
      </p>

      <section style={{ marginBottom: 40 }}>
        <h2 style={{
          fontSize: 12,
          fontWeight: 700,
          letterSpacing: "0.08em",
          textTransform: "uppercase",
          color: "var(--color-text-muted)",
          marginBottom: 12,
        }}>
          Pending {pending.length > 0 && `(${pending.length})`}
        </h2>

        {pending.length === 0 ? (
          <div style={{
            padding: "32px 24px",
            textAlign: "center",
            borderRadius: "var(--radius-lg)",
            border: "1px dashed var(--color-border)",
            color: "var(--color-text-muted)",
            fontSize: 14,
          }}>
            Nothing waiting on you.
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {pending.map((a) => {
              const riskStyle = RISK_COLORS[a.risk] ?? RISK_COLORS.medium!;
              return (
                <div
                  key={a.id}
                  style={{
                    padding: "18px 20px",
                    borderRadius: "var(--radius-lg)",
                    border: "1px solid var(--color-border)",
                    background: "var(--color-surface)",
                  }}
                >
                  <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12, marginBottom: 8 }}>
                    <div>
                      <span style={{ fontSize: 15, fontWeight: 600, color: "var(--color-text)" }}>
                        {a.preview.title}
                      </span>
                      <div style={{ fontSize: 13, color: "var(--color-text-muted)", marginTop: 2 }}>
                        {a.preview.targetSummary}
                      </div>
                    </div>
                    <span style={{
                      fontSize: 11,
                      fontWeight: 700,
                      letterSpacing: "0.06em",
                      textTransform: "uppercase",
                      padding: "3px 8px",
                      borderRadius: "var(--radius-sm)",
                      background: riskStyle.bg,
                      color: riskStyle.text,
                      flexShrink: 0,
                    }}>
                      {a.risk}
                    </span>
                  </div>
                  <ApprovalActions approval={a} />
                </div>
              );
            })}
          </div>
        )}
      </section>

      {decided.length > 0 && (
        <section>
          <h2 style={{
            fontSize: 12,
            fontWeight: 700,
            letterSpacing: "0.08em",
            textTransform: "uppercase",
            color: "var(--color-text-muted)",
            marginBottom: 12,
          }}>
            Recent decisions
          </h2>
          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            {decided.map((a) => (
              <div
                key={a.id}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 10,
                  padding: "10px 14px",
                  borderRadius: "var(--radius-md)",
                  border: "1px solid var(--color-border)",
                  background: "var(--color-surface)",
                }}
              >
                <span style={{
                  fontSize: 11,
                  fontWeight: 600,
                  letterSpacing: "0.04em",
                  textTransform: "uppercase",
                  padding: "2px 6px",
                  borderRadius: "var(--radius-sm)",
                  background: a.status === "approved" ? "var(--color-success-light, #f0fdf4)" : "var(--color-surface-muted)",
                  color: a.status === "approved" ? "var(--color-success)" : "var(--color-text-faint)",
                  flexShrink: 0,
                }}>
                  {STATUS_LABELS[a.status] ?? a.status}
                </span>
                <span style={{ fontSize: 13, color: "var(--color-text)", flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {a.preview.title}
                </span>
                {a.decidedAt && (
                  <span style={{ fontSize: 12, color: "var(--color-text-faint)", flexShrink: 0 }}>
                    {new Date(a.decidedAt).toLocaleDateString(undefined, { month: "short", day: "numeric" })}
                  </span>
                )}
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
