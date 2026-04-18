import type { AIProvider, AIStream, CompleteJsonArgs, StreamArgs } from "./index.js";

// ── Tool use types ────────────────────────────────────────────────────────────

export interface ToolSpec {
  name: string;
  description: string;
  input_schema: {
    type: "object";
    properties: Record<string, unknown>;
    required?: string[];
  };
}

export interface StreamCompleteArgs {
  model: string;
  system?: string;
  user: string;
  tools?: ToolSpec[];
  toolChoice?: "auto" | "any" | { type: "tool"; name: string };
  signal?: AbortSignal;
}

export type StreamCompleteEvent =
  | { type: "delta"; text: string }
  | { type: "done"; usage: { input_tokens: number; output_tokens: number } };

export interface ToolUseBlock {
  type: "tool_use";
  id: string;
  name: string;
  input: Record<string, unknown>;
}

export interface CompleteWithToolsArgs {
  model: string;
  system?: string;
  user: string;
  tools: ToolSpec[];
  toolChoice?: "auto" | "any" | { type: "tool"; name: string };
}

export interface CompleteWithToolsResult {
  stopReason: string;
  text?: string;
  toolUseBlocks: ToolUseBlock[];
}

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
    "anthropic-beta": "prompt-caching-2024-07-31",
  };
}

/**
 * Returns a system prompt in the caching block format when it exceeds 1024
 * characters (large enough to benefit from caching), or as a plain string
 * otherwise. Pass `undefined` to omit the system field entirely.
 */
function buildSystemParam(
  systemText: string | undefined,
): Array<{ type: "text"; text: string; cache_control: { type: "ephemeral" } }> | string | undefined {
  if (!systemText) return undefined;
  if (systemText.length > 1024) {
    return [{ type: "text", text: systemText, cache_control: { type: "ephemeral" } }];
  }
  return systemText;
}

function extractJson(text: string): string {
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence?.[1]) return fence[1].trim();
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start !== -1 && end > start) return text.slice(start, end + 1);
  return text.trim();
}

// ── completeWithTools ─────────────────────────────────────────────────────────

export async function completeWithTools(args: CompleteWithToolsArgs): Promise<CompleteWithToolsResult> {
  const cfg = resolveConfig();
  const body: Record<string, unknown> = {
    model: args.model,
    max_tokens: cfg.maxTokens,
    messages: [{ role: "user", content: args.user }],
    tools: args.tools,
  };
  if (args.system) body.system = buildSystemParam(args.system);
  if (args.toolChoice) body.tool_choice = args.toolChoice;

  const res = await fetch(cfg.baseUrl!, {
    method: "POST",
    headers: buildHeaders(cfg),
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    throw new Error(`anthropic completeWithTools failed: ${res.status} ${await res.text()}`);
  }

  const data = (await res.json()) as {
    stop_reason?: string;
    content?: Array<{ type: string; text?: string; id?: string; name?: string; input?: Record<string, unknown> }>;
  };

  const toolUseBlocks: ToolUseBlock[] = (data.content ?? [])
    .filter((b) => b.type === "tool_use")
    .map((b) => ({
      type: "tool_use" as const,
      id: b.id!,
      name: b.name!,
      input: b.input ?? {},
    }));

  const text = data.content?.find((b) => b.type === "text")?.text;

  return {
    stopReason: data.stop_reason ?? "end_turn",
    text,
    toolUseBlocks,
  };
}

// ── streamComplete ────────────────────────────────────────────────────────────

export async function* streamComplete(args: StreamCompleteArgs): AsyncIterable<StreamCompleteEvent> {
  const cfg = resolveConfig();
  const body: Record<string, unknown> = {
    model: args.model,
    max_tokens: cfg.maxTokens,
    stream: true,
    messages: [{ role: "user", content: args.user }],
  };
  if (args.system) body.system = buildSystemParam(args.system);
  if (args.tools) body.tools = args.tools;
  if (args.toolChoice) body.tool_choice = args.toolChoice;

  const res = await fetch(cfg.baseUrl!, {
    method: "POST",
    headers: { ...buildHeaders(cfg), Accept: "text/event-stream" },
    body: JSON.stringify(body),
    signal: args.signal,
  });
  if (!res.ok || !res.body) {
    throw new Error(`anthropic streamComplete failed: ${res.status} ${await res.text()}`);
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let usage = { input_tokens: 0, output_tokens: 0 };

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    let sep: number;
    while ((sep = buffer.indexOf("\n\n")) !== -1) {
      const frame = buffer.slice(0, sep);
      buffer = buffer.slice(sep + 2);

      for (const line of frame.split("\n")) {
        if (!line.startsWith("data:")) continue;
        const raw = line.slice(5).trim();
        if (!raw) continue;
        try {
          const evt = JSON.parse(raw) as {
            type?: string;
            delta?: { type?: string; text?: string };
            message?: { usage?: { input_tokens: number; output_tokens: number } };
            usage?: { output_tokens: number };
          };

          if (evt.type === "message_start" && evt.message?.usage) {
            usage = { ...usage, ...evt.message.usage };
          }
          if (evt.type === "message_delta" && evt.usage?.output_tokens !== undefined) {
            usage = { ...usage, output_tokens: evt.usage.output_tokens };
          }
          if (
            evt.type === "content_block_delta" &&
            evt.delta?.type === "text_delta" &&
            evt.delta.text
          ) {
            yield { type: "delta", text: evt.delta.text };
          }
          if (evt.type === "message_stop") {
            yield { type: "done", usage };
            return;
          }
        } catch {
          // ignore malformed frames
        }
      }
    }
  }

  yield { type: "done", usage };
}

// ── AIProvider implementation ─────────────────────────────────────────────────

export const anthropicProvider: AIProvider = {
  kind: "anthropic",

  async completeJson<T>(args: CompleteJsonArgs): Promise<T> {
    const cfg = resolveConfig();
    const systemText = `${args.system}\n\nRespond with a single JSON object named "${args.schemaName}". No prose, no code fences.`;
    const res = await fetch(cfg.baseUrl!, {
      method: "POST",
      headers: buildHeaders(cfg),
      body: JSON.stringify({
        model: args.model,
        max_tokens: cfg.maxTokens,
        system: buildSystemParam(systemText),
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
              system: buildSystemParam(systems.join("\n\n") || undefined),
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
