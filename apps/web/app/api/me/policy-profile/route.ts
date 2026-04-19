import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireUser } from "@/server/auth/require-user";
import { prisma } from "@breeze/db";
import { getBuiltinProfile } from "@breeze/policy/profiles";

const db = prisma as any;

const Body = z.object({
  policyProfileId: z.string().min(1),
});

export async function PATCH(req: NextRequest) {
  const { user } = await requireUser();
  const { policyProfileId } = Body.parse(await req.json());

  const isBuiltin = getBuiltinProfile(policyProfileId) !== undefined;
  if (!isBuiltin) {
    const custom = await db.policyProfile.findFirst({
      where: { id: policyProfileId, userId: user.id },
    });
    if (!custom) {
      return NextResponse.json({ error: "Policy profile not found" }, { status: 404 });
    }
  }

  await db.user.update({
    where: { id: user.id },
    data: { policyProfileId },
  });

  return NextResponse.json({ ok: true });
}
