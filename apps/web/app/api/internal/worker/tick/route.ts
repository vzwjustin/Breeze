import { NextRequest, NextResponse } from "next/server";
import { runWorkerTick } from "@/server/worker/run-tick";

export const runtime = "nodejs";
export const maxDuration = 120;

export async function POST(req: NextRequest) {
  const secret = process.env.BREEZE_CRON_SECRET;
  if (!secret) {
    return NextResponse.json({ error: "BREEZE_CRON_SECRET not configured" }, { status: 503 });
  }
  const auth = req.headers.get("authorization");
  if (auth !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const result = await runWorkerTick();
  return NextResponse.json({ ok: true, ...result });
}
