import type { AIProvider, AIMessage, AIStream, CompleteJsonArgs, StreamArgs } from "./index.js";

declare const process: { env: Record<string, string | undefined> };

const DEFAULT_BASE = "https://generativelanguage.googleapis.com/v1beta";

interface GoogleConfig {
  apiKey?: string;
  baseUrl: string;
}

function resolveConfig(): GoogleConfig {
  return {
    apiKey: process.env.GOOGLE_API_KEY ?? process.env.GEMINI_API_KEY,
    baseUrl: process.env.GOOGLE_BASE_URL ?? DEFAULT_BASE,
  };
}

function requireKey(cfg: GoogleConfig): string {
  if (!cfg.apiKey) throw new Error("GOOGLE_API_KEY is not set");
  return cfg.apiKey;
}

function extractJson(text: string): string {
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence?.[1]) return fence[1].trim();
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start !== -1 && end > start) return text.slice(start, end + 1);
  return text.trim();
}

function toContents(messages: AIMessage[]) {
  return messages
    .filter((m) => m.role !== "system")
    .map((m) => ({
      role: m.role === "assistant" ? "model" : "user",
      parts: [{ text: m.content }],
    }));
}

function systemInstruction(messages: AIMessage[]) {
  const sys = messages.filter((m) => m.role === "system").map((m) => m.content).join("\n\n");
  return sys ? { parts: [{ text: sys }] } : undefined;
}

export const googleProvider: AIProvider = {
  kind: "google",

  async completeJson<T>(args: CompleteJsonArgs): Promise<T> {
    const cfg = resolveConfig();
    const url = `${cfg.baseUrl}/models/${encodeURIComponent(args.model)}:generateContent?key=${encodeURIComponent(requireKey(cfg))}`;
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: args.system }] },
        generationConfig: { responseMimeType: "application/json" },
        contents: [{ role: "user", parts: [{ text: args.user }] }],
      }),
    });
    if (!res.ok) {
      throw new Error(`google completeJson (${args.schemaName}) failed: ${res.status} ${await res.text()}`);
    }
    const data = (await res.json()) as {
      candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
    };
    const text = data.candidates?.[0]?.content?.parts?.map((p) => p.text ?? "").join("");
    if (!text) throw new Error(`google completeJson (${args.schemaName}) returned no text`);
    return JSON.parse(extractJson(text)) as T;
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
          const url = `${cfg.baseUrl}/models/${encodeURIComponent(args.model)}:streamGenerateContent?alt=sse&key=${encodeURIComponent(requireKey(cfg))}`;
          const res = await fetch(url, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              systemInstruction: systemInstruction(args.messages),
              contents: toContents(args.messages),
            }),
            signal: args.signal,
          });
          if (!res.ok || !res.body) {
            throw new Error(`google stream failed: ${res.status} ${await res.text()}`);
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
                    const parsed = JSON.parse(data) as {
                      candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
                    };
                    const text = parsed.candidates?.[0]?.content?.parts?.map((p) => p.text ?? "").join("");
                    if (text) return { value: text, done: false };
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
