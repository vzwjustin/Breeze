/**
 * PATCH /api/me/preferences — update the authenticated user's preferences.
 */
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireUser } from "@/server/auth/require-user";
import { prisma } from "@breeze/db";

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

  const updated = await (prisma as unknown as {
    user: { update: (args: unknown) => Promise<{ preferences: unknown }> };
  }).user.update({
    where: { id: user.id },
    data: { preferences: body },
    select: { preferences: true },
  });

  return NextResponse.json(updated);
}

export async function GET(_req: NextRequest) {
  const { user } = await requireUser();
  const row = await (prisma as unknown as {
    user: { findUnique: (args: unknown) => Promise<{ preferences: unknown } | null> };
  }).user.findUnique({ where: { id: user.id }, select: { preferences: true } });
  return NextResponse.json({ preferences: row?.preferences ?? {} });
}
