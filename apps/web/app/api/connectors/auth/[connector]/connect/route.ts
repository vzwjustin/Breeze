import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/server/auth/require-user";
import { getConnector } from "@breeze/connectors";
import { prisma } from "@breeze/db";
import { randomBytes } from "node:crypto";
import { linkConnectorAccount } from "@/server/connectors/link-account";

const db = prisma as any;

export async function GET(
  req: NextRequest,
  { params }: { params: { connector: string } }
) {
  const { user } = await requireUser();
  const connector = getConnector(params.connector);
  if (!connector) {
    return NextResponse.json({ error: "Unknown connector" }, { status: 404 });
  }

  if (connector.meta.oauth.provider === "local") {
    try {
      const tokens = await connector.meta.oauth.exchangeCode("local");
      await linkConnectorAccount(db, user.id, params.connector, connector, tokens);
      return NextResponse.redirect(new URL("/connectors?connected=" + params.connector, req.url));
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Unknown error";
      return NextResponse.redirect(
        new URL(`/connectors?error=${encodeURIComponent(msg)}`, req.url)
      );
    }
  }

  const state = `${user.id}:${params.connector}:${randomBytes(16).toString("hex")}`;
  const url = connector.meta.oauth.consentUrlFactory(state);
  return NextResponse.redirect(url);
}
