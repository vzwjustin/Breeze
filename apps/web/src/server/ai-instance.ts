import {
  createAIRouter,
  openaiProvider,
  anthropicProvider,
  googleProvider,
  openrouterProvider,
  type AIProvider,
} from "@breeze/ai";
import { BreezeError } from "@breeze/common";

type ProviderKind = "openai" | "anthropic" | "google" | "openrouter";

const PROVIDERS = {
  openai: openaiProvider,
  anthropic: anthropicProvider,
  google: googleProvider,
  openrouter: openrouterProvider,
} as const satisfies Record<ProviderKind, AIProvider>;

function resolveDefault(): ProviderKind {
  const raw = process.env.BREEZE_AI_PROVIDER?.toLowerCase();
  if (raw === "openai" || raw === "anthropic" || raw === "google" || raw === "openrouter") {
    return raw;
  }
  if (process.env.OPENAI_API_KEY) return "openai";
  if (process.env.ANTHROPIC_API_KEY) return "anthropic";
  if (process.env.GOOGLE_API_KEY || process.env.GOOGLE_AI_API_KEY || process.env.GEMINI_API_KEY) return "google";
  if (process.env.OPENROUTER_API_KEY) return "openrouter";
  throw new BreezeError(
    "unknown",
    "No AI provider configured — set one of ANTHROPIC_API_KEY / OPENAI_API_KEY / GOOGLE_API_KEY",
  );
}

function resolveFallback(primary: ProviderKind): ProviderKind[] {
  return (["openai", "anthropic", "google", "openrouter"] as ProviderKind[]).filter((k) => k !== primary);
}

/**
 * Returns the configured AI provider for a given user. Reads per-user
 * aiProvider preference from the database; falls back to env-based default.
 */
export async function getAI(userId: string): Promise<AIProvider> {
  // Lazy import to avoid circular init at module load time.
  const { prisma } = await import("@breeze/db");
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = prisma as any;

  let primary = resolveDefault();
  try {
    const user = await db.user.findUnique({
      where: { id: userId },
      select: { preferences: true },
    });
    const prefs = user?.preferences as { aiProvider?: string } | null | undefined;
    const pref = prefs?.aiProvider?.toLowerCase();
    if (pref === "openai" || pref === "anthropic" || pref === "google" || pref === "openrouter") {
      primary = pref as ProviderKind;
    }
  } catch {
    // DB unavailable — use env default.
  }

  return createAIRouter({
    defaultProvider: primary,
    providers: PROVIDERS,
    fallbackOrder: resolveFallback(primary),
  });
}
