import { prisma } from "@breeze/db";
import { newId } from "@breeze/common";
import type { ApprovalWatchdogDeps } from "@breeze/workflows";
import { PlanService } from "@/server/services/plan-service";

const db = prisma as any;

export function createApprovalWatchdogDeps(): ApprovalWatchdogDeps {
  return {
    approvals: {
      async listPendingExpired() {
        const rows = await db.approval.findMany({
          where: { status: "PENDING", expiresAt: { lt: new Date() } },
          select: { id: true, planStepId: true },
          take: 100,
        });
        return rows;
      },
      async expire(id: string) {
        await db.approval.update({
          where: { id },
          data: { status: "EXPIRED", decidedAt: new Date() },
        });
      },
    },
    planSteps: {
      markExpired: (planStepId: string) =>
        PlanService.markStepFailed(planStepId, "Approval expired"),
    },
    events: {
      async emit(_type, payload) {
        await db.eventOutbox.create({
          data: {
            id: newId(),
            type: "approval.expired",
            payload: { type: "approval.expired", payload, createdAt: new Date().toISOString() },
          },
        });
      },
    },
  };
}
