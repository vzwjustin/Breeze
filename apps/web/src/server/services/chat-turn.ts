/**
 * Orchestrates a single chat turn. Glue between planner, retriever, and
 * broker. Streams events to the SSE writer. See BLUEPRINT §26.1.
 */
import { plan as plannerPlan } from "@breeze/planner";
import { createHash } from "node:crypto";
import { type Plan, type PlanStep, type ActionRequest } from "@breeze/common";
import { getBroker } from "@/server/broker-instance";
import { getAI } from "@/server/ai-instance";
import { ChatService, type ChatRow, type MessageRow } from "./chat-service";
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

    const streamPlanner = process.env.BREEZE_STREAM_PLANNER === "1" && ai.kind === "anthropic";

    // Streaming planner path is stubbed — requires planner to expose raw
    // prompt messages. Today all planner calls are non-streaming.
    void streamPlanner;
    const plan: Plan = await plannerPlan(ctx as Parameters<typeof plannerPlan>[0], { ai });

    write({ type: "plan.created", plan });

    for (const step of plan.steps) {
      if (signal?.aborted) {
        write({ type: "turn.completed", status: "aborted" });
        close();
        return;
      }
      write({ type: "step.started", stepId: step.id, kind: step.kind });
      if (step.kind === "act") {
        const req = buildActionRequest(step, user.id, chat.id);
        const outcome = await getBroker().submit(req);
        if (outcome.kind === "approval_required") {
          write({ type: "approval.requested", approvalId: outcome.approvalId, stepId: step.id });
          write({ type: "turn.paused", reason: "awaiting_approval" });
          close();
          return;
        }
        if (outcome.kind === "denied") {
          write({ type: "step.failed", stepId: step.id, reason: outcome.reason });
          write({ type: "turn.completed", status: "failed" });
          close();
          return;
        }
        if (outcome.kind === "failed") {
          write({ type: "step.failed", stepId: step.id, reason: outcome.errorMessage });
          write({ type: "turn.completed", status: "failed" });
          close();
          return;
        }
        write({ type: "step.completed", stepId: step.id, result: outcome.result });
      } else {
        // retrieve / summarize / draft / wait — handled by a retriever module.
        write({ type: "step.completed", stepId: step.id });
      }
    }

    write({ type: "turn.completed", status: "ok" });
    close();
  },
};

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
