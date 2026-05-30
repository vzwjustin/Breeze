/**
 * Orchestrates a single chat turn. Glue between planner, retriever, and
 * broker. Streams events to the SSE writer. See BLUEPRINT §26.1.
 */
import { plan as plannerPlan } from "@breeze/planner";
import { createHash } from "node:crypto";
import {
  formatTurnReply,
  type Plan,
  type PlanStep,
  type ActionRequest,
  type StepOutcomeLine,
} from "@breeze/common";
import { getBroker } from "@/server/broker-instance";
import { getAI } from "@/server/ai-instance";
import { ChatService, type ChatRow, type MessageRow } from "./chat-service";
import { PlanService } from "./plan-service";
import { executeNonActStep } from "./step-executor";
import type { AuthedUser } from "@/server/auth/require-user";

export interface TurnArgs {
  user: AuthedUser;
  chat: ChatRow;
  userMessage: MessageRow;
  write: (event: unknown) => void;
  close: () => void;
  signal?: AbortSignal;
}

export const ChatTurn = {
  async run({ user, chat, userMessage, write, close, signal }: TurnArgs): Promise<void> {
    write({ type: "turn.started", chatId: chat.id });

    const ctx = await ChatService.buildContext(chat, user.id);
    const ai = await getAI(user.id);

    const rawPlan: Plan = await plannerPlan(ctx as Parameters<typeof plannerPlan>[0], { ai });
    const plan = await PlanService.save(rawPlan, userMessage.id);

    write({ type: "plan.created", plan });
    write({ type: "assistant.message", content: plan.summaryText, partial: true });

    const stepOutcomes: StepOutcomeLine[] = [];

    for (const step of plan.steps) {
      if (signal?.aborted) {
        await PlanService.finishPlan(plan.id, "CANCELED");
        await finishTurn({
          chat,
          plan,
          status: "aborted",
          stepOutcomes,
          write,
          close,
        });
        return;
      }

      write({ type: "step.started", stepId: step.id, kind: step.kind });
      await PlanService.markStepRunning(step.id);

      if (step.kind === "act") {
        const handled = await runActStep({
          step,
          userId: user.id,
          chat,
          plan,
          stepOutcomes,
          write,
          close,
        });
        if (handled) return;
        continue;
      }

      try {
        const result = await executeNonActStep(step, {
          userId: user.id,
          chatId: chat.id,
          plan,
          ai,
          model: ctx.model,
        });

        if (result.brokerOutcome?.kind === "approval_required") {
          await PlanService.markStepAwaitingApproval(step.id);
          stepOutcomes.push({
            stepId: step.id,
            kind: step.kind,
            status: "skipped",
            label: step.capability,
            detail: "awaiting approval",
          });
          write({
            type: "approval.requested",
            approvalId: result.brokerOutcome.approvalId,
            stepId: step.id,
          });
          await PlanService.finishPlan(plan.id, "CANCELED");
          await finishTurn({
            chat,
            plan,
            status: "paused",
            stepOutcomes,
            pauseReason: "awaiting_approval",
            write,
            close,
          });
          return;
        }

        if (result.status === "failed") {
          await PlanService.markStepFailed(step.id, result.detail ?? "failed");
          stepOutcomes.push({
            stepId: step.id,
            kind: step.kind,
            status: "failed",
            label: step.capability,
            detail: result.detail,
          });
          write({ type: "step.failed", stepId: step.id, reason: result.detail });
          await PlanService.finishPlan(plan.id, "FAILED");
          await finishTurn({
            chat,
            plan,
            status: "failed",
            stepOutcomes,
            write,
            close,
          });
          return;
        }

        await PlanService.markStepCompleted(step.id, result.detail);
        stepOutcomes.push({
          stepId: step.id,
          kind: step.kind,
          status: "completed",
          label: step.capability,
          detail: result.detail,
        });
        write({ type: "step.completed", stepId: step.id, result: { detail: result.detail } });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        await PlanService.markStepFailed(step.id, msg);
        stepOutcomes.push({ stepId: step.id, kind: step.kind, status: "failed", detail: msg });
        write({ type: "step.failed", stepId: step.id, reason: msg });
        await PlanService.finishPlan(plan.id, "FAILED");
        await finishTurn({ chat, plan, status: "failed", stepOutcomes, write, close });
        return;
      }
    }

    await PlanService.finishPlan(plan.id, "COMPLETED");
    await finishTurn({
      chat,
      plan,
      status: "ok",
      stepOutcomes,
      write,
      close,
    });
  },
};

async function runActStep(args: {
  step: PlanStep;
  userId: string;
  chat: ChatRow;
  plan: Plan;
  stepOutcomes: StepOutcomeLine[];
  write: (event: unknown) => void;
  close: () => void;
}): Promise<boolean> {
  const { step, userId, chat, plan, stepOutcomes, write, close } = args;
  const req = buildActionRequest(step, userId, chat.id);
  const outcome = await getBroker().submit(req);

  if (outcome.kind === "approval_required") {
    await PlanService.markStepAwaitingApproval(step.id);
    stepOutcomes.push({
      stepId: step.id,
      kind: step.kind,
      status: "skipped",
      label: step.capability,
      detail: "awaiting approval",
    });
    write({ type: "approval.requested", approvalId: outcome.approvalId, stepId: step.id });
    await PlanService.finishPlan(plan.id, "CANCELED");
    await finishTurn({
      chat,
      plan,
      status: "paused",
      stepOutcomes,
      pauseReason: "awaiting_approval",
      write,
      close,
    });
    return true;
  }

  if (outcome.kind === "denied") {
    await PlanService.markStepFailed(step.id, outcome.reason);
    stepOutcomes.push({
      stepId: step.id,
      kind: step.kind,
      status: "failed",
      label: step.capability,
      detail: outcome.reason,
    });
    write({ type: "step.failed", stepId: step.id, reason: outcome.reason });
    await PlanService.finishPlan(plan.id, "FAILED");
    await finishTurn({
      chat,
      plan,
      status: "failed",
      stepOutcomes,
      write,
      close,
    });
    return true;
  }

  if (outcome.kind === "failed") {
    await PlanService.markStepFailed(step.id, outcome.errorMessage);
    stepOutcomes.push({
      stepId: step.id,
      kind: step.kind,
      status: "failed",
      label: step.capability,
      detail: outcome.errorMessage,
    });
    write({ type: "step.failed", stepId: step.id, reason: outcome.errorMessage });
    await PlanService.finishPlan(plan.id, "FAILED");
    await finishTurn({
      chat,
      plan,
      status: "failed",
      stepOutcomes,
      write,
      close,
    });
    return true;
  }

  const detail = summarizeActionResult(outcome.result.output);
  await PlanService.markStepCompleted(step.id, detail);
  stepOutcomes.push({
    stepId: step.id,
    kind: step.kind,
    status: "completed",
    label: step.capability,
    detail,
  });
  write({ type: "step.completed", stepId: step.id, result: outcome.result });
  return false;
}

async function finishTurn(args: {
  chat: ChatRow;
  plan: Plan;
  status: "ok" | "failed" | "aborted" | "paused";
  stepOutcomes: StepOutcomeLine[];
  pauseReason?: string;
  write: (event: unknown) => void;
  close: () => void;
}): Promise<void> {
  const content = formatTurnReply({
    plan: args.plan,
    status: args.status,
    stepOutcomes: args.stepOutcomes,
    pauseReason: args.pauseReason,
  });

  const saved = await ChatService.appendAssistantMessage(args.chat.id, { text: content });
  args.write({
    type: "assistant.message",
    content,
    partial: false,
    messageId: saved.id,
  });
  if (args.status === "paused") {
    args.write({ type: "turn.paused", reason: args.pauseReason ?? "paused", status: args.status });
  } else {
    args.write({ type: "turn.completed", status: args.status });
  }
  args.close();
}

function summarizeActionResult(output: Record<string, unknown> | undefined): string | undefined {
  if (!output) return undefined;
  if (typeof output.summary === "string") return output.summary;
  if (typeof output.message === "string") return output.message;
  if (typeof output.id === "string") return output.id;
  const keys = Object.keys(output);
  if (keys.length === 0) return undefined;
  if (keys.length <= 3) {
    try {
      return JSON.stringify(output);
    } catch {
      return undefined;
    }
  }
  return `${keys.length} fields updated`;
}

function buildActionRequest(step: PlanStep, userId: string, chatId: string): ActionRequest {
  if (!step.capability) throw new Error("act-step missing capability");
  const [connector] = step.capability.split(".");
  const idempotencyKey = createHash("sha256")
    .update(`${userId}:${step.id}:${JSON.stringify(step.input ?? {})}`)
    .digest("hex")
    .slice(0, 32);
  return {
    idempotencyKey,
    userId,
    planStepId: step.id,
    connector: connector!,
    capability: step.capability,
    input: step.input,
    correlationId: chatId,
  };
}
