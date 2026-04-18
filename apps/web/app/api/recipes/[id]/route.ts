import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireUser } from "@/server/auth/require-user";
import { RecipeService } from "@/server/services/recipe-service";

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const { user } = await requireUser();
  const recipe = await RecipeService.get(params.id, user.id);
  return NextResponse.json({ recipe });
}

const PatchSchema = z.object({
  status: z.enum(["active", "paused", "archived"]),
});

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const { user } = await requireUser();
  const body = PatchSchema.parse(await req.json());
  const recipe = await RecipeService.setStatus(params.id, user.id, body.status);
  return NextResponse.json({ recipe });
}
