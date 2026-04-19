import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@breeze/db";
import { requireUser } from "@/server/auth/require-user";
import { isBreezeError } from "@breeze/common";
import { enforceRateLimit } from "@/server/rate-limit";

const db = prisma as any;

const CreateChatSchema = z.object({
  title: z.string().min(1).max(200).optional(),
  firstMessage: z.string().min(1).max(20_000).optional(),
});

export async function GET(_req: NextRequest) {
  const { user } = await requireUser();

  const chats = await db.chat.findMany({
    where: { userId: user.id, deletedAt: null },
    orderBy: { updatedAt: "desc" },
    take: 50,
    select: {
      id: true,
      title: true,
      summary: true,
      createdAt: true,
      updatedAt: true,
      _count: { select: { messages: true } },
    },
  });

  return NextResponse.json({ chats });
}

export async function POST(req: NextRequest) {
  const { user } = await requireUser();

  try {
    await enforceRateLimit(user.id, "chat.create", { capacity: 30, refillPerSec: 0.5 });
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

  const body = CreateChatSchema.parse(await req.json().catch(() => ({})));
  const title = body.title ?? body.firstMessage?.slice(0, 60) ?? "New chat";

  const chat = await db.chat.create({
    data: { userId: user.id, title },
    select: { id: true, title: true, createdAt: true },
  });

  return NextResponse.json({ chat }, { status: 201 });
}
