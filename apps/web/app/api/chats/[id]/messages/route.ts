/**
 * POST /api/chats/:id/messages — starts a chat turn.
 *
 * Streams Server-Sent Events as the turn progresses:
 *   turn.started → plan.created → step.started → step.completed
 *     → approval.requested (optional) → turn.completed | turn.error
 */
import { NextRequest } from "next/server";
import { PostMessageSchema } from "@breeze/common";
import { ChatService } from "@/server/services/chat-service";
import { ChatTurn } from "@/server/services/chat-turn";
import { requireUser } from "@/server/auth/require-user";
import { sseResponse } from "@/server/events/sse";

export const runtime = "nodejs";

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const { user } = await requireUser();
  const body = PostMessageSchema.parse(await req.json());

  const chat = await ChatService.getOwned(params.id, user.id);
  const userMessage = await ChatService.appendUserMessage(chat.id, body);

  const { stream, write, close, error } = sseResponse();

  ChatTurn.run({ user, chat, userMessage, write, close }).catch((err) => error(err));

  return stream;
}
