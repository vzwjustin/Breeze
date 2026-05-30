import { describe, expect, it } from "vitest";
import { formatTurnReply } from "./turn-reply.js";
import type { Plan } from "./types.js";

const basePlan = (overrides: Partial<Plan> = {}): Plan => ({
  id: "plan-1",
  chatId: "chat-1",
  messageId: "msg-1",
  intent: "act",
  riskLevel: "low",
  summaryText: "I'll archive that thread.",
  steps: [
    {
      id: "step-1",
      index: 0,
      kind: "act",
      capability: "gmail.archive_thread",
      input: {},
      riskLevel: "low",
      rationale: "archive",
    },
  ],
  requires: [],
  approvalLikelihood: "none",
  createdAt: new Date().toISOString(),
  ...overrides,
});

describe("formatTurnReply", () => {
  it("includes summary and completed step lines", () => {
    const text = formatTurnReply({
      plan: basePlan(),
      status: "ok",
      stepOutcomes: [
        { stepId: "step-1", kind: "act", status: "completed", detail: "archived" },
      ],
    });
    expect(text).toContain("I'll archive that thread.");
    expect(text).toContain("gmail.archive_thread: archived");
  });

  it("adds pause guidance when awaiting approval", () => {
    const text = formatTurnReply({
      plan: basePlan({ summaryText: "Draft ready." }),
      status: "paused",
      pauseReason: "awaiting_approval",
    });
    expect(text).toContain("Draft ready.");
    expect(text).toContain("approval");
  });
});
