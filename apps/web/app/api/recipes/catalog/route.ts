import { NextResponse } from "next/server";
import { prisma } from "@breeze/db";
import { publicCatalog, publicTriggerCatalog } from "@breeze/connectors";
import { requireUser } from "@/server/auth/require-user";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = prisma as any;

export async function GET() {
  const { user } = await requireUser();
  const accounts: Array<{ connectorKey: string }> = await db.connectorAccount.findMany({
    where: { userId: user.id, status: "ACTIVE" },
    select: { connectorKey: true },
  });
  const connected = new Set<string>(accounts.map((a) => a.connectorKey));
  return NextResponse.json({
    triggers: publicTriggerCatalog(connected),
    capabilities: publicCatalog(connected),
  });
}
