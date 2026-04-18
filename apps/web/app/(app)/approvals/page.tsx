import { ApprovalService } from "@/server/services/approval-service";
import { requireUser } from "@/server/auth/require-user";
import { ApprovalActions } from "./approval-actions";

export default async function ApprovalsPage() {
  const { user } = await requireUser();
  const pending = await ApprovalService.listPending(user.id);
  const decided = await ApprovalService.listRecentDecided(user.id);

  return (
    <section>
      <h1>Approvals</h1>

      <h2 style={{ marginTop: 24 }}>Pending</h2>
      {pending.length === 0 ? (
        <p>Nothing waiting on you.</p>
      ) : (
        <ul>
          {pending.map((a) => (
            <li key={a.id} style={{ marginBottom: 16 }}>
              <strong>{a.preview.title}</strong> — {a.preview.targetSummary} (risk: {a.risk})
              <ApprovalActions approval={a} />
            </li>
          ))}
        </ul>
      )}

      <h2 style={{ marginTop: 24 }}>Recent</h2>
      <ul>
        {decided.map((a) => (
          <li key={a.id}>
            [{a.status}] {a.preview.title}
          </li>
        ))}
      </ul>
    </section>
  );
}
