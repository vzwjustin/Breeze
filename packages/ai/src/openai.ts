import type { AIProvider, AIStream, CompleteJsonArgs, StreamArgs } from "./index.js";

declare const process: { env: Record<string, string | undefined> };

const DEFAULT_ENDPOINT = "https://api.openai.com/v1/chat/completions";

interface OpenAIConfig {
  apiKey?: string;
  baseUrl?: string;
  organization?: string;
}

function resolveConfig(): OpenAIConfig {
  return {
    apiKey: process.env.OPENAI_API_KEY,
    baseUrl: process.env.OPENAI_BASE_URL ?? DEFAULT_ENDPOINT,
    organization: process.env.OPENAI_ORGANIZATION,
  };
}

function buildHeaders(cfg: OpenAIConfig): Record<string, string> {
  if (!cfg.apiKey) {
    throw new Error("OPENAI_API_KEY is not set");
  }
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Authorization: `Bearer ${cfg.apiKey}`,
  };
  if (cfg.organization) headers["OpenAI-Organization"] = cfg.organization;
  return headers;
}

export const openaiProvider: AIProvider = {
  kind: "openai",

  async completeJson<T>(args: CompleteJsonArgs): Promise<T> {
    const cfg = resolveConfig();
    const res = await fetch(cfg.baseUrl!, {
      method: "POST",
      headers: buildHeaders(cfg),
      body: JSON.stringify({
        model: args.model,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: args.system },
          { role: "user", content: args.user },
        ],
      }),
    });
    if (!res.ok) {
      throw new Error(`openai completeJson (${args.schemaName}) failed: ${res.status} ${await res.text()}`);
    }
    const data = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> };
    const content = data.choices?.[0]?.message?.content;
    if (!content) throw new Error(`openai completeJson (${args.schemaName}) returned empty content`);
    return JSON.parse(content) as T;
  },

  stream(args: StreamArgs): AIStream {
    const cfg = resolveConfig();
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
              stream: true,
              messages: args.messages,
            }),
            signal: args.signal,
          });
          if (!res.ok || !res.body) {
            throw new Error(`openai stream failed: ${res.status} ${await res.text()}`);
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
                  if (data === "[DONE]") {
                    done = true;
                    return { value: "", done: true };
                  }
                  try {
                    const parsed = JSON.parse(data) as {
                      choices?: Array<{ delta?: { content?: string } }>;
                    };
                    const delta = parsed.choices?.[0]?.delta?.content;
                    if (delta) return { value: delta, done: false };
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
