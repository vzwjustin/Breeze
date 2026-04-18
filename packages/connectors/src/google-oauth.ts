import { BreezeError } from "@breeze/common";
import { randomBytes, createHash } from "node:crypto";
import { requireEnv, env } from "./http.js";
import type { ConnectorTokens } from "./types.js";

export function generatePkcePair(): { verifier: string; challenge: string } {
  const verifier = randomBytes(32).toString("base64url").replace(/=/g, "");
  const challenge = createHash("sha256").update(verifier).digest("base64url").replace(/=/g, "");
  return { verifier, challenge };
}

const AUTHORIZE = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN = "https://oauth2.googleapis.com/token";

export function googleConsentUrl(state: string, scopes: string[], codeChallenge?: string): string {
  const clientId = requireEnv("GOOGLE_CLIENT_ID");
  const redirectUri = requireEnv("GOOGLE_REDIRECT_URI");
  const u = new URL(AUTHORIZE);
  u.searchParams.set("client_id", clientId);
  u.searchParams.set("redirect_uri", redirectUri);
  u.searchParams.set("response_type", "code");
  u.searchParams.set("scope", scopes.join(" "));
  u.searchParams.set("access_type", "offline");
  u.searchParams.set("include_granted_scopes", "true");
  u.searchParams.set("prompt", env("GOOGLE_OAUTH_PROMPT") ?? "consent");
  u.searchParams.set("state", state);
  if (codeChallenge) {
    u.searchParams.set("code_challenge", codeChallenge);
    u.searchParams.set("code_challenge_method", "S256");
  }
  return u.toString();
}

export async function googleExchangeCode(code: string, codeVerifier?: string): Promise<ConnectorTokens> {
  const clientId = requireEnv("GOOGLE_CLIENT_ID");
  const clientSecret = requireEnv("GOOGLE_CLIENT_SECRET");
  const redirectUri = requireEnv("GOOGLE_REDIRECT_URI");
  const params: Record<string, string> = {
    client_id: clientId,
    client_secret: clientSecret,
    code,
    grant_type: "authorization_code",
    redirect_uri: redirectUri,
  };
  if (codeVerifier) params.code_verifier = codeVerifier;
  const body = new URLSearchParams(params);
  const res = await fetch(TOKEN, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
    body,
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    console.error("[google-oauth] token exchange failed:", res.status, text.slice(0, 500));
    throw new BreezeError("auth", "Google token exchange failed");
  }
  const json = (await res.json()) as {
    access_token?: string;
    refresh_token?: string;
    expires_in?: number;
    scope?: string;
    token_type?: string;
  };
  if (!json.access_token) throw new BreezeError("auth", "Google token exchange returned no access_token");
  return {
    accessToken: json.access_token,
    refreshToken: json.refresh_token,
    expiresAt: json.expires_in ? new Date(Date.now() + json.expires_in * 1000) : undefined,
    raw: json as Record<string, unknown>,
  };
}

export async function googleRefresh(tokens: ConnectorTokens): Promise<ConnectorTokens> {
  if (!tokens.refreshToken) throw new BreezeError("auth", "Google refresh requires a refresh_token");
  const clientId = requireEnv("GOOGLE_CLIENT_ID");
  const clientSecret = requireEnv("GOOGLE_CLIENT_SECRET");
  const body = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    grant_type: "refresh_token",
    refresh_token: tokens.refreshToken,
  });
  const res = await fetch(TOKEN, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
    body,
  });
  if (!res.ok) throw new BreezeError("auth", `Google token refresh failed: ${res.status}`);
  const json = (await res.json()) as { access_token?: string; expires_in?: number };
  if (!json.access_token) throw new BreezeError("auth", "Google refresh returned no access_token");
  return {
    accessToken: json.access_token,
    refreshToken: tokens.refreshToken,
    expiresAt: json.expires_in ? new Date(Date.now() + json.expires_in * 1000) : undefined,
    raw: { ...tokens.raw, ...(json as Record<string, unknown>) },
  };
}
