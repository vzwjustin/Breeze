import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@breeze/db";
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

type TaskSchedule = z.infer<typeof TaskScheduleSchema>;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = prisma as any;

function nextRunAt(schedule: TaskSchedule): Date | null {
  if (schedule.kind === "once") return new Date(schedule.runAt);
  // cron/watch are resolved by the worker on registration.
  return null;
}

export async function GET() {
  const { user } = await requireUser();
  const rows = await db.task.findMany({
    where: { userId: user.id, deletedAt: null },
    orderBy: { updatedAt: "desc" },
    take: 200,
    select: {
      id: true,
      name: true,
      description: true,
      prompt: true,
      schedule: true,
      status: true,
      lastRunAt: true,
      nextRunAt: true,
      approvalMode: true,
      createdAt: true,
      updatedAt: true,
    },
  });
  return NextResponse.json({ tasks: rows });
}

export async function POST(req: NextRequest) {
  const { user } = await requireUser();
  const body = CreateTask.parse(await req.json());
  const created = await db.task.create({
    data: {
      userId: user.id,
      name: body.name,
      description: body.description ?? null,
      prompt: body.prompt,
      schedule: body.schedule,
      approvalMode: body.approvalMode,
      policyProfileId: body.policyProfileId ?? null,
      nextRunAt: nextRunAt(body.schedule),
    },
    select: { id: true },
  });
  return NextResponse.json({ ok: true, id: created.id }, { status: 201 });
}
