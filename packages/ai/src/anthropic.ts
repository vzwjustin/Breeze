import type { AIProvider, AIStream, CompleteJsonArgs, StreamArgs } from "./index.js";

declare const process: { env: Record<string, string | undefined> };

const DEFAULT_ENDPOINT = "https://api.anthropic.com/v1/messages";
const API_VERSION = "2023-06-01";

interface AnthropicConfig {
  apiKey?: string;
  baseUrl?: string;
  version: string;
  maxTokens: number;
}

function resolveConfig(): AnthropicConfig {
  const maxTokens = Number(process.env.ANTHROPIC_MAX_TOKENS ?? 4096);
  return {
    apiKey: process.env.ANTHROPIC_API_KEY,
    baseUrl: process.env.ANTHROPIC_BASE_URL ?? DEFAULT_ENDPOINT,
    version: process.env.ANTHROPIC_VERSION ?? API_VERSION,
    maxTokens: Number.isFinite(maxTokens) && maxTokens > 0 ? maxTokens : 4096,
  };
}

function buildHeaders(cfg: AnthropicConfig): Record<string, string> {
  if (!cfg.apiKey) {
    throw new Error("ANTHROPIC_API_KEY is not set");
  }
  return {
    "Content-Type": "application/json",
    "x-api-key": cfg.apiKey,
    "anthropic-version": cfg.version,
  };
}

function extractJson(text: string): string {
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence?.[1]) return fence[1].trim();
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start !== -1 && end > start) return text.slice(start, end + 1);
  return text.trim();
}

export const anthropicProvider: AIProvider = {
  kind: "anthropic",

  async completeJson<T>(args: CompleteJsonArgs): Promise<T> {
    const cfg = resolveConfig();
    const system = `${args.system}\n\nRespond with a single JSON object named "${args.schemaName}". No prose, no code fences.`;
    const res = await fetch(cfg.baseUrl!, {
      method: "POST",
      headers: buildHeaders(cfg),
      body: JSON.stringify({
        model: args.model,
        max_tokens: cfg.maxTokens,
        system,
        messages: [{ role: "user", content: args.user }],
      }),
    });
    if (!res.ok) {
      throw new Error(`anthropic completeJson (${args.schemaName}) failed: ${res.status} ${await res.text()}`);
    }
    const data = (await res.json()) as { content?: Array<{ type: string; text?: string }> };
    const text = data.content?.find((b) => b.type === "text")?.text;
    if (!text) throw new Error(`anthropic completeJson (${args.schemaName}) returned no text`);
    return JSON.parse(extractJson(text)) as T;
  },

  stream(args: StreamArgs): AIStream {
    const cfg = resolveConfig();
    const systems = args.messages.filter((m) => m.role === "system").map((m) => m.content);
    const turns = args.messages
      .filter((m) => m.role !== "system")
      .map((m) => ({ role: m.role, content: m.content }));

    return {
      [Symbol.asyncIterator]() {
        let reader: ReadableStreamDefaultReader<Uint8Array> | null = null;
        const decoder = new TextDecoder();
        let buffer = "";
        let done = false;

        const ensureReader = async () => {
          if (reader) return reader;
          const res = await fetch(cfg.baseUrl!, {
            method: "POST",
            headers: buildHeaders(cfg),
            body: JSON.stringify({
              model: args.model,
              max_tokens: cfg.maxTokens,
              stream: true,
              system: systems.join("\n\n") || undefined,
              messages: turns,
            }),
            signal: args.signal,
          });
          if (!res.ok || !res.body) {
            throw new Error(`anthropic stream failed: ${res.status} ${await res.text()}`);
          }
          reader = res.body.getReader();
          return reader;
        };

        return {
          async next(): Promise<IteratorResult<string>> {
            if (done) return { value: "", done: true };
            const r = await ensureReader();
            // eslint-disable-next-line no-constant-condition
            while (true) {
              const sep = buffer.indexOf("\n\n");
              if (sep !== -1) {
                const frame = buffer.slice(0, sep);
                buffer = buffer.slice(sep + 2);
                for (const line of frame.split("\n")) {
                  if (!line.startsWith("data:")) continue;
                  const data = line.slice(5).trim();
                  if (!data) continue;
                  try {
                    const evt = JSON.parse(data) as {
                      type?: string;
                      delta?: { type?: string; text?: string };
                    };
                    if (evt.type === "content_block_delta" && evt.delta?.type === "text_delta" && evt.delta.text) {
                      return { value: evt.delta.text, done: false };
                    }
                    if (evt.type === "message_stop") {
                      done = true;
                      return { value: "", done: true };
                    }
                  } catch {
                    // ignore malformed heartbeat frames
                  }
                }
                continue;
              }
              const chunk = await r.read();
              if (chunk.done) {
                done = true;
                return { value: "", done: true };
              }
              buffer += decoder.decode(chunk.value, { stream: true });
            }
          },
        };
      },
    };
  },
};
