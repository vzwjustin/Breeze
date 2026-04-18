import { z } from "zod";

export const RiskLevelSchema = z.enum([
  "none",
  "low",
  "medium",
  "high",
  "critical",
]);

export const IntentSchema = z.enum([
  "chat",
  "retrieve",
  "draft",
  "act",
  "automate",
]);

export const StepKindSchema = z.enum([
  "retrieve",
  "summarize",
  "draft",
  "act",
  "wait",
]);

export const ExpectedArtifactSchema = z.object({
  kind: z.enum(["summary", "draft_email", "draft_comment", "event", "file", "list"]),
  description: z.string(),
});

export const PlanStepSchema = z.object({
  id: z.string(),
  index: z.number().int().nonnegative(),
  kind: StepKindSchema,
  capability: z.string().optional(),
  input: z.record(z.unknown()),
  expectedArtifact: ExpectedArtifactSchema.optional(),
  riskLevel: RiskLevelSchema,
  rationale: z.string(),
  dependsOn: z.array(z.string()).optional(),
});

export const RequiredCapabilitySchema = z.object({
  connector: z.enum(["gmail", "gcal", "github", "files", "internal"]),
  capability: z.string(),
});

export const PlanSchema = z.object({
  id: z.string(),
  chatId: z.string(),
  messageId: z.string(),
  intent: IntentSchema,
  riskLevel: RiskLevelSchema,
  summaryText: z.string(),
  steps: z.array(PlanStepSchema),
  requires: z.array(RequiredCapabilitySchema),
  approvalLikelihood: z.enum(["none", "low", "likely", "certain"]),
  createdAt: z.string(),
});

export const ActionRequestSchema = z.object({
  idempotencyKey: z.string(),
  userId: z.string(),
  planStepId: z.string(),
  connector: z.string(),
  capability: z.string(),
  input: z.record(z.unknown()),
  sensitivityHint: RiskLevelSchema.optional(),
  correlationId: z.string(),
});

export const PostMessageSchema = z.object({
  content: z.string().min(1).max(20_000),
  attachments: z
    .array(
      z.object({
        blobKey: z.string(),
        name: z.string(),
      })
    )
    .optional(),
});

export type PostMessageInput = z.infer<typeof PostMessageSchema>;
