/**
 * Planner service.
 *
 *   plan(ctx) -> Plan
 *
 * Rules (BLUEPRINT §10):
 *   - NO side effects. No connector calls. No mutation.
 *   - Output is Zod-validated; on failure, repair-retry once.
 *   - Falls back to `intent: "chat"` if validation repeatedly fails.
 *
 * Strategy:
 *   - For Anthropic providers, uses tool-use with a `submit_plan` tool whose
 *     input_schema mirrors PlanSchema. This avoids fragile JSON extraction.
 *   - For all other providers, falls back to the original completeJson path.
 */
import {
  PlanSchema,
  newId,
  type Plan,
  type PlanStep,
  type MemoryRecord,
} from "@breeze/common";
import type { AIProvider } from "@breeze/ai";
import { completeWithTools } from "@breeze/ai";
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

// ── submit_plan tool schema ────────────────────────────────────────────────────

const SUBMIT_PLAN_TOOL = {
  name: "submit_plan",
  description: "Submit the structured plan for this turn. Call exactly once.",
  input_schema: {
    type: "object" as const,
    properties: {
      intent: { type: "string", enum: ["chat", "retrieve", "draft", "act", "automate"] },
      riskLevel: { type: "string", enum: ["none", "low", "medium", "high", "critical"] },
      summaryText: { type: "string" },
      steps: {
        type: "array",
        items: {
          type: "object",
          properties: {
            id: { type: "string" },
            index: { type: "integer", minimum: 0 },
            kind: { type: "string", enum: ["retrieve", "summarize", "draft", "act", "wait"] },
            capability: { type: "string" },
            input: { type: "object" },
            riskLevel: { type: "string", enum: ["none", "low", "medium", "high", "critical"] },
            rationale: { type: "string" },
            dependsOn: { type: "array", items: { type: "string" } },
          },
          required: ["id", "index", "kind", "input", "riskLevel", "rationale"],
        },
      },
      requires: {
        type: "array",
        items: {
          type: "object",
          properties: {
            connector: { type: "string" },
            capability: { type: "string" },
          },
          required: ["connector", "capability"],
        },
      },
      approvalLikelihood: { type: "string", enum: ["none", "low", "likely", "certain"] },
    },
    required: ["intent", "riskLevel", "summaryText", "steps", "requires", "approvalLikelihood"],
  },
};

// ── Tool-use path (Anthropic) ─────────────────────────────────────────────────

async function planViaToolUse(ctx: PlannerContext): Promise<Plan | null> {
  try {
    const result = await completeWithTools({
      model: ctx.model,
      system: buildSystemPrompt(ctx),
      user: buildUserPrompt(ctx),
      tools: [SUBMIT_PLAN_TOOL],
      toolChoice: { type: "tool", name: "submit_plan" },
    });

    const toolBlock = result.toolUseBlocks.find((b) => b.name === "submit_plan");
    if (!toolBlock) return null;

    const raw = toolBlock.input as Record<string, unknown>;
    const parsed = PlanSchema.safeParse({
      ...raw,
      id: newId(),
      chatId: ctx.chatId,
      messageId: ctx.messageId,
      createdAt: new Date().toISOString(),
    });

    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

// ── completeJson fallback path ────────────────────────────────────────────────

async function planViaCompleteJson(ctx: PlannerContext, deps: PlannerDeps): Promise<Plan | null> {
  const systemPrompt = buildSystemPrompt(ctx);
  const userPrompt = buildUserPrompt(ctx);

  const raw = await deps.ai.completeJson<Record<string, unknown>>({
    model: ctx.model,
    system: systemPrompt,
    user: userPrompt,
    schemaName: "BreezePlan",
  });

  const parsed = PlanSchema.safeParse({
    ...raw,
    id: (raw?.id as string | undefined) ?? newId(),
    chatId: ctx.chatId,
    messageId: ctx.messageId,
    createdAt: (raw?.createdAt as string | undefined) ?? new Date().toISOString(),
  });

  if (parsed.success) return parsed.data;

  // Repair-retry once.
  const repaired = await deps.ai.completeJson<Record<string, unknown>>({
    model: ctx.model,
    system: systemPrompt,
    user: `${userPrompt}\n\nYour previous response failed validation: ${parsed.error.message}. Return a corrected JSON object.`,
    schemaName: "BreezePlan",
  });

  const repairedParsed = PlanSchema.safeParse({
    ...repaired,
    id: (repaired?.id as string | undefined) ?? newId(),
    chatId: ctx.chatId,
    messageId: ctx.messageId,
    createdAt: new Date().toISOString(),
  });

  return repairedParsed.success ? repairedParsed.data : null;
}

export async function plan(
  ctx: PlannerContext,
  deps: PlannerDeps
): Promise<Plan> {
  // Use tool-use for Anthropic; fall back to completeJson for other providers.
  const result =
    deps.ai.kind === "anthropic"
      ? await planViaToolUse(ctx)
      : await planViaCompleteJson(ctx, deps);

  return result ?? fallbackChatPlan(ctx);
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
