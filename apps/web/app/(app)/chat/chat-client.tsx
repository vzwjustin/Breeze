"use client";

import { useState, useRef, useEffect, useCallback } from "react";

interface Message {
  id: string;
  role: "user" | "assistant" | "system";
  content: string;
  createdAt: string;
}

interface TurnEvent {
  type: string;
  [key: string]: unknown;
}

interface ChatClientProps {
  chatId: string;
  initialMessages: Message[];
}

export function ChatClient({ chatId, initialMessages }: ChatClientProps) {
  const [messages, setMessages] = useState<Message[]>(initialMessages);
  const [input, setInput] = useState("");
  const [isStreaming, setIsStreaming] = useState(false);
  const [streamEvents, setStreamEvents] = useState<TurnEvent[]>([]);
  const [error, setError] = useState<string | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const lastEventIdRef = useRef<string | undefined>(undefined);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, streamEvents]);

  const autoResize = useCallback(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 200)}px`;
  }, []);

  const sendMessage = useCallback(async () => {
    const text = input.trim();
    if (!text || isStreaming) return;

    setInput("");
    setError(null);
    setStreamEvents([]);
    if (textareaRef.current) textareaRef.current.style.height = "auto";

    const optimisticId = `opt-${Date.now()}`;
    setMessages((prev) => [
      ...prev,
      {
        id: optimisticId,
        role: "user",
        content: text,
        createdAt: new Date().toISOString(),
      },
    ]);

    setIsStreaming(true);
    abortRef.current = new AbortController();

    try {
      const headers: Record<string, string> = { "Content-Type": "application/json" };
      if (lastEventIdRef.current) headers["Last-Event-ID"] = lastEventIdRef.current;

      const res = await fetch(`/api/chats/${chatId}/messages`, {
        method: "POST",
        headers,
        body: JSON.stringify({ content: text }),
        signal: abortRef.current.signal,
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error((data as any).error ?? `Request failed: ${res.status}`);
      }

      const reader = res.body?.getReader();
      if (!reader) throw new Error("No response body");

      const decoder = new TextDecoder();
      let buffer = "";
      let assistantText = "";

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        let sep: number;
        while ((sep = buffer.indexOf("\n\n")) !== -1) {
          const frame = buffer.slice(0, sep);
          buffer = buffer.slice(sep + 2);

          let eventId: string | undefined;
          let dataLine = "";

          for (const line of frame.split("\n")) {
            if (line.startsWith("id:")) eventId = line.slice(3).trim();
            else if (line.startsWith("data:")) dataLine = line.slice(5).trim();
          }

          if (eventId) lastEventIdRef.current = eventId;
          if (!dataLine) continue;

          try {
            const event = JSON.parse(dataLine) as TurnEvent;
            setStreamEvents((prev) => [...prev, event]);

            if (event.type === "turn.completed" || event.type === "turn.paused") {
              if (assistantText) {
                setMessages((prev) => [
                  ...prev,
                  {
                    id: `asst-${Date.now()}`,
                    role: "assistant",
                    content: assistantText,
                    createdAt: new Date().toISOString(),
                  },
                ]);
              }
            }
          } catch {
            // ignore parse errors
          }
        }
      }
    } catch (err) {
      if ((err as Error).name === "AbortError") return;
      setError((err as Error).message);
    } finally {
      setIsStreaming(false);
      setStreamEvents([]);
    }
  }, [input, isStreaming, chatId]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  };

  const stopStream = () => {
    abortRef.current?.abort();
    setIsStreaming(false);
    setStreamEvents([]);
  };

  const activeEvent = streamEvents[streamEvents.length - 1];

  return (
    <div style={{
      display: "flex",
      flexDirection: "column",
      height: "100vh",
      background: "var(--color-surface)",
    }}>
      <div style={{
        flex: 1,
        overflow: "auto",
        padding: "24px 0",
      }}>
        <div style={{ maxWidth: 720, margin: "0 auto", padding: "0 24px" }}>
          {messages.length === 0 && !isStreaming && (
            <div style={{ textAlign: "center", paddingTop: 80 }}>
              <div style={{
                width: 56,
                height: 56,
                background: "var(--color-primary-light)",
                borderRadius: "var(--radius-lg)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                margin: "0 auto 20px",
              }}>
                <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="var(--color-primary)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
                </svg>
              </div>
              <h2 style={{ fontSize: 20, fontWeight: 600, color: "var(--color-text)", marginBottom: 8 }}>
                Start a conversation
              </h2>
              <p style={{ color: "var(--color-text-muted)", fontSize: 14, maxWidth: 400, margin: "0 auto" }}>
                Ask Breeze to check your email, schedule events, draft replies, or automate workflows.
              </p>
            </div>
          )}

          {messages.map((msg) => (
            <MessageBubble key={msg.id} message={msg} />
          ))}

          {isStreaming && activeEvent && (
            <StreamingIndicator event={activeEvent} />
          )}

          {error && (
            <div style={{
              margin: "12px 0",
              padding: "12px 16px",
              background: "var(--color-error-light)",
              border: "1px solid var(--color-error-muted)",
              borderRadius: "var(--radius-md)",
              color: "var(--color-error)",
              fontSize: 14,
            }}>
              {error}
            </div>
          )}

          <div ref={bottomRef} />
        </div>
      </div>

      <div style={{
        borderTop: "1px solid var(--color-border)",
        padding: "16px 24px",
        background: "var(--color-surface)",
      }}>
        <div style={{ maxWidth: 720, margin: "0 auto" }}>
          <div style={{
            display: "flex",
            gap: 12,
            alignItems: "flex-end",
            background: "var(--color-surface-muted)",
            border: "1px solid var(--color-border)",
            borderRadius: "var(--radius-lg)",
            padding: "12px 16px",
            transition: "border-color var(--transition-fast)",
          }}>
            <textarea
              ref={textareaRef}
              value={input}
              onChange={(e) => { setInput(e.target.value); autoResize(); }}
              onKeyDown={handleKeyDown}
              placeholder="Message Breeze..."
              disabled={isStreaming}
              rows={1}
              style={{
                flex: 1,
                border: "none",
                background: "transparent",
                resize: "none",
                fontSize: 14,
                lineHeight: 1.6,
                color: "var(--color-text)",
                outline: "none",
                maxHeight: 200,
                fontFamily: "inherit",
              }}
            />
            {isStreaming ? (
              <button
                onClick={stopStream}
                style={{
                  width: 36,
                  height: 36,
                  borderRadius: "var(--radius-md)",
                  border: "none",
                  background: "var(--color-error)",
                  color: "white",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  flexShrink: 0,
                  cursor: "pointer",
                }}
                aria-label="Stop"
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
                  <rect x="4" y="4" width="16" height="16" rx="2"/>
                </svg>
              </button>
            ) : (
              <button
                onClick={sendMessage}
                disabled={!input.trim()}
                style={{
                  width: 36,
                  height: 36,
                  borderRadius: "var(--radius-md)",
                  border: "none",
                  background: input.trim() ? "var(--color-primary)" : "var(--color-border)",
                  color: input.trim() ? "white" : "var(--color-text-faint)",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  flexShrink: 0,
                  cursor: input.trim() ? "pointer" : "default",
                  transition: "background var(--transition-fast)",
                }}
                aria-label="Send"
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="m22 2-7 20-4-9-9-4 20-7z"/>
                  <path d="M22 2 11 13"/>
                </svg>
              </button>
            )}
          </div>
          <p style={{ fontSize: 12, color: "var(--color-text-faint)", marginTop: 8, textAlign: "center" }}>
            Enter to send, Shift+Enter for new line
          </p>
        </div>
      </div>
    </div>
  );
}

function MessageBubble({ message }: { message: Message }) {
  const isUser = message.role === "user";

  return (
    <div style={{
      display: "flex",
      justifyContent: isUser ? "flex-end" : "flex-start",
      marginBottom: 16,
      animationName: "fadeIn",
      animationDuration: "200ms",
      animationFillMode: "forwards",
    }}>
      {!isUser && (
        <div style={{
          width: 32,
          height: 32,
          borderRadius: "var(--radius-md)",
          background: "var(--color-primary)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          flexShrink: 0,
          marginRight: 10,
          marginTop: 2,
        }}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2z"/>
            <path d="M12 6v6l4 2"/>
          </svg>
        </div>
      )}

      <div style={{
        maxWidth: "75%",
        padding: "10px 14px",
        borderRadius: isUser ? "var(--radius-lg) var(--radius-lg) var(--radius-sm) var(--radius-lg)" : "var(--radius-lg) var(--radius-lg) var(--radius-lg) var(--radius-sm)",
        background: isUser ? "var(--color-primary)" : "var(--color-surface-elevated)",
        color: isUser ? "white" : "var(--color-text)",
        fontSize: 14,
        lineHeight: 1.6,
        whiteSpace: "pre-wrap",
        wordBreak: "break-word",
      }}>
        {message.content}
      </div>
    </div>
  );
}

function StreamingIndicator({ event }: { event: TurnEvent }) {
  const label = {
    "turn.started": "Thinking...",
    "plan.created": "Planning...",
    "step.started": `Running: ${String(event.kind ?? "")}`,
    "step.completed": "Step done",
    "approval.requested": "Waiting for your approval",
    "turn.paused": "Paused — approval needed",
    "turn.completed": "Done",
  }[event.type] ?? event.type;

  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 16, paddingLeft: 42 }}>
      <div style={{
        width: 8,
        height: 8,
        borderRadius: "var(--radius-full)",
        background: "var(--color-primary)",
        animationName: "pulse",
        animationDuration: "1.5s",
        animationIterationCount: "infinite",
      }} />
      <span style={{ fontSize: 13, color: "var(--color-text-muted)" }}>{label}</span>
    </div>
  );
}
