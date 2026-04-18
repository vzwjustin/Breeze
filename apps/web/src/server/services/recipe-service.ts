import { prisma } from "@breeze/db";
import {
  BreezeError,
  type CreateRecipeInput,
  type Recipe,
  type RecipeAction,
  type RecipeRunItemResult,
  type RecipeStatus,
} from "@breeze/common";
import { requireTrigger, requireCapability } from "@breeze/connectors";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = prisma as any;

function mapStatus(v: string): RecipeStatus {
  return v.toLowerCase() as RecipeStatus;
}

function toStatus(v: RecipeStatus): string {
  return v.toUpperCase();
}

interface RecipeRow {
  id: string;
  userId: string;
  name: string;
  description: string | null;
  trigger: Recipe["trigger"];
  actions: RecipeAction[];
  approvalMode: string;
  status: string;
  cursor: string | null;
  lastRunAt: Date | null;
  nextRunAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

function mapRow(row: RecipeRow): Recipe {
  return {
    id: row.id,
    userId: row.userId,
    name: row.name,
    description: row.description ?? undefined,
    trigger: row.trigger,
    actions: row.actions,
    approvalMode: row.approvalMode as Recipe["approvalMode"],
    status: mapStatus(row.status),
    cursor: row.cursor ?? undefined,
    lastRunAt: row.lastRunAt?.toISOString(),
    nextRunAt: row.nextRunAt?.toISOString(),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function validate(input: CreateRecipeInput): void {
  // Trigger must exist.
  requireTrigger(input.trigger.key);
  // Every action capability must be a real, registered capability — and
  // the connector part of the key must match the capability's connector.
  for (const a of input.actions) {
    const [connectorKey] = a.capability.split(".");
    if (!connectorKey) throw new BreezeError("validation", `Malformed capability: ${a.capability}`);
    requireCapability(connectorKey, a.capability);
  }
}

export const RecipeService = {
  async list(userId: string): Promise<Recipe[]> {
    const rows: RecipeRow[] = await db.recipe.findMany({
      where: { userId, deletedAt: null },
      orderBy: { updatedAt: "desc" },
      take: 200,
    });
    return rows.map(mapRow);
  },

  async get(id: string, userId: string): Promise<Recipe> {
    const row: RecipeRow | null = await db.recipe.findFirst({
      where: { id, userId, deletedAt: null },
    });
    if (!row) throw new BreezeError("not_found", "Recipe not found");
    return mapRow(row);
  },

  async create(userId: string, input: CreateRecipeInput): Promise<Recipe> {
    validate(input);
    const nextRunAt = new Date(Date.now() + input.trigger.pollSeconds * 1000);
    const row: RecipeRow = await db.recipe.create({
      data: {
        userId,
        name: input.name,
        description: input.description ?? null,
        trigger: input.trigger,
        actions: input.actions,
        approvalMode: input.approvalMode,
        nextRunAt,
      },
    });
    return mapRow(row);
  },

  async setStatus(id: string, userId: string, status: RecipeStatus): Promise<Recipe> {
    const existing: RecipeRow | null = await db.recipe.findFirst({
      where: { id, userId, deletedAt: null },
    });
    if (!existing) throw new BreezeError("not_found", "Recipe not found");
    const row: RecipeRow = await db.recipe.update({
      where: { id },
      data: { status: toStatus(status) },
    });
    return mapRow(row);
  },

  async saveCursor(id: string, cursor: string | undefined, nextRunAt: Date): Promise<void> {
    await db.recipe.update({
      where: { id },
      data: { cursor: cursor ?? null, lastRunAt: new Date(), nextRunAt },
    });
  },

  async recordRun(
    recipeId: string,
    result: {
      cursorBefore?: string;
      cursorAfter?: string;
      items: RecipeRunItemResult[];
      errorMessage?: string;
    }
  ): Promise<void> {
    await db.recipeRun.create({
      data: {
        recipeId,
        endedAt: new Date(),
        cursorBefore: result.cursorBefore ?? null,
        cursorAfter: result.cursorAfter ?? null,
        items: result.items,
        errorMessage: result.errorMessage ?? null,
      },
    });
  },
};
