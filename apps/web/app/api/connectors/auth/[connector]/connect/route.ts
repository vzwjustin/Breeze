import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/server/auth/require-user";
import { getConnector } from "@breeze/connectors";
import { BreezeError } from "@breeze/common";
import { randomBytes } from "node:crypto";

export async function GET(
  _req: NextRequest,
  { params }: { params: { connector: string } }
) {
  const { user } = await requireUser();
  const connector = getConnector(params.connector);
  if (!connector) {
    return NextResponse.json({ error: "Unknown connector" }, { status: 404 });
  }

  const state = `${user.id}:${params.connector}:${randomBytes(16).toString("hex")}`;
  const url = connector.meta.oauth.consentUrlFactory(state);

  return NextResponse.redirect(url);
}
