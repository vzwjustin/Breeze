/**
 * SSE helper with heartbeat, last-event-id awareness, and abort signal.
 */
export interface SSEOptions {
  lastEventId?: string;
  heartbeatMs?: number;
}

export interface SSEWriter {
  stream: Response;
  write: (event: unknown) => void;
  close: () => void;
  error: (err: unknown) => void;
  signal: AbortSignal;
}

export function sseResponse(opts: SSEOptions = {}): SSEWriter {
  const heartbeatMs = opts.heartbeatMs ?? 15000;
  const encoder = new TextEncoder();
  const abortController = new AbortController();
  let controller!: ReadableStreamDefaultController<Uint8Array>;
  let eventId = 0;
  let heartbeat: ReturnType<typeof setInterval> | null = null;

  const stopHeartbeat = () => {
    if (heartbeat) { clearInterval(heartbeat); heartbeat = null; }
  };

  const body = new ReadableStream<Uint8Array>({
    start(c) {
      controller = c;
      heartbeat = setInterval(() => {
        if (abortController.signal.aborted) { stopHeartbeat(); return; }
        try { controller.enqueue(encoder.encode(`: keepalive\n\n`)); }
        catch { abortController.abort(); stopHeartbeat(); }
      }, heartbeatMs);
    },
    cancel() {
      abortController.abort();
      stopHeartbeat();
    },
  });

  const write = (event: unknown) => {
    if (abortController.signal.aborted) return;
    const id = ++eventId;
    try {
      controller.enqueue(encoder.encode(`id: ${id}\ndata: ${JSON.stringify(event)}\n\n`));
    } catch {
      abortController.abort();
      stopHeartbeat();
    }
  };
  const close = () => {
    stopHeartbeat();
    try { controller.close(); } catch {}
  };
  const error = (err: unknown) => {
    stopHeartbeat();
    try {
      controller.enqueue(
        encoder.encode(
          `event: error\ndata: ${JSON.stringify({ message: (err as Error)?.message ?? String(err) })}\n\n`
        )
      );
      controller.close();
    } catch {}
  };

  const headers: Record<string, string> = {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache, no-transform",
    "Connection": "keep-alive",
  };
  if (opts.lastEventId) headers["Last-Event-ID"] = opts.lastEventId;

  const stream = new Response(body, { headers });
  return { stream, write, close, error, signal: abortController.signal };
}
