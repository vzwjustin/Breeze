import type { z } from "zod";
import type { RiskLevel } from "@breeze/common";

export interface ConnectorTokens {
  accessToken: string;
  refreshToken?: string;
  expiresAt?: Date;
  raw: Record<string, unknown>;
}

export interface ConnectorAccountHandle {
  id: string;
  userId: string;
  connectorKey: string;
  scopes: string[];
  providerAccountId: string;
}

export interface ConnectorExecutionContext {
  account: ConnectorAccountHandle;
  tokens: ConnectorTokens;
  logger: {
    info: (msg: string, data?: unknown) => void;
    warn: (msg: string, data?: unknown) => void;
    error: (msg: string, data?: unknown) => void;
  };
  signal: AbortSignal;
}

export interface ConnectorMeta {
  key: string;
  displayName: string;
  description: string;
  version: string;
  icon: string;
  oauth: {
    provider: "google" | "github" | "microsoft" | "local";
    scopes: string[];
    consentUrlFactory: (state: string) => string;
    exchangeCode: (code: string) => Promise<ConnectorTokens>;
    refresh?: (tokens: ConnectorTokens) => Promise<ConnectorTokens>;
  };
}

export interface ConnectorCapability<I = unknown, O = unknown> {
  key: string;
  displayName: string;
  description: string;
  sensitivity: RiskLevel;
  mutatesState: boolean;
  approvalHint: "never" | "sometimes" | "always";
  idempotent: boolean;
  inputSchema: z.ZodSchema<I>;
  outputSchema: z.ZodSchema<O>;
  rateLimit?: { perMinute: number; perDay?: number };
  execute: (input: I, ctx: ConnectorExecutionContext) => Promise<O>;
}

export interface Connector {
  meta: ConnectorMeta;
  healthCheck: (
    ctx: ConnectorExecutionContext
  ) => Promise<{ ok: boolean; message?: string }>;
  capabilities: ConnectorCapability[];
}
