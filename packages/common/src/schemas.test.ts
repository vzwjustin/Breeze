import { describe, it, expect } from "vitest";
import {
  RiskLevelSchema,
  IntentSchema,
  StepKindSchema,
  ExpectedArtifactSchema,
  PlanStepSchema,
  RequiredCapabilitySchema,
  PlanSchema,
  ActionRequestSchema,
  PostMessageSchema,
  RecipeActionSchema,
  CreateRecipeSchema,
} from "./schemas.js";

// ── RiskLevelSchema ────────────────────────────────────────────────────

describe("RiskLevelSchema", () => {
  it("accepts all valid levels", () => {
    const levels = ["none", "low", "medium", "high", "critical"] as const;
    for (const l of levels) {
      expect(RiskLevelSchema.safeParse(l).success).toBe(true);
    }
  });

  it("rejects invalid level", () => {
    expect(RiskLevelSchema.safeParse("extreme").success).toBe(false);
    expect(RiskLevelSchema.safeParse(42).success).toBe(false);
  });
});

// ── IntentSchema ───────────────────────────────────────────────────────

describe("IntentSchema", () => {
  it("accepts valid intents", () => {
    for (const intent of ["chat", "retrieve", "draft", "act", "automate"]) {
      expect(IntentSchema.safeParse(intent).success).toBe(true);
    }
  });

  it("rejects invalid intent", () => {
    expect(IntentSchema.safeParse("plan").success).toBe(false);
  });
});

// ── PlanStepSchema ─────────────────────────────────────────────────────

describe("PlanStepSchema", () => {
  const validStep = {
    id: "step-1",
    index: 0,
    kind: "act" as const,
    input: {},
    riskLevel: "low" as const,
    rationale: "do thing",
  };

  it("accepts valid step", () => {
    expect(PlanStepSchema.safeParse(validStep).success).toBe(true);
  });

  it("accepts step with optional fields", () => {
    const step = {
      ...validStep,
      capability: "gmail.send_reply",
      expectedArtifact: { kind: "draft_email" as const, description: "A draft" },
      dependsOn: ["step-0"],
    };
    expect(PlanStepSchema.safeParse(step).success).toBe(true);
  });

  it("rejects negative index", () => {
    expect(PlanStepSchema.safeParse({ ...validStep, index: -1 }).success).toBe(false);
  });

  it("rejects missing rationale", () => {
    const { rationale: _, ...noRationale } = validStep;
    expect(PlanStepSchema.safeParse(noRationale).success).toBe(false);
  });
});

// ── ActionRequestSchema ────────────────────────────────────────────────

describe("ActionRequestSchema", () => {
  const validReq = {
    idempotencyKey: "key-1",
    userId: "user-1",
    planStepId: "step-1",
    connector: "gmail",
    capability: "gmail.send_reply",
    input: { threadId: "t-1" },
    correlationId: "corr-1",
  };

  it("accepts valid request", () => {
    expect(ActionRequestSchema.safeParse(validReq).success).toBe(true);
  });

  it("accepts request with optional sensitivityHint", () => {
    expect(ActionRequestSchema.safeParse({ ...validReq, sensitivityHint: "high" }).success).toBe(true);
  });

  it("rejects missing connector", () => {
    const { connector: _, ...noConnector } = validReq;
    expect(ActionRequestSchema.safeParse(noConnector).success).toBe(false);
  });

  it("rejects invalid sensitivityHint", () => {
    expect(ActionRequestSchema.safeParse({ ...validReq, sensitivityHint: "extreme" }).success).toBe(false);
  });
});

// ── PostMessageSchema ──────────────────────────────────────────────────

describe("PostMessageSchema", () => {
  it("accepts valid message", () => {
    expect(PostMessageSchema.safeParse({ content: "Hello!" }).success).toBe(true);
  });

  it("rejects empty content", () => {
    expect(PostMessageSchema.safeParse({ content: "" }).success).toBe(false);
  });

  it("rejects content over 20000 chars", () => {
    expect(PostMessageSchema.safeParse({ content: "A".repeat(20_001) }).success).toBe(false);
  });

  it("accepts message with attachments", () => {
    const msg = { content: "Hi", attachments: [{ blobKey: "blob-1", name: "file.pdf" }] };
    expect(PostMessageSchema.safeParse(msg).success).toBe(true);
  });
});

// ── CreateRecipeSchema ─────────────────────────────────────────────────

describe("CreateRecipeSchema", () => {
  const validRecipe = {
    name: "My Recipe",
    trigger: {
      key: "gmail.new_email",
      input: {},
      pollSeconds: 300,
    },
    actions: [{ capability: "gmail.label_thread", inputTemplate: { threadId: "{{item.threadId}}" } }],
  };

  it("accepts valid recipe", () => {
    expect(CreateRecipeSchema.safeParse(validRecipe).success).toBe(true);
  });

  it("rejects empty name", () => {
    expect(CreateRecipeSchema.safeParse({ ...validRecipe, name: "" }).success).toBe(false);
  });

  it("rejects name over 120 chars", () => {
    expect(CreateRecipeSchema.safeParse({ ...validRecipe, name: "A".repeat(121) }).success).toBe(false);
  });

  it("rejects pollSeconds below 30", () => {
    const recipe = { ...validRecipe, trigger: { ...validRecipe.trigger, pollSeconds: 29 } };
    expect(CreateRecipeSchema.safeParse(recipe).success).toBe(false);
  });

  it("rejects empty actions array", () => {
    expect(CreateRecipeSchema.safeParse({ ...validRecipe, actions: [] }).success).toBe(false);
  });

  it("rejects more than 10 actions", () => {
    const actions = Array.from({ length: 11 }, () => ({
      capability: "gmail.label_thread",
      inputTemplate: {},
    }));
    expect(CreateRecipeSchema.safeParse({ ...validRecipe, actions }).success).toBe(false);
  });

  it("defaults approvalMode to policy when omitted", () => {
    const result = CreateRecipeSchema.safeParse(validRecipe);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.approvalMode).toBe("policy");
    }
  });
});
