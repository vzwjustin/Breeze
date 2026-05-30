import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/server/auth/require-user";
import { getConnector } from "@breeze/connectors";
import { prisma } from "@breeze/db";
import { linkConnectorAccount } from "@/server/connectors/link-account";

const db = prisma as any;

export async function GET(
  req: NextRequest,
  { params }: { params: { connector: string } }
) {
  const { user } = await requireUser();

  const searchParams = req.nextUrl.searchParams;
  const code = searchParams.get("code");
  const state = searchParams.get("state");
  const error = searchParams.get("error");

  if (error) {
    return NextResponse.redirect(new URL(`/connectors?error=${encodeURIComponent(error)}`, req.url));
  }

  if (!code || !state) {
    return NextResponse.redirect(new URL("/connectors?error=missing_params", req.url));
  }

  const stateParts = state.split(":");
  if (stateParts[0] !== user.id || stateParts[1] !== params.connector) {
    return NextResponse.redirect(new URL("/connectors?error=invalid_state", req.url));
  }

  const connector = getConnector(params.connector);
  if (!connector) {
    return NextResponse.redirect(new URL("/connectors?error=unknown_connector", req.url));
  }

  try {
    const tokens = await connector.meta.oauth.exchangeCode(code);
    await linkConnectorAccount(db, user.id, params.connector, connector, tokens);
    return NextResponse.redirect(new URL("/connectors?connected=" + params.connector, req.url));
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.redirect(new URL(`/connectors?error=${encodeURIComponent(msg)}`, req.url));
  }
}
