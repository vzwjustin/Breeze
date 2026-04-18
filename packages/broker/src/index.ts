/**
 * Action Broker — the sole execution gate (BLUEPRINT §11).
 *
 * Flow:
 *   ActionRequest
 *     → validate input against capability schema
 *     → consult Policy
 *     → if deny: stop
 *     → if require_approval: create Approval, return (work resumes via Trigger.dev wait token)
 *     → if allow: execute via connector, record execution, emit events
 */
import {
  BreezeError,
  newId,
  type ActionOutcome,
  type ActionRequest,
  type ActionResult,
  type Approval,
  type ApprovalPreview,
  type PolicyDecision,
  type PolicyProfile,
} from "@breeze/common";
import type { EventEnvelope } from "@breeze/common";
import { requireCapability, type ConnectorCapability } from "@breeze/connectors";
import type { ConnectorAccountHandle, ConnectorTokens } from "@breeze/connectors";
import { evaluate } from "@breeze/policy";

// ── Ports (injected by the app server) ────────────────────────────────

export interface BrokerPorts {
  policy: {
    forUser: (userId: string) => Promise<PolicyProfile>;
  };
  connectors: {
    getAccount: (userId: string, connectorKey: string) => Promise<ConnectorAccountHandle>;
    getFreshTokens: (account: ConnectorAccountHandle) => Promise<ConnectorTokens>;
  };
  executions: {
    findByIdempotencyKey: (key: string) => Promise<ActionResult | undefined>;
    start: (req: ActionRequest) => Promise<{ executionId: string }>;
    complete: (executionId: string, output: unknown) => Promise<void>;
    fail: (executionId: string, errorMessage: string) => Promise<void>;
  };
  approvals: {
    create: (req: ActionRequest, cap: ConnectorCapability, decision: PolicyDecision, preview: ApprovalPreview) => Promise<Approval>;
    requireApproved: (approvalId: string) => Promise<Approval>;
  };
  preview: {
    build: (req: ActionRequest, cap: ConnectorCapability) => Promise<ApprovalPreview>;
  };
  events: {
    emit: (event: EventEnvelope) => Promise<void>;
  };
  logger: {
    info: (msg: string, data?: unknown) => void;
    error: (msg: string, data?: unknown) => void;
  };
}

export interface Broker {
  submit(req: ActionRequest): Promise<ActionOutcome>;
  resumeAfterApproval(approvalId: string): Promise<ActionOutcome>;
}

export function createBroker(ports: BrokerPorts): Broker {
  return {
    async submit(req: ActionRequest): Promise<ActionOutcome> {
      const existing = await ports.executions.findByIdempotencyKey(req.idempotencyKey);
      if (existing?.ok) {
        return { kind: "allowed", result: existing };
      }

      const cap = requireCapability(req.connector, req.capability);

      const parse = cap.inputSchema.safeParse(req.input);
      if (!parse.success) {
        throw new BreezeError("validation", `Invalid input for ${req.capability}`, { details: { issues: parse.error.issues } });
      }

      const profile = await ports.policy.forUser(req.userId);
      const decision = evaluate({
        userId: req.userId,
        profile,
        connector: req.connector,
        capability: req.capability,
        capabilityMeta: {
          sensitivity: cap.sensitivity,
          mutatesState: cap.mutatesState,
          approvalHint: cap.approvalHint,
          idempotent: cap.idempotent,
        },
        context: { originatingKind: "chat" },
      });

      await ports.events.emit(envelope("policy.decision", { req, decision }));

      if (decision.decision === "deny") {
        return { kind: "denied", reason: decision.reason };
      }

      if (decision.decision === "require_approval") {
        const preview = await ports.preview.build(req, cap);
        const approval = await ports.approvals.create(req, cap, decision, preview);
        await ports.events.emit(
          envelope("approval.requested", { approvalId: approval.id, planStepId: req.planStepId })
        );
        return { kind: "approval_required", approvalId: approval.id };
      }

      return executeNow(req, cap, ports);
    },

    async resumeAfterApproval(approvalId: string): Promise<ActionOutcome> {
      const approval = await ports.approvals.requireApproved(approvalId);
      const cap = requireCapability(approval.actionRequest.connector, approval.actionRequest.capability);
      return executeNow(approval.actionRequest, cap, ports);
    },
  };
}

async function executeNow(
  req: ActionRequest,
  cap: ConnectorCapability,
  ports: BrokerPorts
): Promise<ActionOutcome> {
  const account = await ports.connectors.getAccount(req.userId, req.connector);
  const tokens = await ports.connectors.getFreshTokens(account);
  const { executionId } = await ports.executions.start(req);

  await ports.events.emit(envelope("action.started", { executionId, req }));

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30_000);
  try {
    const output = await cap.execute(req.input, {
      account,
      tokens,
      logger: ports.logger,
      signal: controller.signal,
    });
    await ports.executions.complete(executionId, output);
    await ports.events.emit(envelope("action.completed", { executionId, output }));
    return {
      kind: "allowed",
      result: { ok: true, executionId, output: output as Record<string, unknown> },
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await ports.executions.fail(executionId, msg);
    await ports.events.emit(envelope("action.failed", { executionId, error: msg }));
    return {
      kind: "allowed",
      result: { ok: false, executionId, errorMessage: msg },
    };
  } finally {
    clearTimeout(timeout);
  }
}

function envelope<T extends EventEnvelope["type"], P>(type: T, payload: P): EventEnvelope<T, P> {
  return {
    id: newId(),
    type,
    source: "app",
    payload,
    createdAt: new Date().toISOString(),
  };
}
