/**
 * Single worker tick: recipes, tasks, approval expiry, event outbox.
 * Invoked by cron (`POST /api/internal/worker/tick`) or `pnpm --filter @breeze/web worker`.
 */
import { createLogger } from "@breeze/common";
import { runEventDispatcher } from "@breeze/workflows";
import { runApprovalWatchdog } from "@breeze/workflows";
import { runRecipe } from "@breeze/workflows";
import { createEventDispatcherDeps } from "./event-adapter.js";
import { createApprovalWatchdogDeps } from "./approval-adapter.js";
import { createRecipeRunnerDeps, listDueRecipeIds } from "./recipe-adapter.js";
import { listDueTaskIds, runTaskById } from "./task-adapter.js";

const log = createLogger({ component: "worker" });

export interface WorkerTickResult {
  recipes: { attempted: number; errors: string[] };
  tasks: { attempted: number; errors: string[] };
  events: { published: number };
  approvals: { expired: number };
}

export async function runWorkerTick(): Promise<WorkerTickResult> {
  const result: WorkerTickResult = {
    recipes: { attempted: 0, errors: [] },
    tasks: { attempted: 0, errors: [] },
    events: { published: 0 },
    approvals: { expired: 0 },
  };

  const recipeIds = await listDueRecipeIds(15);
  const recipeDeps = createRecipeRunnerDeps();
  for (const recipeId of recipeIds) {
    result.recipes.attempted++;
    try {
      await runRecipe({ recipeId }, recipeDeps);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      result.recipes.errors.push(`${recipeId}: ${msg}`);
      log.warn("recipe tick failed", { recipeId, error: msg });
    }
  }

  const taskIds = await listDueTaskIds(10);
  for (const taskId of taskIds) {
    result.tasks.attempted++;
    try {
      await runTaskById(taskId);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      result.tasks.errors.push(`${taskId}: ${msg}`);
      log.warn("task tick failed", { taskId, error: msg });
    }
  }

  const eventDeps = createEventDispatcherDeps();
  const pending = await eventDeps.outbox.drainBatch(100);
  if (pending.length > 0) {
    await runEventDispatcher(eventDeps, pending.length);
    result.events.published = pending.length;
  }

  const approvalDeps = createApprovalWatchdogDeps();
  const expiredBefore = await approvalDeps.approvals.listPendingExpired();
  await runApprovalWatchdog(approvalDeps);
  result.approvals.expired = expiredBefore.length;

  log.info("worker tick complete", result as unknown as Record<string, unknown>);
  return result;
}
