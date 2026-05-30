import { prisma } from "@breeze/db";
import { createLogger, newId, type ID, type Recipe, type RecipeRun } from "@breeze/common";
import { runRecipe, type RecipeRunnerDeps } from "@breeze/workflows";
import { requireTrigger } from "@breeze/connectors";
import { RecipeService } from "@/server/services/recipe-service";
import { getBroker } from "@/server/broker-instance";
import { getConnectorAccount, getFreshTokensForWorker } from "./connector-tokens.js";

const db = prisma as any;
const log = createLogger({ component: "recipe-runner" });

export async function listDueRecipeIds(limit = 20): Promise<ID[]> {
  const rows = await db.recipe.findMany({
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

export function createRecipeRunnerDeps(): RecipeRunnerDeps {
  return {
    recipes: {
      async get(recipeId: ID): Promise<Recipe> {
        const row = await db.recipe.findFirst({
          where: { id: recipeId, deletedAt: null },
        });
        if (!row) throw new Error(`Recipe ${recipeId} not found`);
        return RecipeService.get(recipeId, row.userId);
      },
      saveCursor: (recipeId, cursor, nextRunAt) =>
        RecipeService.saveCursor(recipeId, cursor, nextRunAt),
    },
    runs: {
      async start(recipeId: ID, cursorBefore?: string) {
        const run = await db.recipeRun.create({
          data: { recipeId, cursorBefore: cursorBefore ?? null },
        });
        return { id: run.id };
      },
      async complete(runId: ID, result: Omit<RecipeRun, "id" | "recipeId" | "startedAt">) {
        await db.recipeRun.update({
          where: { id: runId },
          data: {
            endedAt: new Date(result.endedAt ?? new Date()),
            cursorBefore: result.cursorBefore ?? null,
            cursorAfter: result.cursorAfter ?? null,
            items: result.items,
            errorMessage: null,
          },
        });
      },
      async fail(runId: ID, errorMessage: string) {
        await db.recipeRun.update({
          where: { id: runId },
          data: { endedAt: new Date(), errorMessage },
        });
      },
    },
    triggers: { require: requireTrigger },
    connectors: {
      getAccount: getConnectorAccount,
      getFreshTokens: getFreshTokensForWorker,
    },
    broker: { submit: (req) => getBroker().submit(req) },
    logger: {
      info: (msg, data) => log.info(msg, data as Record<string, unknown> | undefined),
      warn: (msg, data) => log.warn(msg, data as Record<string, unknown> | undefined),
      error: (msg, data) => log.error(msg, data as Record<string, unknown> | undefined),
    },
  };
}

export async function runRecipeNow(recipeId: string, userId: string): Promise<{ runId: string }> {
  await RecipeService.get(recipeId, userId);
  await db.recipe.update({
    where: { id: recipeId },
    data: { nextRunAt: new Date() },
  });
  const deps = createRecipeRunnerDeps();
  await runRecipe({ recipeId }, deps);
  const latest = await db.recipeRun.findFirst({
    where: { recipeId },
    orderBy: { startedAt: "desc" },
    select: { id: true },
  });
  return { runId: latest?.id ?? newId() };
}
