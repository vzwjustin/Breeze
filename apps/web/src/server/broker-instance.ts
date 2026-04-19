import { createBroker, type Broker } from "@breeze/broker";
import { createLogger, BreezeError, type PolicyProfile } from "@breeze/common";
import { prisma, decryptString } from "@breeze/db";
import { getBuiltinProfile } from "@breeze/policy/profiles";
import type { ConnectorAccountHandle, ConnectorTokens, ConnectorCapability } from "@breeze/connectors";
import type { ApprovalPreview, ActionRequest, PolicyDecision } from "@breeze/common";

const db = prisma as any;
const brokerLogger = createLogger({ component: "broker" });

async function getUserPolicyProfile(userId: string): Promise<PolicyProfile> {
  const user = await db.user.findUnique({
    where: { id: userId },
    include: { policyProfile: true },
  });

  if (user?.policyProfile) {
    return {
      id: user.policyProfile.id,
      name: user.policyProfile.name,
      kind: user.policyProfile.kind as "builtin" | "custom",
      rules: user.policyProfile.rules as PolicyProfile["rules"],
    };
  }

  return (
    getBuiltinProfile("builtin.auto_run_safe_actions") ?? {
      id: "builtin.auto_run_safe_actions",
      name: "Auto-run Safe Actions",
      kind: "builtin",
      rules: [],
    }
  );
}

async function getConnectorAccount(userId: string, connectorKey: string): Promise<ConnectorAccountHandle> {
  const account = await db.connectorAccount.findFirst({
    where: { userId, connectorKey, deletedAt: null },
  });

  if (!account) {
    throw new BreezeError("auth", `No active connector account for ${connectorKey}`);
  }

  return {
    id: account.id,
    userId: account.userId,
    connectorKey: account.connectorKey,
    scopes: account.scopes,
    providerAccountId: account.providerAccountId,
  };
}

async function getFreshTokens(account: ConnectorAccountHandle): Promise<ConnectorTokens> {
  const credential = await db.connectorCredential.findUnique({
    where: { accountId: account.id },
  });

  if (!credential) {
    throw new BreezeError("auth", `No credentials for connector account ${account.id}`);
  }

  const raw = JSON.parse(decryptString(credential.encryptedTokens as Buffer)) as {
    accessToken: string;
    refreshToken?: string;
    expiresAt?: string;
  };

  if (credential.expiresAt && new Date(credential.expiresAt) < new Date()) {
    throw new BreezeError("auth", `Tokens expired for connector ${account.connectorKey}`);
  }

  return {
    accessToken: raw.accessToken,
    refreshToken: raw.refreshToken,
    expiresAt: credential.expiresAt ?? undefined,
    raw: raw as Record<string, unknown>,
  };
}

async function findByIdempotencyKey(key: string) {
  const exec = await db.actionExecution.findUnique({
    where: { idempotencyKey: key },
  });
  if (!exec) return undefined;
  return {
    ok: !exec.errorMessage,
    executionId: exec.id,
    output: exec.output as Record<string, unknown> | undefined,
    errorMessage: exec.errorMessage ?? undefined,
  };
}

async function startExecution(req: ActionRequest) {
  const exec = await db.actionExecution.create({
    data: {
      planStepId: req.planStepId,
      capability: req.capability,
      connectorKey: req.connector,
      input: req.input,
      idempotencyKey: req.idempotencyKey,
    },
    select: { id: true },
  });
  return { executionId: exec.id };
}

async function completeExecution(executionId: string, output: unknown) {
  await db.actionExecution.update({
    where: { id: executionId },
    data: { output: output as object, endedAt: new Date() },
  });
}

async function failExecution(executionId: string, errorMessage: string) {
  await db.actionExecution.update({
    where: { id: executionId },
    data: { errorMessage, endedAt: new Date() },
  });
}

async function createApproval(
  req: ActionRequest,
  cap: ConnectorCapability,
  _decision: PolicyDecision,
  preview: ApprovalPreview
) {
  const riskMap: Record<string, string> = {
    none: "NONE",
    low: "LOW",
    medium: "MEDIUM",
    high: "HIGH",
    critical: "CRITICAL",
  };

  const approval = await db.approval.create({
    data: {
      userId: req.userId,
      planStepId: req.planStepId,
      actionRequest: req as object,
      preview: preview as object,
      risk: riskMap[cap.sensitivity] ?? "MEDIUM",
      expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
    },
  });

  return {
    id: approval.id,
    userId: approval.userId,
    planStepId: approval.planStepId,
    actionRequest: req,
    preview,
    risk: cap.sensitivity,
    status: "pending" as const,
    expiresAt: approval.expiresAt.toISOString(),
    createdAt: approval.createdAt.toISOString(),
  };
}

async function requireApproved(approvalId: string) {
  const approval = await db.approval.findUnique({ where: { id: approvalId } });

  if (!approval) {
    throw new BreezeError("not_found", `Approval ${approvalId} not found`);
  }

  if (approval.status !== "APPROVED") {
    throw new BreezeError("conflict", `Approval is ${approval.status.toLowerCase()}`);
  }

  return {
    id: approval.id,
    userId: approval.userId,
    planStepId: approval.planStepId,
    actionRequest: approval.actionRequest as ActionRequest,
    preview: approval.preview as ApprovalPreview,
    risk: approval.risk.toLowerCase() as any,
    status: "approved" as const,
    expiresAt: approval.expiresAt.toISOString(),
    decidedAt: approval.decidedAt?.toISOString(),
    createdAt: approval.createdAt.toISOString(),
  };
}

async function buildPreview(req: ActionRequest, cap: ConnectorCapability): Promise<ApprovalPreview> {
  return {
    title: cap.displayName,
    serviceIcon: req.connector,
    targetSummary: cap.description,
    undoable: cap.idempotent,
  };
}

let broker: Broker | null = null;

export function getBroker(): Broker {
  if (broker) return broker;
  broker = createBroker({
    policy: { forUser: getUserPolicyProfile },
    connectors: { getAccount: getConnectorAccount, getFreshTokens },
    executions: {
      findByIdempotencyKey,
      start: startExecution,
      complete: completeExecution,
      fail: failExecution,
    },
    approvals: { create: createApproval, requireApproved },
    preview: { build: buildPreview },
    events: {
      emit: async (event) => {
        await db.eventOutbox
          .create({ data: { type: event.type, payload: event as object } })
          .catch(() => {});
      },
    },
    logger: {
      info: (msg, data) =>
        brokerLogger.info(msg, data !== undefined ? (data as Record<string, unknown>) : undefined),
      warn: (msg, data) =>
        brokerLogger.warn(msg, data !== undefined ? (data as Record<string, unknown>) : undefined),
      error: (msg, data) =>
        brokerLogger.error(msg, data !== undefined ? (data as Record<string, unknown>) : undefined),
    },
  });
  return broker;
}
