import { NextRequest, NextResponse } from "next/server";
import { CreateRecipeSchema } from "@breeze/common";
import { requireUser } from "@/server/auth/require-user";
import { RecipeService } from "@/server/services/recipe-service";

export async function GET() {
  const { user } = await requireUser();
  const recipes = await RecipeService.list(user.id);
  return NextResponse.json({ recipes });
}

export async function POST(req: NextRequest) {
  const { user } = await requireUser();
  const body = CreateRecipeSchema.parse(await req.json());
  const recipe = await RecipeService.create(user.id, body);
  return NextResponse.json({ recipe }, { status: 201 });
}
