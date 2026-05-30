/**
 * Executes non-broker plan steps (retrieve, summarize, draft, wait) and
 * retrieve-style act steps that only read connector state.
 */
import type { AIProvider } from "@breeze/ai";
import type { Plan, PlanStep } from "@breeze/common";
import { getBroker } from "@/server/broker-instance";
import { createHash } from "node:crypto";
import type { ActionRequest, ActionOutcome } from "@breeze/common";

export interface StepExecutionContext {
  userId: string;
  chatId: string;
  plan: Plan;
  ai: AIProvider;
  model: string;
}

export interface StepExecutionResult {
  status: "completed" | "failed";
  detail?: string;
  brokerOutcome?: ActionOutcome;
}

export async function executeNonActStep(
  step: PlanStep,
  ctx: StepExecutionContext
): Promise<StepExecutionResult> {
  switch (step.kind) {
    case "wait":
      return executeWait(step);
    case "retrieve":
      return executeRetrieve(step, ctx);
    case "summarize":
      return executeSummarize(step, ctx);
    case "draft":
      return executeDraft(step, ctx);
    default:
      return { status: "completed", detail: "skipped" };
  }
}

async function executeWait(step: PlanStep): Promise<StepExecutionResult> {
  const raw = step.input?.delayMs;
  const delayMs = typeof raw === "number" ? raw : Number(raw ?? 0);
  if (delayMs > 0) {
    await new Promise((r) => setTimeout(r, Math.min(delayMs, 10_000)));
  }
  return { status: "completed", detail: delayMs > 0 ? `waited ${delayMs}ms` : "ready" };
}

async function executeRetrieve(
  step: PlanStep,
  ctx: StepExecutionContext
): Promise<StepExecutionResult> {
  if (step.capability) {
    return runBrokerStep(step, ctx);
  }
  const text = await ctx.ai.completeJson<{ summary: string }>({
    model: ctx.model,
    system: "You retrieve context for the user. Return JSON only.",
    user: `Summarize what to retrieve for this step:\n${JSON.stringify(step.input)}\nPlan: ${ctx.plan.summaryText}`,
    schemaName: "RetrieveNote",
  });
  return { status: "completed", detail: text.summary };
}

async function executeSummarize(
  step: PlanStep,
  ctx: StepExecutionContext
): Promise<StepExecutionResult> {
  if (step.capability) {
    return runBrokerStep(step, ctx);
  }
  const text = await ctx.ai.completeJson<{ summary: string }>({
    model: ctx.model,
    system: "You write concise summaries. Return JSON only.",
    user: [
      `Plan summary: ${ctx.plan.summaryText}`,
      `Step rationale: ${step.rationale}`,
      `Input: ${JSON.stringify(step.input)}`,
    ].join("\n"),
    schemaName: "StepSummary",
  });
  return { status: "completed", detail: text.summary };
}

async function executeDraft(
  step: PlanStep,
  ctx: StepExecutionContext
): Promise<StepExecutionResult> {
  if (step.capability) {
    return runBrokerStep(step, ctx);
  }
  const text = await ctx.ai.completeJson<{ draft: string }>({
    model: ctx.model,
    system: "You draft user-facing content. Return JSON only.",
    user: [
      `Plan summary: ${ctx.plan.summaryText}`,
      `Step rationale: ${step.rationale}`,
      `Input: ${JSON.stringify(step.input)}`,
    ].join("\n"),
    schemaName: "StepDraft",
  });
  return { status: "completed", detail: text.draft };
}

async function runBrokerStep(
  step: PlanStep,
  ctx: StepExecutionContext
): Promise<StepExecutionResult> {
  if (!step.capability) {
    return { status: "failed", detail: "missing capability" };
  }
  const [connector] = step.capability.split(".");
  const req: ActionRequest = {
    idempotencyKey: createHash("sha256")
      .update(`${ctx.userId}:${step.id}:${JSON.stringify(step.input ?? {})}`)
      .digest("hex")
      .slice(0, 32),
    userId: ctx.userId,
    planStepId: step.id,
    connector: connector!,
    capability: step.capability,
    input: step.input ?? {},
    correlationId: ctx.chatId,
  };
  const outcome = await getBroker().submit(req);
  if (outcome.kind === "approval_required") {
    return { status: "failed", detail: "approval_required", brokerOutcome: outcome };
  }
  if (outcome.kind === "denied") {
    return { status: "failed", detail: outcome.reason, brokerOutcome: outcome };
  }
  if (outcome.kind === "failed") {
    return { status: "failed", detail: outcome.errorMessage, brokerOutcome: outcome };
  }
  const detail =
    typeof outcome.result.output?.summary === "string"
      ? outcome.result.output.summary
      : JSON.stringify(outcome.result.output ?? {}).slice(0, 500);
  return { status: "completed", detail, brokerOutcome: outcome };
}
