/**
 * Recipe runner — the "then that" half. Polls a Recipe's trigger, renders
 * each action's input template against the emitted item, submits through
 * the broker, and advances the stored cursor.
 *
 * The runner is idempotent per-item: we build an idempotency key from the
 * recipe id, the item key, and the action index. If the user re-runs a
 * recipe over the same window the broker short-circuits already-executed
 * actions.
 */
import {
  idempotencyKey,
  newId,
  renderTemplate,
  type ActionOutcome,
  type ActionRequest,
  type ID,
  type Recipe,
  type RecipeRun,
  type RecipeRunItemResult,
} from "@breeze/common";
import type {
  ConnectorAccountHandle,
  ConnectorExecutionContext,
  ConnectorTokens,
  ConnectorTrigger,
} from "@breeze/connectors";

export interface RecipeRunnerDeps {
  recipes: {
    get: (recipeId: ID) => Promise<Recipe>;
    saveCursor: (recipeId: ID, cursor: string | undefined, nextRunAt: Date) => Promise<void>;
  };
  runs: {
    start: (recipeId: ID, cursorBefore?: string) => Promise<{ id: ID }>;
    complete: (runId: ID, result: Omit<RecipeRun, "id" | "recipeId" | "startedAt">) => Promise<void>;
    fail: (runId: ID, errorMessage: string) => Promise<void>;
  };
  triggers: {
    require: (key: string) => ConnectorTrigger;
  };
  connectors: {
    getAccount: (userId: ID, connectorKey: string) => Promise<ConnectorAccountHandle>;
    getFreshTokens: (account: ConnectorAccountHandle) => Promise<ConnectorTokens>;
  };
  broker: {
    submit: (req: ActionRequest) => Promise<ActionOutcome>;
  };
  logger: {
    info: (msg: string, data?: unknown) => void;
    warn: (msg: string, data?: unknown) => void;
    error: (msg: string, data?: unknown) => void;
  };
}

function splitTriggerKey(key: string): string {
  const [connector] = key.split(".");
  if (!connector) throw new Error(`Malformed trigger key: ${key}`);
  return connector;
}

function buildCtx(
  account: ConnectorAccountHandle,
  tokens: ConnectorTokens,
  signal: AbortSignal,
  logger: RecipeRunnerDeps["logger"]
): ConnectorExecutionContext {
  return { account, tokens, signal, logger };
}

export interface RecipeRunnerPayload {
  recipeId: ID;
}

export async function runRecipe(
  payload: RecipeRunnerPayload,
  deps: RecipeRunnerDeps
): Promise<void> {
  const recipe = await deps.recipes.get(payload.recipeId);
  if (recipe.status !== "active") {
    deps.logger.info(`recipe ${recipe.id} is ${recipe.status}; skipping`);
    return;
  }

  const run = await deps.runs.start(recipe.id, recipe.cursor);
  const trigger = deps.triggers.require(recipe.trigger.key);
  const connectorKey = splitTriggerKey(recipe.trigger.key);

  try {
    const account = await deps.connectors.getAccount(recipe.userId, connectorKey);
    const tokens = await deps.connectors.getFreshTokens(account);
    const controller = new AbortController();
    const ctx = buildCtx(account, tokens, controller.signal, deps.logger);

    const parsed = trigger.inputSchema.safeParse(recipe.trigger.input);
    if (!parsed.success) {
      throw new Error(`trigger ${trigger.key} input failed validation: ${parsed.error.message}`);
    }

    const polled = await trigger.poll({ input: parsed.data, cursor: recipe.cursor, ctx });
    deps.logger.info(`recipe ${recipe.id}: ${polled.items.length} new item(s)`);

    const itemResults: RecipeRunItemResult[] = [];
    for (const item of polled.items) {
      const perItem: RecipeRunItemResult = { itemKey: item.key, actions: [] };
      const scope = { item: item.data as Record<string, unknown>, recipe: { id: recipe.id, name: recipe.name } };

      for (let i = 0; i < recipe.actions.length; i++) {
        const action = recipe.actions[i]!;
        const rendered = renderTemplate(action.inputTemplate, scope);
        const [actionConnector] = action.capability.split(".");
        if (!actionConnector) throw new Error(`Malformed capability: ${action.capability}`);
        const req: ActionRequest = {
          idempotencyKey: idempotencyKey(["recipe", recipe.id, item.key, String(i)]),
          userId: recipe.userId,
          planStepId: `${run.id}:${i}`,
          connector: actionConnector,
          capability: action.capability,
          input: rendered,
          correlationId: run.id,
        };
        const outcome = await deps.broker.submit(req);
        if (outcome.kind === "allowed") {
          perItem.actions.push({
            capability: action.capability,
            outcome: "allowed",
            detail: outcome.result.ok ? undefined : outcome.result.errorMessage,
          });
        } else if (outcome.kind === "approval_required") {
          perItem.actions.push({
            capability: action.capability,
            outcome: "approval_required",
            detail: outcome.approvalId,
          });
          // Do not execute later actions for this item until the approval
          // resolves. The per-item chain is conservative: a user approving
          // later triggers resumeAfterApproval out-of-band.
          break;
        } else {
          perItem.actions.push({ capability: action.capability, outcome: "denied", detail: outcome.reason });
          break;
        }
      }

      itemResults.push(perItem);
    }

    const nextRunAt = new Date(Date.now() + recipe.trigger.pollSeconds * 1000);
    await deps.recipes.saveCursor(recipe.id, polled.cursor, nextRunAt);
    await deps.runs.complete(run.id, {
      items: itemResults,
      cursorBefore: recipe.cursor,
      cursorAfter: polled.cursor,
      endedAt: new Date().toISOString(),
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    deps.logger.error(`recipe ${recipe.id} failed: ${msg}`);
    await deps.runs.fail(run.id, msg);
    throw err;
  }
}

// Stable id helper — kept local so test harnesses can stub newId without
// touching this module's imports.
export function __makeRunId(): ID {
  return newId();
}
