import { prisma, decryptString, encryptString } from "@breeze/db";
import { BreezeError } from "@breeze/common";
import { getConnector, type ConnectorAccountHandle, type ConnectorTokens } from "@breeze/connectors";

const db = prisma as any;

export async function getConnectorAccount(
  userId: string,
  connectorKey: string
): Promise<ConnectorAccountHandle> {
  const account = await db.connectorAccount.findFirst({
    where: { userId, connectorKey, deletedAt: null, status: "ACTIVE" },
  });
  if (!account) {
    throw new BreezeError("auth", `No active connector account for ${connectorKey}`);
  }
  return {
    id: account.id,
    userId: account.userId,
    connectorKey: account.connectorKey,
    scopes: account.scopes,
    providerAccountId: account.providerAccountId,
  };
}

export async function getFreshTokensForWorker(
  account: ConnectorAccountHandle
): Promise<ConnectorTokens> {
  const credential = await db.connectorCredential.findUnique({
    where: { accountId: account.id },
  });
  if (!credential) {
    throw new BreezeError("auth", `No credentials for connector account ${account.id}`);
  }
  const raw = JSON.parse(decryptString(credential.encryptedTokens as Buffer)) as {
    accessToken: string;
    refreshToken?: string;
    expiresAt?: string;
  };
  const expiresAt = credential.expiresAt ? new Date(credential.expiresAt) : undefined;
  const tokens: ConnectorTokens = {
    accessToken: raw.accessToken,
    refreshToken: raw.refreshToken,
    expiresAt,
    raw: raw as Record<string, unknown>,
  };
  if (expiresAt && expiresAt < new Date()) {
    const connector = getConnector(account.connectorKey);
    if (connector?.meta.oauth.refresh && tokens.refreshToken) {
      const refreshed = await connector.meta.oauth.refresh(tokens);
      const encryptedTokens = encryptString(
        JSON.stringify({
          accessToken: refreshed.accessToken,
          refreshToken: refreshed.refreshToken ?? tokens.refreshToken,
          expiresAt: refreshed.expiresAt?.toISOString(),
          raw: refreshed.raw,
        })
      );
      await db.connectorCredential.update({
        where: { accountId: account.id },
        data: {
          encryptedTokens: Buffer.from(encryptedTokens),
          expiresAt: refreshed.expiresAt ?? null,
        },
      });
      return refreshed;
    }
    throw new BreezeError("auth", `Tokens expired for connector ${account.connectorKey}`);
  }
  return tokens;
}
