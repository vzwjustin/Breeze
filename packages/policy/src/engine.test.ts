import { describe, it, expect } from "vitest";
import { evaluate, BULK_SAFETY_THRESHOLD } from "./index.js";
import {
  READ_ONLY,
  ASK_BEFORE_SENDING,
  ASK_BEFORE_MUTATING,
  AUTO_RUN_SAFE_ACTIONS,
  POWER_USER,
  PARANOID,
} from "./profiles.js";
import type { PolicyInput, PolicyProfile } from "@breeze/common";

// ── Helpers ────────────────────────────────────────────────────────────

function makeInput(overrides: Partial<PolicyInput> = {}): PolicyInput {
  return {
    userId: "user-1",
    profile: READ_ONLY,
    connector: "gmail",
    capability: "gmail.list_threads",
    capabilityMeta: {
      sensitivity: "none",
      mutatesState: false,
      approvalHint: "never",
      idempotent: true,
    },
    context: { originatingKind: "chat" },
    ...overrides,
  };
}

function makeReadInput(profile: PolicyProfile, sensitivity = "none" as const): PolicyInput {
  return makeInput({
    profile,
    capabilityMeta: { sensitivity, mutatesState: false, approvalHint: "never", idempotent: true },
  });
}

function makeMutateInput(
  profile: PolicyProfile,
  sensitivity: PolicyInput["capabilityMeta"]["sensitivity"] = "low",
  capability = "gmail.send_reply"
): PolicyInput {
  return makeInput({
    profile,
    capability,
    connector: "gmail",
    capabilityMeta: { sensitivity, mutatesState: true, approvalHint: "sometimes", idempotent: false },
  });
}

// ── Precedence / system rules ──────────────────────────────────────────

describe("evaluate() precedence", () => {
  it("deny wins over allow when both match", () => {
    const profile: PolicyProfile = {
      id: "test.deny_wins",
      name: "Deny Wins",
      kind: "custom",
      rules: [
        { id: "allow_all", decision: "allow", reason: "allow" },
        { id: "deny_mut", decision: "deny", reason: "deny mutations", when: { mutatesState: true } },
      ],
    };
    const result = evaluate(
      makeMutateInput(profile, "low")
    );
    expect(result.decision).toBe("deny");
  });

  it("bulk safety overrides an allow rule", () => {
    const result = evaluate(
      makeInput({
        profile: POWER_USER,
        capabilityMeta: { sensitivity: "low", mutatesState: true, approvalHint: "never", idempotent: true },
        context: { originatingKind: "chat", targetCount: BULK_SAFETY_THRESHOLD + 1 },
      })
    );
    expect(result.decision).toBe("require_approval");
    expect(result.rule).toBe("system.bulk_safety");
  });

  it("bulk safety does NOT trigger on read actions", () => {
    const result = evaluate(
      makeInput({
        profile: READ_ONLY,
        capabilityMeta: { sensitivity: "none", mutatesState: false, approvalHint: "never", idempotent: true },
        context: { originatingKind: "chat", targetCount: 100 },
      })
    );
    expect(result.decision).toBe("allow");
  });

  it("read-only short-circuit allows when no rule matches", () => {
    const emptyProfile: PolicyProfile = { id: "empty", name: "Empty", kind: "custom", rules: [] };
    const result = evaluate(
      makeInput({ profile: emptyProfile, capabilityMeta: { sensitivity: "none", mutatesState: false, approvalHint: "never", idempotent: true } })
    );
    expect(result.decision).toBe("allow");
    expect(result.rule).toBe("system.read_only");
  });

  it("default conservative: mutation with no matching rules → require_approval", () => {
    const emptyProfile: PolicyProfile = { id: "empty", name: "Empty", kind: "custom", rules: [] };
    const result = evaluate(makeMutateInput(emptyProfile));
    expect(result.decision).toBe("require_approval");
    expect(result.rule).toBe("system.default");
  });

  it("bulk safety threshold is exactly BULK_SAFETY_THRESHOLD (not over)", () => {
    const result = evaluate(
      makeInput({
        profile: POWER_USER,
        capabilityMeta: { sensitivity: "low", mutatesState: true, approvalHint: "never", idempotent: true },
        context: { originatingKind: "chat", targetCount: BULK_SAFETY_THRESHOLD },
      })
    );
    // At exactly threshold, no bulk safety
    expect(result.decision).toBe("allow");
  });
});

// ── Sensitivity ordering ───────────────────────────────────────────────

describe("sensitivity ordering", () => {
  it("low < medium: sensitivityAtLeast:medium does not fire on low", () => {
    const profile: PolicyProfile = {
      id: "t",
      name: "t",
      kind: "custom",
      rules: [
        { id: "req_medium", decision: "require_approval", when: { sensitivityAtLeast: "medium" }, reason: "" },
        { id: "allow_all", decision: "allow", reason: "" },
      ],
    };
    const result = evaluate(
      makeInput({
        profile,
        capabilityMeta: { sensitivity: "low", mutatesState: false, approvalHint: "never", idempotent: true },
      })
    );
    // low < medium, rule does not match, allow falls through
    expect(result.decision).toBe("allow");
  });

  it("high >= medium: sensitivityAtLeast:medium fires on high", () => {
    const profile: PolicyProfile = {
      id: "t",
      name: "t",
      kind: "custom",
      rules: [
        { id: "deny_med", decision: "deny", when: { sensitivityAtLeast: "medium" }, reason: "" },
      ],
    };
    const result = evaluate(
      makeInput({
        profile,
        capabilityMeta: { sensitivity: "high", mutatesState: true, approvalHint: "always", idempotent: false },
      })
    );
    expect(result.decision).toBe("deny");
  });

  it("critical >= critical: sensitivityAtLeast:critical fires on critical", () => {
    const result = evaluate(
      makeInput({
        profile: POWER_USER,
        capabilityMeta: { sensitivity: "critical", mutatesState: true, approvalHint: "always", idempotent: false },
      })
    );
    expect(result.decision).toBe("require_approval");
  });
});

// ── READ_ONLY profile ──────────────────────────────────────────────────

describe("READ_ONLY profile", () => {
  it("allows reads", () => {
    expect(evaluate(makeReadInput(READ_ONLY)).decision).toBe("allow");
  });

  it("denies mutations on low-sensitivity", () => {
    expect(evaluate(makeMutateInput(READ_ONLY, "low")).decision).toBe("deny");
  });

  it("denies mutations on high-sensitivity", () => {
    expect(evaluate(makeMutateInput(READ_ONLY, "high")).decision).toBe("deny");
  });

  it("denies even when targetCount is 0", () => {
    const result = evaluate({
      ...makeMutateInput(READ_ONLY, "low"),
      context: { originatingKind: "chat", targetCount: 0 },
    });
    expect(result.decision).toBe("deny");
  });
});

// ── ASK_BEFORE_SENDING profile ────────────────────────────────────────

describe("ASK_BEFORE_SENDING profile", () => {
  it("allows reads", () => {
    expect(evaluate(makeReadInput(ASK_BEFORE_SENDING)).decision).toBe("allow");
  });

  it("requires approval for gmail.send_reply", () => {
    const result = evaluate(
      makeInput({
        profile: ASK_BEFORE_SENDING,
        connector: "gmail",
        capability: "gmail.send_reply",
        capabilityMeta: { sensitivity: "medium", mutatesState: true, approvalHint: "always", idempotent: false },
      })
    );
    expect(result.decision).toBe("require_approval");
  });

  it("allows gmail.archive_thread", () => {
    const result = evaluate(
      makeInput({
        profile: ASK_BEFORE_SENDING,
        connector: "gmail",
        capability: "gmail.archive_thread",
        capabilityMeta: { sensitivity: "low", mutatesState: true, approvalHint: "never", idempotent: true },
      })
    );
    expect(result.decision).toBe("allow");
  });

  it("allows gmail.label_thread", () => {
    const result = evaluate(
      makeInput({
        profile: ASK_BEFORE_SENDING,
        connector: "gmail",
        capability: "gmail.label_thread",
        capabilityMeta: { sensitivity: "low", mutatesState: true, approvalHint: "never", idempotent: true },
      })
    );
    expect(result.decision).toBe("allow");
  });

  it("requires approval for github.post_comment", () => {
    const result = evaluate(
      makeInput({
        profile: ASK_BEFORE_SENDING,
        connector: "github",
        capability: "github.post_comment",
        capabilityMeta: { sensitivity: "medium", mutatesState: true, approvalHint: "always", idempotent: false },
      })
    );
    expect(result.decision).toBe("require_approval");
  });

  it("requires approval for gcal mutations", () => {
    const result = evaluate(
      makeInput({
        profile: ASK_BEFORE_SENDING,
        connector: "gcal",
        capability: "gcal.create_event",
        capabilityMeta: { sensitivity: "low", mutatesState: true, approvalHint: "sometimes", idempotent: false },
      })
    );
    expect(result.decision).toBe("require_approval");
  });
});

// ── ASK_BEFORE_MUTATING profile ───────────────────────────────────────

describe("ASK_BEFORE_MUTATING profile", () => {
  it("allows reads", () => {
    expect(evaluate(makeReadInput(ASK_BEFORE_MUTATING)).decision).toBe("allow");
  });

  it("requires approval for low-sensitivity mutations", () => {
    expect(evaluate(makeMutateInput(ASK_BEFORE_MUTATING, "low")).decision).toBe("require_approval");
  });

  it("requires approval for high-sensitivity mutations", () => {
    expect(evaluate(makeMutateInput(ASK_BEFORE_MUTATING, "high")).decision).toBe("require_approval");
  });

  it("never denies (no deny rules)", () => {
    const result = evaluate(makeMutateInput(ASK_BEFORE_MUTATING, "critical"));
    expect(result.decision).not.toBe("deny");
  });
});

// ── AUTO_RUN_SAFE_ACTIONS profile ──────────────────────────────────────

describe("AUTO_RUN_SAFE_ACTIONS profile", () => {
  it("allows reads", () => {
    expect(evaluate(makeReadInput(AUTO_RUN_SAFE_ACTIONS)).decision).toBe("allow");
  });

  it("allows low-sensitivity mutations", () => {
    expect(evaluate(makeMutateInput(AUTO_RUN_SAFE_ACTIONS, "low")).decision).toBe("allow");
  });

  it("allows draft actions via wildcard", () => {
    const result = evaluate(
      makeInput({
        profile: AUTO_RUN_SAFE_ACTIONS,
        connector: "gmail",
        capability: "gmail.draft_reply",
        capabilityMeta: { sensitivity: "low", mutatesState: true, approvalHint: "never", idempotent: true },
      })
    );
    expect(result.decision).toBe("allow");
  });

  it("requires approval for high-sensitivity", () => {
    expect(evaluate(makeMutateInput(AUTO_RUN_SAFE_ACTIONS, "high")).decision).toBe("require_approval");
  });

  it("requires approval for critical-sensitivity", () => {
    expect(evaluate(makeMutateInput(AUTO_RUN_SAFE_ACTIONS, "critical")).decision).toBe("require_approval");
  });
});

// ── POWER_USER profile ────────────────────────────────────────────────

describe("POWER_USER profile", () => {
  it("allows reads", () => {
    expect(evaluate(makeReadInput(POWER_USER)).decision).toBe("allow");
  });

  it("allows low-sensitivity mutations", () => {
    expect(evaluate(makeMutateInput(POWER_USER, "low")).decision).toBe("allow");
  });

  it("allows high-sensitivity mutations", () => {
    expect(evaluate(makeMutateInput(POWER_USER, "high")).decision).toBe("allow");
  });

  it("requires approval for critical-sensitivity", () => {
    expect(evaluate(makeMutateInput(POWER_USER, "critical")).decision).toBe("require_approval");
  });

  it("still triggers bulk safety on large target sets", () => {
    const result = evaluate(
      makeInput({
        profile: POWER_USER,
        capabilityMeta: { sensitivity: "low", mutatesState: true, approvalHint: "never", idempotent: true },
        context: { originatingKind: "chat", targetCount: 99 },
      })
    );
    expect(result.decision).toBe("require_approval");
  });
});

// ── PARANOID profile ───────────────────────────────────────────────────

describe("PARANOID profile", () => {
  it("allows reads (safe reads rule)", () => {
    expect(evaluate(makeReadInput(PARANOID)).decision).toBe("allow");
  });

  it("requires approval for low mutations", () => {
    expect(evaluate(makeMutateInput(PARANOID, "low")).decision).toBe("require_approval");
  });

  it("requires approval for critical mutations", () => {
    expect(evaluate(makeMutateInput(PARANOID, "critical")).decision).toBe("require_approval");
  });

  it("never denies — only requires approval", () => {
    const result = evaluate(makeMutateInput(PARANOID, "critical"));
    expect(result.decision).not.toBe("deny");
  });
});
