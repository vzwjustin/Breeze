/**
 * POST /api/chats/:id/messages — starts a chat turn.
 *
 * Streams Server-Sent Events as the turn progresses:
 *   turn.started → plan.created → step.started → step.completed
 *     → approval.requested (optional) → turn.completed | turn.error
 */
import { NextRequest, NextResponse } from "next/server";
import { PostMessageSchema, isBreezeError } from "@breeze/common";
import { ChatService } from "@/server/services/chat-service";
import { ChatTurn } from "@/server/services/chat-turn";
import { requireUser } from "@/server/auth/require-user";
import { sseResponse } from "@/server/events/sse";
import { enforceRateLimit } from "@/server/rate-limit";

export const runtime = "nodejs";

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const { user } = await requireUser();

  try {
    await enforceRateLimit(user.id, "chat.message", { capacity: 20, refillPerSec: 0.1 });
  } catch (err) {
    if (isBreezeError(err) && err.code === "rate_limit") {
      const retryAfterMs = (err.details?.retryAfterMs as number | undefined) ?? 0;
      return NextResponse.json(
        { error: err.message },
        { status: 429, headers: { "Retry-After": String(Math.ceil(retryAfterMs / 1000)) } }
      );
    }
    throw err;
  }

  const lastEventId = req.headers.get("last-event-id") ?? undefined;
  const body = PostMessageSchema.parse(await req.json());

  const chat = await ChatService.getOwned(params.id, user.id);
  const userMessage = await ChatService.appendUserMessage(chat.id, body);

  const { stream, write, close, error, signal } = sseResponse({ lastEventId });

  ChatTurn.run({ user, chat, userMessage, write, close, signal }).catch((err) => error(err));

  return stream;
}
