import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/server/auth/require-user";
import { runRecipeNow } from "@/server/worker/recipe-adapter";

export async function POST(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  const { user } = await requireUser();
  const result = await runRecipeNow(params.id, user.id);
  return NextResponse.json(result);
}
