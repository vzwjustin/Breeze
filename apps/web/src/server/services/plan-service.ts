import { prisma } from "@breeze/db";
import type { Plan, PlanStep, RiskLevel, StepKind } from "@breeze/common";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = prisma as any;

const RISK_TO_DB: Record<RiskLevel, string> = {
  none: "NONE",
  low: "LOW",
  medium: "MEDIUM",
  high: "HIGH",
  critical: "CRITICAL",
};

const KIND_TO_DB: Record<StepKind, string> = {
  retrieve: "RETRIEVE",
  summarize: "SUMMARIZE",
  draft: "DRAFT",
  act: "ACT",
  wait: "WAIT",
};

export const PlanService = {
  /**
   * Persist planner output before broker or step execution so FK constraints
   * on PlanStep ids are satisfied.
   */
  async save(plan: Plan, messageId: string): Promise<Plan> {
    const existing = await db.plan.findUnique({ where: { messageId } });
    if (existing) {
      return loadPlan(existing.id);
    }

    await db.plan.create({
      data: {
        id: plan.id,
        chatId: plan.chatId,
        messageId,
        intent: plan.intent,
        summaryText: plan.summaryText,
        riskLevel: RISK_TO_DB[plan.riskLevel],
        status: "RUNNING",
        steps: {
          create: plan.steps.map((step) => ({
            id: step.id,
            index: step.index,
            kind: KIND_TO_DB[step.kind],
            capability: step.capability ?? null,
            input: step.input ?? {},
            expectedArtifact: step.expectedArtifact
              ? JSON.stringify(step.expectedArtifact)
              : null,
            riskLevel: RISK_TO_DB[step.riskLevel],
            status: "PENDING",
          })),
        },
      },
    });

    return plan;
  },

  async markStepRunning(stepId: string): Promise<void> {
    await db.planStep.update({
      where: { id: stepId },
      data: { status: "RUNNING" },
    });
  },

  async markStepCompleted(stepId: string, resultSummary?: string): Promise<void> {
    await db.planStep.update({
      where: { id: stepId },
      data: { status: "COMPLETED", resultSummary: resultSummary ?? null },
    });
  },

  async markStepFailed(stepId: string, errorMessage: string): Promise<void> {
    await db.planStep.update({
      where: { id: stepId },
      data: { status: "FAILED", errorMessage },
    });
  },

  async markStepAwaitingApproval(stepId: string): Promise<void> {
    await db.planStep.update({
      where: { id: stepId },
      data: { status: "AWAITING_APPROVAL" },
    });
  },

  async finishPlan(planId: string, status: "COMPLETED" | "FAILED" | "CANCELED"): Promise<void> {
    await db.plan.update({
      where: { id: planId },
      data: { status },
    });
  },

  async getStep(stepId: string) {
    return db.planStep.findUnique({
      where: { id: stepId },
      include: { plan: { select: { id: true, chatId: true, messageId: true } } },
    });
  },
};

async function loadPlan(planId: string): Promise<Plan> {
  const row = await db.plan.findUnique({
    where: { id: planId },
    include: { steps: { orderBy: { index: "asc" } } },
  });
  if (!row) throw new Error(`Plan ${planId} not found`);

  const riskFromDb: Record<string, RiskLevel> = {
    NONE: "none",
    LOW: "low",
    MEDIUM: "medium",
    HIGH: "high",
    CRITICAL: "critical",
  };
  const kindFromDb: Record<string, StepKind> = {
    RETRIEVE: "retrieve",
    SUMMARIZE: "summarize",
    DRAFT: "draft",
    ACT: "act",
    WAIT: "wait",
  };

  return {
    id: row.id,
    chatId: row.chatId,
    messageId: row.messageId,
    intent: row.intent,
    riskLevel: riskFromDb[String(row.riskLevel)] ?? "none",
    summaryText: row.summaryText,
    steps: row.steps.map(
      (s: {
        id: string;
        index: number;
        kind: string;
        capability: string | null;
        input: unknown;
        riskLevel: string;
        rationale?: string;
      }): PlanStep => ({
        id: s.id,
        index: s.index,
        kind: kindFromDb[s.kind] ?? "summarize",
        capability: s.capability ?? undefined,
        input: (s.input as Record<string, unknown>) ?? {},
        riskLevel: riskFromDb[s.riskLevel] ?? "none",
        rationale: "",
      })
    ),
    requires: [],
    approvalLikelihood: "none",
    createdAt: row.createdAt.toISOString(),
  };
}
