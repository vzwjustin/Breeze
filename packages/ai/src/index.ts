/**
 * Provider abstraction over OpenAI / Anthropic / Google / OpenRouter.
 *
 * The router selects a provider based on user settings and the task type
 * (e.g. summarization vs. planner vs. classification). Providers expose a
 * single `completeJson` for structured output and `stream` for chat turns.
 */
export type ProviderKind = "openai" | "anthropic" | "google" | "openrouter";

export interface AIMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface CompleteJsonArgs {
  model: string;
  system: string;
  user: string;
  schemaName: string;
}

export interface StreamArgs {
  model: string;
  messages: AIMessage[];
  signal?: AbortSignal;
}

export interface AIStream {
  [Symbol.asyncIterator](): AsyncIterator<string>;
}

export interface AIProvider {
  kind: ProviderKind;
  completeJson<T = unknown>(args: CompleteJsonArgs): Promise<T>;
  stream(args: StreamArgs): AIStream;
}

export interface AIRouterConfig {
  defaultProvider: ProviderKind;
  providers: Partial<Record<ProviderKind, AIProvider>>;
  fallbackOrder?: ProviderKind[];
}

export function createAIRouter(cfg: AIRouterConfig): AIProvider {
  const order = [cfg.defaultProvider, ...(cfg.fallbackOrder ?? [])];
  const pick = (): AIProvider => {
    for (const k of order) {
      const p = cfg.providers[k];
      if (p) return p;
    }
    throw new Error("No AI provider configured");
  };
  return {
    kind: cfg.defaultProvider,
    completeJson: (args) => pick().completeJson(args),
    stream: (args) => pick().stream(args),
  };
}

// Provider adapters are implemented per-provider file; stubs ship here so
// the repository typechecks without an API key.
export { openaiProvider } from "./openai.js";
export { anthropicProvider } from "./anthropic.js";
export { googleProvider } from "./google.js";
export { openrouterProvider } from "./openrouter.js";
