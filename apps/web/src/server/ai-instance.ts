import {
  createAIRouter,
  openaiProvider,
  anthropicProvider,
  googleProvider,
  openrouterProvider,
  type AIProvider,
} from "@breeze/ai";

/**
 * Returns the configured AI provider for a given user. Reads the user's
 * default in Settings; falls through to env configuration. In the
 * scaffold every adapter is a stub.
 */
export function getAI(_userId: string): AIProvider {
  return createAIRouter({
    defaultProvider: "openai",
    providers: {
      openai: openaiProvider,
      anthropic: anthropicProvider,
      google: googleProvider,
      openrouter: openrouterProvider,
    },
    fallbackOrder: ["anthropic", "openrouter"],
  });
}
