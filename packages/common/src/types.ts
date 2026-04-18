/**
 * Core shared types for Breeze.
 *
 * These are the contracts every package speaks. Keep this file boring,
 * stable, and side-effect free.
 */

export type ID = string;
export type ISO = string;

export type RiskLevel = "none" | "low" | "medium" | "high" | "critical";
export type Intent = "chat" | "retrieve" | "draft" | "act" | "automate";
export type StepKind = "retrieve" | "summarize" | "draft" | "act" | "wait";

export type Decision = "allow" | "require_approval" | "deny";

// ── Planner ────────────────────────────────────────────────────────────
export interface IntentClassification {
  intent: Intent;
  confidence: number;
  reason: string;
}

export interface RequiredCapability {
  connector: ConnectorKey | "internal";
  capability: string;
}

export interface ExpectedArtifact {
  kind:
    | "summary"
    | "draft_email"
    | "draft_comment"
    | "event"
    | "file"
    | "list";
  description: string;
}

export interface PlanStep {
  id: ID;
  index: number;
  kind: StepKind;
  capability?: string;
  input: Record<string, unknown>;
  expectedArtifact?: ExpectedArtifact;
  riskLevel: RiskLevel;
  rationale: string;
  dependsOn?: ID[];
}

export interface Plan {
  id: ID;
  chatId: ID;
  messageId: ID;
  intent: Intent;
  riskLevel: RiskLevel;
  summaryText: string;
  steps: PlanStep[];
  requires: RequiredCapability[];
  approvalLikelihood: "none" | "low" | "likely" | "certain";
  createdAt: ISO;
}

// ── Broker ─────────────────────────────────────────────────────────────
export interface ActionRequest {
  idempotencyKey: string;
  userId: ID;
  planStepId: ID;
  connector: string;
  capability: string;
  input: Record<string, unknown>;
  sensitivityHint?: RiskLevel;
  correlationId: ID;
}

export interface ActionResult {
  ok: boolean;
  executionId: ID;
  output?: Record<string, unknown>;
  artifactIds?: ID[];
  errorMessage?: string;
}

export type ActionOutcome =
  | { kind: "allowed"; result: ActionResult }
  | { kind: "approval_required"; approvalId: ID }
  | { kind: "denied"; reason: string };

export interface ActionExecutionRecord {
  id: ID;
  planStepId: ID;
  capability: string;
  connectorKey: string;
  input: unknown;
  output?: unknown;
  errorMessage?: string;
  idempotencyKey: string;
  startedAt: ISO;
  endedAt?: ISO;
}

// ── Policy ─────────────────────────────────────────────────────────────
export interface CapabilityMeta {
  sensitivity: RiskLevel;
  mutatesState: boolean;
  approvalHint: "never" | "sometimes" | "always";
  idempotent: boolean;
}

export interface PolicyInput {
  userId: ID;
  profile: PolicyProfile;
  connector: string;
  capability: string;
  capabilityMeta: CapabilityMeta;
  context: {
    originatingKind: "chat" | "task";
    taskTrustLevel?: "low" | "normal" | "elevated";
    targetCount?: number;
    targetExamples?: unknown[];
  };
}

export interface PolicyDecision {
  decision: Decision;
  reason: string;
  rule: string;
  approvalTemplate?: "single" | "bulk";
}

export interface PolicyRule {
  id: string;
  connector?: string;
  capability?: string;
  when?: {
    mutatesState?: boolean;
    sensitivityAtLeast?: RiskLevel;
    bulkOver?: number;
  };
  decision: Decision;
  reason: string;
}

export interface PolicyProfile {
  id: ID;
  name: string;
  kind: "builtin" | "custom";
  rules: PolicyRule[];
}

// ── Approvals ──────────────────────────────────────────────────────────
export type ApprovalStatus =
  | "pending"
  | "approved"
  | "denied"
  | "expired"
  | "superseded"
  | "canceled";

export interface ApprovalPreview {
  title: string;
  serviceIcon: string;
  targetSummary: string;
  payloadDiff?: { before?: string; after: string };
  undoable: boolean;
  changedSincePlan?: string[];
  alternatives?: Array<{ label: string; actionRequest: ActionRequest }>;
}

export interface Approval {
  id: ID;
  userId: ID;
  planStepId: ID;
  actionRequest: ActionRequest;
  preview: ApprovalPreview;
  risk: RiskLevel;
  status: ApprovalStatus;
  expiresAt: ISO;
  decidedAt?: ISO;
  decisionNote?: string;
  waitToken?: string;
  createdAt: ISO;
}

// ── Tasks ──────────────────────────────────────────────────────────────
export type TaskSchedule =
  | { kind: "cron"; cron: string; tz: string }
  | { kind: "once"; runAt: ISO }
  | {
      kind: "watch";
      source: { connector: string; resource: string; pollSeconds: number };
    };

export type TaskStatus = "active" | "paused" | "failed" | "archived";
export type RunStatus =
  | "running"
  | "completed"
  | "failed"
  | "canceled"
  | "waiting_approval";

export interface Task {
  id: ID;
  userId: ID;
  name: string;
  description?: string;
  prompt: string;
  schedule: TaskSchedule;
  approvalMode: "per_run" | "once_on_create" | "policy";
  policyProfileId?: ID;
  status: TaskStatus;
  lastRunAt?: ISO;
  nextRunAt?: ISO;
  triggerTaskId?: string;
  createdAt: ISO;
  updatedAt: ISO;
}

export interface TaskRun {
  id: ID;
  taskId: ID;
  status: RunStatus;
  startedAt: ISO;
  endedAt?: ISO;
  summary?: string;
  planId?: ID;
  errorMessage?: string;
}

// ── Memory ─────────────────────────────────────────────────────────────
export type MemoryType = "conversation" | "user" | "working";
export type MemoryVisibility = "user_visible" | "internal";

export interface MemoryRecord<V = unknown> {
  id: ID;
  userId: ID;
  type: MemoryType;
  scope?: string;
  key: string;
  value: V;
  source: {
    kind: "message" | "task" | "system" | "user_declared";
    id?: ID;
  };
  reason: string;
  visibility: MemoryVisibility;
  expiresAt?: ISO;
  createdAt: ISO;
  updatedAt: ISO;
}

// ── Connectors ────────────────────────────────────────────────────────
export type ConnectorKey = "gmail" | "gcal" | "github" | "files";

export interface ConnectorCapabilityMeta {
  key: string;
  displayName: string;
  description: string;
  sensitivity: RiskLevel;
  mutatesState: boolean;
  approvalHint: "never" | "sometimes" | "always";
  idempotent: boolean;
  rateLimit?: { perMinute: number; perDay?: number };
}
