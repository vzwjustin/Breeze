/**
 * Trigger.dev task: runs a user-created Task (cron/watch/once).
 *
 * Real implementation wraps in `@trigger.dev/sdk/v3`. This file is the
 * engine-agnostic pseudocode; see BLUEPRINT §16 and §26.6.
 */
import type { ActionRequest, ID } from "@breeze/common";

export interface UserTaskPayload {
  taskId: ID;
  triggerKind: "schedule" | "run_now" | "watch";
}

export interface UserTaskDeps {
  tasks: {
    get: (taskId: ID) => Promise<{ userId: ID; prompt: string; id: ID }>;
    startRun: (taskId: ID) => Promise<{ id: ID; userId: ID }>;
    completeRun: (runId: ID, summary: string) => Promise<void>;
    failRun: (runId: ID, error: string) => Promise<void>;
  };
  planner: {
    planForTask: (args: { userId: ID; taskRunId: ID; prompt: string }) => Promise<{
      steps: Array<
        | { kind: "retrieve" | "summarize" | "draft"; run: () => Promise<unknown> }
        | { kind: "act"; actionRequest: ActionRequest }
      >;
      summary: string;
    }>;
  };
  broker: {
    submit: (req: ActionRequest) => Promise<
      | { kind: "allowed"; result: unknown }
      | { kind: "approval_required"; approvalId: ID }
      | { kind: "denied"; reason: string }
      | { kind: "failed"; executionId: ID; errorMessage: string }
    >;
    resumeAfterApproval: (approvalId: ID) => Promise<
      | { kind: "allowed"; result: unknown }
      | { kind: "approval_required"; approvalId: ID }
      | { kind: "denied"; reason: string }
      | { kind: "failed"; executionId: ID; errorMessage: string }
    >;
  };
  wait: {
    forApproval: (approvalId: ID, timeoutMs: number) => Promise<
      | { ok: true; approvalId: ID }
      | { ok: false; reason: "denied" | "expired" }
    >;
  };
}

export async function runUserTask(payload: UserTaskPayload, deps: UserTaskDeps): Promise<void> {
  const task = await deps.tasks.get(payload.taskId);
  const run = await deps.tasks.startRun(task.id);

  try {
    const plan = await deps.planner.planForTask({
      userId: run.userId,
      taskRunId: run.id,
      prompt: task.prompt,
    });

    for (const step of plan.steps) {
      if (step.kind === "act") {
        const outcome = await deps.broker.submit(step.actionRequest);
        if (outcome.kind === "denied") {
          await deps.tasks.failRun(run.id, `Denied by policy: ${outcome.reason}`);
          return;
        }
        if (outcome.kind === "failed") {
          await deps.tasks.failRun(run.id, `Action failed: ${outcome.errorMessage}`);
          return;
        }
        if (outcome.kind === "approval_required") {
          const waited = await deps.wait.forApproval(outcome.approvalId, 24 * 60 * 60 * 1000);
          if (!waited.ok) {
            await deps.tasks.failRun(run.id, `Approval ${waited.reason}`);
            return;
          }
          const resumeOutcome = await deps.broker.resumeAfterApproval(waited.approvalId);
          if (resumeOutcome.kind === "failed") {
            await deps.tasks.failRun(run.id, `Action failed after approval: ${resumeOutcome.errorMessage}`);
            return;
          }
        }
      } else {
        await step.run();
      }
    }

    await deps.tasks.completeRun(run.id, plan.summary);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await deps.tasks.failRun(run.id, msg);
    throw err;
  }
}
