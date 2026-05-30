import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/server/auth/require-user";
import { prisma } from "@breeze/db";
import { BreezeError } from "@breeze/common";

const db = prisma as any;

/**
 * POST /api/tasks/:taskId/retry — reschedule a failed task for the next worker pass.
 */
export async function POST(
  _req: NextRequest,
  { params }: { params: { taskId: string } }
) {
  const { user } = await requireUser();

  const task = await db.task.findFirst({
    where: { id: params.taskId, userId: user.id, deletedAt: null },
    select: { id: true },
  });
  if (!task) {
    throw new BreezeError("not_found", "Task not found");
  }

  await db.task.update({
    where: { id: task.id },
    data: {
      status: "ACTIVE",
      nextRunAt: new Date(),
      updatedAt: new Date(),
    },
  });

  return NextResponse.json({ ok: true, taskId: task.id });
}
