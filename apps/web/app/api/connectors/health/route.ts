/**
 * GET /api/connectors/health — per-user connector token status.
 */
import { NextRequest, NextResponse } from "next/server";
import { isBreezeError } from "@breeze/common";
import { requireUser } from "@/server/auth/require-user";
import { enforceRateLimit } from "@/server/rate-limit";
import { prisma } from "@breeze/db";

export const runtime = "nodejs";

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

  const accounts = await (prisma as unknown as {
    connectorAccount: { findMany: (args: unknown) => Promise<Array<{ id: string; connector: string; tokenExpiresAt?: Date | null }>> };
  }).connectorAccount.findMany({ where: { userId: user.id } });

  const checkedAt = new Date().toISOString();
  const now = Date.now();
  const connectors = accounts.map((a) => {
    const expMs = a.tokenExpiresAt ? new Date(a.tokenExpiresAt).getTime() : null;
    const status = expMs !== null && expMs < now ? "token_expired" : "ok";
    return { connector: a.connector, accountId: a.id, status, checkedAt };
  });

  return NextResponse.json({ connectors });
}
