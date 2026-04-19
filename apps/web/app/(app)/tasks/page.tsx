import { requireUser } from "@/server/auth/require-user";
import { prisma } from "@breeze/db";
import { TasksClient } from "./tasks-client";
import type { Task } from "@breeze/common";

const db = prisma as any;

export default async function TasksPage() {
  const { user } = await requireUser();

  const [taskRows, failureRows] = await Promise.all([
    db.task.findMany({
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
    }),
    db.taskRun
      .findMany({
        where: { task: { userId: user.id }, status: "FAILED" },
        orderBy: { startedAt: "desc" },
        take: 20,
        select: {
          id: true,
          taskId: true,
          status: true,
          errorMessage: true,
          startedAt: true,
        },
      })
      .catch(() => []),
  ]);

  const tasks: Task[] = taskRows.map((r: any) => ({
    id: r.id,
    userId: user.id,
    name: r.name,
    description: r.description ?? undefined,
    prompt: r.prompt,
    schedule: r.schedule,
    approvalMode: r.approvalMode,
    status: r.status.toLowerCase(),
    lastRunAt: r.lastRunAt?.toISOString(),
    nextRunAt: r.nextRunAt?.toISOString(),
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
  }));

  const failures = failureRows.map((r: any) => ({
    id: r.id,
    taskId: r.taskId,
    status: r.status,
    errorMessage: r.errorMessage ?? undefined,
    startedAt: r.startedAt.toISOString(),
  }));

  return <TasksClient tasks={tasks} recentFailures={failures} />;
}
