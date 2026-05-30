/**
 * GET/PATCH /api/me/preferences — user settings (AI provider, planner model, UI density).
 */
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireUser } from "@/server/auth/require-user";
import { prisma } from "@breeze/db";

const db = prisma as any;

export const runtime = "nodejs";

const PreferencesSchema = z
  .object({
    aiProvider: z.enum(["anthropic", "openai", "google", "openrouter"]).optional(),
    plannerModel: z.string().min(1).max(100).optional(),
    density: z.enum(["compact", "comfortable"]).optional(),
  })
  .strict();

export async function PATCH(req: NextRequest) {
  const { user } = await requireUser();
  const body = PreferencesSchema.parse(await req.json());

  const existing = await db.user.findUnique({
    where: { id: user.id },
    select: { preferences: true },
  });
  const merged = {
    ...((existing?.preferences as Record<string, unknown> | null) ?? {}),
    ...body,
  };

  const updated = await db.user.update({
    where: { id: user.id },
    data: { preferences: merged },
    select: { preferences: true },
  });

  return NextResponse.json(updated);
}

export async function GET(_req: NextRequest) {
  const { user } = await requireUser();
  const row = await db.user.findUnique({
    where: { id: user.id },
    select: { preferences: true },
  });
  return NextResponse.json({ preferences: row?.preferences ?? {} });
}
