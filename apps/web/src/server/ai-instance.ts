import {
  createAIRouter,
  openaiProvider,
  anthropicProvider,
  googleProvider,
  openrouterProvider,
  type AIProvider,
} from "@breeze/ai";

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
  if (process.env.GOOGLE_API_KEY || process.env.GEMINI_API_KEY) return "google";
  if (process.env.OPENROUTER_API_KEY) return "openrouter";
  return "openai";
}

function resolveFallback(primary: ProviderKind): ProviderKind[] {
  return (["openai", "anthropic", "google", "openrouter"] as ProviderKind[]).filter((k) => k !== primary);
}

/**
 * Returns the configured AI provider for a given user. Reads the user's
 * default from env; per-user overrides will be read from Settings once
 * persisted user preferences land.
 */
export function getAI(_userId: string): AIProvider {
  const primary = resolveDefault();
  return createAIRouter({
    defaultProvider: primary,
    providers: PROVIDERS,
    fallbackOrder: resolveFallback(primary),
  });
}
