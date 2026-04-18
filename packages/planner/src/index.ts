/**
 * Planner service.
 *
 *   plan(ctx) -> Plan
 *
 * Rules (BLUEPRINT §10):
 *   - NO side effects. No connector calls. No mutation.
 *   - Output is Zod-validated; on failure, repair-retry once.
 *   - Falls back to `intent: "chat"` if validation repeatedly fails.
 */
import {
  PlanSchema,
  newId,
  type Plan,
  type PlanStep,
  type MemoryRecord,
} from "@breeze/common";
import type { AIProvider } from "@breeze/ai";
import type { PublicCapability } from "@breeze/connectors";

export interface PlannerContext {
  userId: string;
  chatId: string;
  messageId: string;
  model: string;
  history: Array<{ role: "user" | "assistant" | "system"; content: string }>;
  memoryPack: MemoryRecord[];
  catalog: PublicCapability[];
  originatingKind: "chat" | "task";
}

export interface PlannerDeps {
  ai: AIProvider;
}

export async function plan(
  ctx: PlannerContext,
  deps: PlannerDeps
): Promise<Plan> {
  const systemPrompt = buildSystemPrompt(ctx);
  const userPrompt = buildUserPrompt(ctx);

  const raw = await deps.ai.completeJson({
    model: ctx.model,
    system: systemPrompt,
    user: userPrompt,
    schemaName: "BreezePlan",
  });

  const parsed = PlanSchema.safeParse({
    ...raw,
    id: raw?.id ?? newId(),
    chatId: ctx.chatId,
    messageId: ctx.messageId,
    createdAt: raw?.createdAt ?? new Date().toISOString(),
  });

  if (parsed.success) return parsed.data;

  // Repair-retry once.
  const repaired = await deps.ai.completeJson({
    model: ctx.model,
    system: systemPrompt,
    user: `${userPrompt}\n\nYour previous response failed validation: ${parsed.error.message}. Return a corrected JSON object.`,
    schemaName: "BreezePlan",
  });

  const repairedParsed = PlanSchema.safeParse({
    ...repaired,
    id: repaired?.id ?? newId(),
    chatId: ctx.chatId,
    messageId: ctx.messageId,
    createdAt: new Date().toISOString(),
  });

  if (repairedParsed.success) return repairedParsed.data;

  return fallbackChatPlan(ctx);
}

function buildSystemPrompt(ctx: PlannerContext): string {
  return [
    "You are the Breeze planner. Produce a typed Plan object.",
    "You do not execute actions. You only describe a plan.",
    "Capabilities available to you:",
    ctx.catalog
      .map(
        (c) =>
          `- ${c.key} (connector=${c.connector}, sensitivity=${c.sensitivity}, mutatesState=${c.mutatesState}) — ${c.description}`
      )
      .join("\n"),
    "If no capability fits, respond with intent='chat' and no act-steps.",
  ].join("\n");
}

function buildUserPrompt(ctx: PlannerContext): string {
  const history = ctx.history
    .slice(-10)
    .map((m) => `${m.role.toUpperCase()}: ${m.content}`)
    .join("\n");
  const memory = ctx.memoryPack
    .filter((m) => m.visibility === "user_visible")
    .map((m) => `- ${m.key}: ${JSON.stringify(m.value)} (because ${m.reason})`)
    .join("\n");
  return [
    "Relevant memory:",
    memory || "(none)",
    "Recent conversation:",
    history,
    "",
    "Produce a Plan JSON object matching the required schema.",
  ].join("\n");
}

function fallbackChatPlan(ctx: PlannerContext): Plan {
  const step: PlanStep = {
    id: newId(),
    index: 0,
    kind: "summarize",
    input: {},
    riskLevel: "none",
    rationale: "Planner could not produce a structured plan; replying as chat.",
  };
  return {
    id: newId(),
    chatId: ctx.chatId,
    messageId: ctx.messageId,
    intent: "chat",
    riskLevel: "none",
    summaryText: "I'll answer directly.",
    steps: [step],
    requires: [],
    approvalLikelihood: "none",
    createdAt: new Date().toISOString(),
  };
}
