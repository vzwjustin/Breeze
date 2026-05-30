import type { Plan, PlanStep } from "./types.js";

export interface StepOutcomeLine {
  stepId: string;
  kind: PlanStep["kind"];
  status: "completed" | "failed" | "skipped";
  label?: string;
  detail?: string;
}

export interface FormatTurnReplyArgs {
  plan: Plan;
  status: "ok" | "failed" | "aborted" | "paused";
  stepOutcomes?: StepOutcomeLine[];
  pauseReason?: string;
}

/**
 * Build the user-visible assistant message for a chat turn.
 * Uses planner summaryText plus concise step outcome lines.
 */
export function formatTurnReply({
  plan,
  status,
  stepOutcomes = [],
  pauseReason,
}: FormatTurnReplyArgs): string {
  const lines: string[] = [];

  const summary = plan.summaryText?.trim();
  if (summary) lines.push(summary);

  for (const step of plan.steps) {
    const outcome = stepOutcomes.find((o) => o.stepId === step.id);
    if (!outcome || outcome.status === "skipped") continue;

    const label = outcome.label ?? stepLabel(step);
    if (outcome.status === "completed") {
      const detail = outcome.detail?.trim();
      lines.push(detail ? `✓ ${label}: ${detail}` : `✓ ${label}`);
    } else if (outcome.status === "failed") {
      const detail = outcome.detail?.trim() ?? "failed";
      lines.push(`✗ ${label}: ${detail}`);
    }
  }

  if (status === "paused") {
    const reason =
      pauseReason === "awaiting_approval"
        ? "Paused — one or more actions need your approval in the Approvals inbox."
        : "Paused before completion.";
    lines.push(reason);
  } else if (status === "failed" && lines.length === 0) {
    lines.push("Something went wrong while running this turn. Check Tasks or Approvals for details.");
  } else if (status === "aborted") {
    lines.push("Stopped.");
  }

  if (lines.length === 0) {
    return plan.intent === "chat"
      ? "Done."
      : `Completed (${plan.intent}).`;
  }

  return lines.join("\n");
}

function stepLabel(step: PlanStep): string {
  if (step.capability) return step.capability;
  return step.kind;
}
