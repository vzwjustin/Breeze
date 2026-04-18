/**
 * Minimal SSE helper. Real version adds heartbeat, last-event-id, and
 * client reconnection.
 */
export interface SSEWriter {
  stream: Response;
  write: (event: unknown) => void;
  close: () => void;
  error: (err: unknown) => void;
}

export function sseResponse(): SSEWriter {
  const encoder = new TextEncoder();
  let controller!: ReadableStreamDefaultController<Uint8Array>;
  const body = new ReadableStream<Uint8Array>({
    start(c) { controller = c; },
  });

  const write = (event: unknown) => {
    controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
  };
  const close = () => { controller.close(); };
  const error = (err: unknown) => {
    try {
      controller.enqueue(
        encoder.encode(
          `event: error\ndata: ${JSON.stringify({ message: (err as Error)?.message ?? String(err) })}\n\n`
        )
      );
      controller.close();
    } catch {}
  };

  const stream = new Response(body, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      "Connection": "keep-alive",
    },
  });

  return { stream, write, close, error };
}
