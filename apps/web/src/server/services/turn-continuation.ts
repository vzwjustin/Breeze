/**
 * Continue executing plan steps after an approval resumes mid-turn.
 */
import type { Plan, PlanStep, StepOutcomeLine } from "@breeze/common";
import { formatTurnReply } from "@breeze/common";
import { getAI } from "@/server/ai-instance";
import { getBroker } from "@/server/broker-instance";
import { ChatService } from "./chat-service";
import { PlanService } from "./plan-service";
import { executeNonActStep } from "./step-executor";
import { createHash } from "node:crypto";
import type { ActionRequest } from "@breeze/common";
import { prisma } from "@breeze/db";

const db = prisma as any;

export async function continuePlanAfterApproval(args: {
  planId: string;
  fromStepId: string;
  userId: string;
}): Promise<string> {
  const planRow = await db.plan.findUnique({
    where: { id: args.planId },
    include: { steps: { orderBy: { index: "asc" } } },
  });
  if (!planRow) throw new Error("Plan not found");

  const plan = await loadPlanFromRow(planRow);
  const startIndex = plan.steps.findIndex((s) => s.id === args.fromStepId);
  const remaining = startIndex >= 0 ? plan.steps.slice(startIndex + 1) : [];

  const chat = await ChatService.getOwned(planRow.chatId, args.userId);
  const ctx = await ChatService.buildContext(chat, args.userId);
  const ai = await getAI(args.userId);
  const stepOutcomes: StepOutcomeLine[] = [];

  for (const step of remaining) {
    await PlanService.markStepRunning(step.id);
    if (step.kind === "act") {
      const outcome = await getBroker().submit(buildActionRequest(step, args.userId, planRow.chatId));
      if (outcome.kind !== "allowed") {
        const detail =
          outcome.kind === "denied"
            ? outcome.reason
            : outcome.kind === "failed"
              ? outcome.errorMessage
              : "approval required";
        await PlanService.markStepFailed(step.id, detail);
        stepOutcomes.push({ stepId: step.id, kind: step.kind, status: "failed", label: step.capability, detail });
        break;
      }
      const detail = summarize(outcome.result.output);
      await PlanService.markStepCompleted(step.id, detail);
      stepOutcomes.push({ stepId: step.id, kind: step.kind, status: "completed", label: step.capability, detail });
    } else {
      const result = await executeNonActStep(step, {
        userId: args.userId,
        chatId: planRow.chatId,
        plan,
        ai,
        model: ctx.model,
      });
      if (result.status === "failed") {
        await PlanService.markStepFailed(step.id, result.detail ?? "failed");
        stepOutcomes.push({ stepId: step.id, kind: step.kind, status: "failed", detail: result.detail });
        break;
      }
      await PlanService.markStepCompleted(step.id, result.detail);
      stepOutcomes.push({ stepId: step.id, kind: step.kind, status: "completed", label: step.capability, detail: result.detail });
    }
  }

  await PlanService.finishPlan(plan.id, "COMPLETED");
  return formatTurnReply({ plan, status: "ok", stepOutcomes });
}

async function loadPlanFromRow(planRow: {
  id: string;
  chatId: string;
  messageId: string;
  intent: string;
  summaryText: string;
  riskLevel: string;
  createdAt: Date;
  steps: Array<{
    id: string;
    index: number;
    kind: string;
    capability: string | null;
    input: unknown;
    riskLevel: string;
  }>;
}): Promise<Plan> {
  const riskFromDb: Record<string, Plan["riskLevel"]> = {
    NONE: "none",
    LOW: "low",
    MEDIUM: "medium",
    HIGH: "high",
    CRITICAL: "critical",
  };
  const kindFromDb: Record<string, PlanStep["kind"]> = {
    RETRIEVE: "retrieve",
    SUMMARIZE: "summarize",
    DRAFT: "draft",
    ACT: "act",
    WAIT: "wait",
  };
  return {
    id: planRow.id,
    chatId: planRow.chatId,
    messageId: planRow.messageId,
    intent: planRow.intent as Plan["intent"],
    riskLevel: riskFromDb[planRow.riskLevel] ?? "none",
    summaryText: planRow.summaryText,
    steps: planRow.steps.map((s) => ({
      id: s.id,
      index: s.index,
      kind: kindFromDb[s.kind] ?? "summarize",
      capability: s.capability ?? undefined,
      input: (s.input as Record<string, unknown>) ?? {},
      riskLevel: riskFromDb[s.riskLevel] ?? "none",
      rationale: "",
    })),
    requires: [],
    approvalLikelihood: "none",
    createdAt: planRow.createdAt.toISOString(),
  };
}

function buildActionRequest(step: PlanStep, userId: string, chatId: string): ActionRequest {
  if (!step.capability) throw new Error("act-step missing capability");
  const [connector] = step.capability.split(".");
  return {
    idempotencyKey: createHash("sha256")
      .update(`${userId}:${step.id}:${JSON.stringify(step.input ?? {})}`)
      .digest("hex")
      .slice(0, 32),
    userId,
    planStepId: step.id,
    connector: connector!,
    capability: step.capability,
    input: step.input,
    correlationId: chatId,
  };
}

function summarize(output: Record<string, unknown> | undefined): string | undefined {
  if (!output) return undefined;
  if (typeof output.summary === "string") return output.summary;
  if (typeof output.message === "string") return output.message;
  try {
    return JSON.stringify(output).slice(0, 400);
  } catch {
    return undefined;
  }
}
