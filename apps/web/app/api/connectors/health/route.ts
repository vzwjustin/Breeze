/**
 * GET /api/connectors/health — per-user connector token status.
 */
import { NextRequest, NextResponse } from "next/server";
import { isBreezeError } from "@breeze/common";
import { requireUser } from "@/server/auth/require-user";
import { enforceRateLimit } from "@/server/rate-limit";
import { prisma } from "@breeze/db";

export const runtime = "nodejs";

const db = prisma as any;

export async function GET(_req: NextRequest) {
  const { user } = await requireUser();

  try {
    await enforceRateLimit(user.id, "connectors.health", { capacity: 10, refillPerSec: 0.05 });
  } catch (err) {
    if (isBreezeError(err) && err.code === "rate_limit") {
      const retryAfterMs = (err.details?.retryAfterMs as number | undefined) ?? 0;
      return NextResponse.json(
        { error: err.message },
        { status: 429, headers: { "Retry-After": String(Math.ceil(retryAfterMs / 1000)) } }
      );
    }
    throw err;
  }

  const accounts = await db.connectorAccount.findMany({
    where: { userId: user.id, deletedAt: null },
    select: {
      id: true,
      connectorKey: true,
      status: true,
      credential: { select: { expiresAt: true } },
    },
  });

  const checkedAt = new Date().toISOString();
  const now = Date.now();
  const connectors = accounts.map(
    (a: {
      id: string;
      connectorKey: string;
      status: string;
      credential: { expiresAt: Date | null } | null;
    }) => {
      const expMs = a.credential?.expiresAt ? new Date(a.credential.expiresAt).getTime() : null;
      let status = String(a.status).toLowerCase();
      if (expMs !== null && expMs < now) status = "token_expired";
      if (status === "active") status = "ok";
      return { connector: a.connectorKey, accountId: a.id, status, checkedAt };
    }
  );

  return NextResponse.json({ connectors });
}
