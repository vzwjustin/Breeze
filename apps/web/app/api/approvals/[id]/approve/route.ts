import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireUser } from "@/server/auth/require-user";
import { ApprovalService } from "@/server/services/approval-service";

const Body = z.object({
  edit: z.record(z.unknown()).optional(),
  note: z.string().max(1000).optional(),
});

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const { user } = await requireUser();
  const body = Body.parse(await req.json().catch(() => ({})));
  const approval = await ApprovalService.approve(params.id, user.id, body);
  return NextResponse.json({ approval });
}
