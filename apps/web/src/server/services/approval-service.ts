import { prisma } from "@breeze/db";
import {
  BreezeError,
  type ActionRequest,
  type Approval,
  type ApprovalPreview,
  type ApprovalStatus,
  type RiskLevel,
} from "@breeze/common";
import { getBroker } from "@/server/broker-instance";
import { PlanService } from "./plan-service";
import { ChatService } from "./chat-service";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = prisma as any;

function mapStatus(v: string): ApprovalStatus {
  return v.toLowerCase() as ApprovalStatus;
}

function mapRisk(v: string): RiskLevel {
  return v.toLowerCase() as RiskLevel;
}

function mapRow(row: Record<string, unknown>): Approval {
  return {
    id: String(row.id),
    userId: String(row.userId),
    planStepId: String(row.planStepId),
    actionRequest: row.actionRequest as ActionRequest,
    preview: row.preview as ApprovalPreview,
    risk: mapRisk(String(row.risk)),
    status: mapStatus(String(row.status)),
    expiresAt: new Date(row.expiresAt as string).toISOString(),
    decidedAt: row.decidedAt ? new Date(row.decidedAt as string).toISOString() : undefined,
    decisionNote: (row.decisionNote as string | null) ?? undefined,
    waitToken: (row.waitToken as string | null) ?? undefined,
    createdAt: new Date(row.createdAt as string).toISOString(),
  };
}

function summarizeOutcome(output: Record<string, unknown> | undefined): string {
  if (!output) return "Action completed.";
  if (typeof output.summary === "string") return output.summary;
  if (typeof output.message === "string") return output.message;
  try {
    return JSON.stringify(output).slice(0, 500);
  } catch {
    return "Action completed.";
  }
}

/**
 * Approval service: creation is centralized in the broker; this module
 * exposes read + decision operations used by UI routes.
 */
export const ApprovalService = {
  async listPending(userId: string): Promise<Approval[]> {
    const rows = await db.approval.findMany({
      where: { userId, status: "PENDING", expiresAt: { gt: new Date() } },
      orderBy: { createdAt: "desc" },
      take: 100,
    });
    return rows.map(mapRow);
  },

  async listRecentDecided(userId: string, limit = 25): Promise<Approval[]> {
    const rows = await db.approval.findMany({
      where: {
        userId,
        status: { in: ["APPROVED", "DENIED", "EXPIRED", "CANCELED", "SUPERSEDED"] },
      },
      orderBy: { decidedAt: "desc" },
      take: Math.min(Math.max(1, limit), 200),
    });
    return rows.map(mapRow);
  },

  async get(id: string, userId: string): Promise<Approval> {
    const row = await db.approval.findFirst({ where: { id, userId } });
    if (!row) throw new BreezeError("not_found", "Approval not found");
    return mapRow(row);
  },

  async approve(
    id: string,
    userId: string,
    opts: { edit?: Record<string, unknown>; note?: string } = {}
  ): Promise<{ approval: Approval; execution?: { ok: boolean; detail: string } }> {
    const approval = await db.$transaction(async (tx: Record<string, Record<string, Function>>) => {
      const current = await (tx.approval as { findFirst: Function }).findFirst({ where: { id, userId } });
      if (!current) throw new BreezeError("not_found", "Approval not found");
      if (String(current.status) !== "PENDING") {
        throw new BreezeError("conflict", `Approval already ${String(current.status).toLowerCase()}`);
      }
      const existing = current.actionRequest as ActionRequest;
      const actionRequest: ActionRequest = opts.edit
        ? { ...existing, input: { ...existing.input, ...opts.edit } }
        : existing;
      const row = await (tx.approval as { update: Function }).update({
        where: { id },
        data: {
          status: "APPROVED",
          decidedAt: new Date(),
          decisionNote: opts.note ?? null,
          actionRequest,
        },
      });
      return mapRow(row as Record<string, unknown>);
    });

    let execution: { ok: boolean; detail: string } | undefined;
    try {
      const outcome = await getBroker().resumeAfterApproval(id);
      if (outcome.kind === "allowed") {
        const detail = summarizeOutcome(outcome.result.output);
        await PlanService.markStepCompleted(approval.planStepId, detail);
        const step = await PlanService.getStep(approval.planStepId);
        if (step?.plan?.chatId) {
          await ChatService.appendAssistantMessage(step.plan.chatId, {
            text: `Approved and completed: ${detail}`,
          });
        }
        execution = { ok: true, detail };
      } else if (outcome.kind === "failed") {
        await PlanService.markStepFailed(approval.planStepId, outcome.errorMessage);
        execution = { ok: false, detail: outcome.errorMessage };
      } else if (outcome.kind === "denied") {
        await PlanService.markStepFailed(approval.planStepId, outcome.reason);
        execution = { ok: false, detail: outcome.reason };
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      execution = { ok: false, detail: msg };
    }

    return { approval, execution };
  },

  async deny(id: string, userId: string, note?: string): Promise<Approval> {
    return db.$transaction(async (tx: Record<string, Record<string, Function>>) => {
      const current = await (tx.approval as { findFirst: Function }).findFirst({ where: { id, userId } });
      if (!current) throw new BreezeError("not_found", "Approval not found");
      if (String(current.status) !== "PENDING") {
        throw new BreezeError("conflict", `Approval already ${String(current.status).toLowerCase()}`);
      }
      const row = await (tx.approval as { update: Function }).update({
        where: { id },
        data: { status: "DENIED", decidedAt: new Date(), decisionNote: note ?? null },
      });
      await PlanService.markStepFailed(String(current.planStepId), note ?? "denied by user");
      return mapRow(row as Record<string, unknown>);
    });
  },

  async cancel(id: string, userId: string): Promise<Approval> {
    return db.$transaction(async (tx: Record<string, Record<string, Function>>) => {
      const current = await (tx.approval as { findFirst: Function }).findFirst({ where: { id, userId } });
      if (!current) throw new BreezeError("not_found", "Approval not found");
      if (String(current.status) !== "PENDING") {
        throw new BreezeError("conflict", `Approval already ${String(current.status).toLowerCase()}`);
      }
      const row = await (tx.approval as { update: Function }).update({
        where: { id },
        data: { status: "CANCELED", decidedAt: new Date() },
      });
      return mapRow(row as Record<string, unknown>);
    });
  },
};
