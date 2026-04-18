/**
 * Approval watchdog: every 5 minutes, expire pending approvals past their
 * expiresAt, emit `approval.expired`, and mark plan step failed(expired).
 */
export interface ApprovalWatchdogDeps {
  approvals: {
    listPendingExpired: () => Promise<Array<{ id: string; planStepId: string }>>;
    expire: (id: string) => Promise<void>;
  };
  planSteps: {
    markExpired: (planStepId: string) => Promise<void>;
  };
  events: {
    emit: (type: "approval.expired", payload: { approvalId: string }) => Promise<void>;
  };
}

export async function runApprovalWatchdog(deps: ApprovalWatchdogDeps): Promise<void> {
  const expired = await deps.approvals.listPendingExpired();
  for (const a of expired) {
    try {
      await deps.approvals.expire(a.id);
      await deps.planSteps.markExpired(a.planStepId);
      await deps.events.emit("approval.expired", { approvalId: a.id });
    } catch (err) {
      console.error(`[approval-watchdog] failed to expire approval ${a.id}:`, err);
    }
  }
}
