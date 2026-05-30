import { prisma } from "@breeze/db";
import { createHash } from "node:crypto";
import { formatTurnReply, newId, type ActionRequest, type Plan, type PlanStep } from "@breeze/common";
import { plan as plannerPlan } from "@breeze/planner";
import { getAI } from "@/server/ai-instance";
import { getBroker } from "@/server/broker-instance";
import { publicCatalog } from "@breeze/connectors";
import { createMemoryStore } from "@breeze/memory";
import { PlanService } from "@/server/services/plan-service";
import { executeNonActStep } from "@/server/services/step-executor";

const db = prisma as any;
const memoryStore = createMemoryStore(prisma);

export async function listDueTaskIds(limit = 10): Promise<string[]> {
  const rows = await db.task.findMany({
    where: {
      status: "ACTIVE",
      deletedAt: null,
      nextRunAt: { lte: new Date() },
    },
    orderBy: { nextRunAt: "asc" },
    take: limit,
    select: { id: true },
  });
  return rows.map((r: { id: string }) => r.id);
}

export async function runTaskById(taskId: string): Promise<void> {
  const task = await db.task.findFirst({
    where: { id: taskId, deletedAt: null },
  });
  if (!task || task.status !== "ACTIVE") return;

  const run = await db.taskRun.create({
    data: { taskId: task.id, status: "RUNNING" },
  });

  try {
    const accounts = await db.connectorAccount.findMany({
      where: { userId: task.userId, status: "ACTIVE", deletedAt: null },
      select: { connectorKey: true },
    });
    const connected = new Set<string>(accounts.map((a: { connectorKey: string }) => a.connectorKey));
    const memoryPack = await memoryStore.pack({ userId: task.userId, limit: 50 });
    const ai = await getAI(task.userId);
    const prefs = await db.user.findUnique({
      where: { id: task.userId },
      select: { preferences: true },
    });
    const model =
      (prefs?.preferences as { plannerModel?: string } | null)?.plannerModel?.trim() ||
      process.env.BREEZE_PLANNER_MODEL ||
      "claude-sonnet-4-6";

    const plannerCtx = {
      userId: task.userId,
      chatId: `task-${task.id}`,
      messageId: run.id,
      model,
      history: [{ role: "user" as const, content: task.prompt }],
      memoryPack,
      catalog: publicCatalog(connected),
      originatingKind: "task" as const,
    };

    let taskChat = await db.chat.findFirst({
      where: { userId: task.userId, title: `task:${task.id}`, deletedAt: null },
    });
    if (!taskChat) {
      taskChat = await db.chat.create({
        data: { userId: task.userId, title: `task:${task.id}` },
      });
    }
    const taskMessage = await db.message.create({
      data: {
        chatId: taskChat.id,
        role: "USER",
        content: { text: task.prompt },
      },
    });

    const rawPlan: Plan = await plannerPlan(
      { ...plannerCtx, chatId: taskChat.id, messageId: taskMessage.id },
      { ai }
    );
    const plan = await PlanService.save(rawPlan, taskMessage.id);

    for (const step of plan.steps) {
      if (step.kind === "act") {
        const outcome = await getBroker().submit(buildActionRequest(step, task.userId, taskChat.id));
        if (outcome.kind !== "allowed") {
          const reason =
            outcome.kind === "denied"
              ? outcome.reason
              : outcome.kind === "failed"
                ? outcome.errorMessage
                : "approval required";
          throw new Error(reason);
        }
        await PlanService.markStepCompleted(step.id, JSON.stringify(outcome.result.output ?? {}));
      } else {
        const result = await executeNonActStep(step, {
          userId: task.userId,
          chatId: taskChat.id,
          plan,
          ai,
          model,
        });
        if (result.status === "failed") throw new Error(result.detail ?? "step failed");
        await PlanService.markStepCompleted(step.id, result.detail);
      }
    }

    const summary = formatTurnReply({ plan, status: "ok", stepOutcomes: [] });
    await db.taskRun.update({
      where: { id: run.id },
      data: { status: "COMPLETED", endedAt: new Date(), summary, planId: plan.id },
    });
    await db.task.update({
      where: { id: task.id },
      data: { lastRunAt: new Date(), nextRunAt: computeNextRun(task.schedule) },
    });
    await PlanService.finishPlan(plan.id, "COMPLETED");
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await db.taskRun.update({
      where: { id: run.id },
      data: { status: "FAILED", endedAt: new Date(), errorMessage: msg },
    });
    await db.task.update({
      where: { id: task.id },
      data: { status: "FAILED", lastRunAt: new Date() },
    });
    throw err;
  }
}

function buildActionRequest(step: PlanStep, userId: string, correlationId: string): ActionRequest {
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
    correlationId,
  };
}

function computeNextRun(schedule: unknown): Date | null {
  if (!schedule || typeof schedule !== "object") return null;
  const s = schedule as { kind?: string; cron?: string; runAt?: string };
  if (s.kind === "once") return null;
  if (s.kind === "watch" && "source" in s) {
    const poll = (s as { source?: { pollSeconds?: number } }).source?.pollSeconds ?? 300;
    return new Date(Date.now() + poll * 1000);
  }
  return new Date(Date.now() + 60 * 60 * 1000);
}
