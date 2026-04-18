import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { isBreezeError } from "@breeze/common";
import { requireUser } from "@/server/auth/require-user";
import { ApprovalService } from "@/server/services/approval-service";
import { enforceRateLimit } from "@/server/rate-limit";

const Body = z.object({ note: z.string().max(1000).optional() });

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const { user } = await requireUser();

  try {
    await enforceRateLimit(user.id, "approvals.deny", { capacity: 60, refillPerSec: 1 });
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

  const body = Body.parse(await req.json().catch(() => ({})));
  const approval = await ApprovalService.deny(params.id, user.id, body.note);
  return NextResponse.json({ approval });
}
