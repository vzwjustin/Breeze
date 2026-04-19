import { NextResponse } from "next/server";
import { requireUser } from "@/server/auth/require-user";
import { prisma } from "@breeze/db";

const db = prisma as any;

export async function POST() {
  const { user } = await requireUser();

  await db.memory.updateMany({
    where: { userId: user.id, deletedAt: null },
    data: { deletedAt: new Date() },
  });

  return NextResponse.json({ ok: true });
}
