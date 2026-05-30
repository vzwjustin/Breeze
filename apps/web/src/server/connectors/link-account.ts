import { encryptString } from "@breeze/db";
import type { Connector, ConnectorTokens } from "@breeze/connectors";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function linkConnectorAccount(
  db: any,
  userId: string,
  connectorKey: string,
  connector: Connector,
  tokens: ConnectorTokens
): Promise<void> {
  const encryptedTokens = encryptString(
    JSON.stringify({
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
      expiresAt: tokens.expiresAt?.toISOString(),
      raw: tokens.raw,
    })
  );

  const existing = await db.connectorAccount.findFirst({
    where: { userId, connectorKey },
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
    return;
  }

  const account = await db.connectorAccount.create({
    data: {
      userId,
      connectorKey,
      providerAccountId: `${connectorKey}:${userId}`,
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
