import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireUser } from "@/server/auth/require-user";

const TaskScheduleSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("cron"), cron: z.string(), tz: z.string() }),
  z.object({ kind: z.literal("once"), runAt: z.string() }),
  z.object({
    kind: z.literal("watch"),
    source: z.object({
      connector: z.string(),
      resource: z.string(),
      pollSeconds: z.number().int().min(30),
    }),
  }),
]);

const CreateTask = z.object({
  name: z.string().min(1).max(120),
  description: z.string().max(1000).optional(),
  prompt: z.string().min(1).max(4000),
  schedule: TaskScheduleSchema,
  approvalMode: z.enum(["per_run", "once_on_create", "policy"]).default("policy"),
  policyProfileId: z.string().optional(),
});

export async function GET() {
  const { user: _user } = await requireUser();
  return NextResponse.json({ tasks: [] });
}

export async function POST(req: NextRequest) {
  const { user: _user } = await requireUser();
  const _body = CreateTask.parse(await req.json());
  return NextResponse.json({ ok: true, id: "stub" }, { status: 201 });
}
