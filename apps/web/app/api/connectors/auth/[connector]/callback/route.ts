import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/server/auth/require-user";
import { getConnector } from "@breeze/connectors";
import { BreezeError } from "@breeze/common";
import { prisma, encryptString } from "@breeze/db";

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

    const encryptedTokens = encryptString(JSON.stringify({
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
      expiresAt: tokens.expiresAt?.toISOString(),
      raw: tokens.raw,
    }));

    const existing = await db.connectorAccount.findFirst({
      where: { userId: user.id, connectorKey: params.connector },
    });

    if (existing) {
      await db.connectorAccount.update({
        where: { id: existing.id },
        data: { status: "ACTIVE", deletedAt: null, updatedAt: new Date() },
      });
      await db.connectorCredential.upsert({
        where: { accountId: existing.id },
        update: {
          encryptedTokens: Buffer.from(encryptedTokens),
          expiresAt: tokens.expiresAt ?? null,
          updatedAt: new Date(),
        },
        create: {
          accountId: existing.id,
          encryptedTokens: Buffer.from(encryptedTokens),
          expiresAt: tokens.expiresAt ?? null,
        },
      });
    } else {
      const account = await db.connectorAccount.create({
        data: {
          userId: user.id,
          connectorKey: params.connector,
          providerAccountId: `${params.connector}:${user.id}`,
          scopes: connector.meta.oauth.scopes,
          status: "ACTIVE",
        },
      });
      await db.connectorCredential.create({
        data: {
          accountId: account.id,
          encryptedTokens: Buffer.from(encryptedTokens),
          expiresAt: tokens.expiresAt ?? null,
        },
      });
    }

    return NextResponse.redirect(new URL("/connectors?connected=" + params.connector, req.url));
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.redirect(new URL(`/connectors?error=${encodeURIComponent(msg)}`, req.url));
  }
}
