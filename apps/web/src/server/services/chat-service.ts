import { prisma } from "@breeze/db";
import { publicCatalog } from "@breeze/connectors";
import {
  BreezeError,
  type MemoryRecord,
  type PostMessageInput,
} from "@breeze/common";

export interface ChatRow {
  id: string;
  userId: string;
  title: string;
  summary?: string;
}

export interface MessageRow {
  id: string;
  chatId: string;
  role: "USER" | "ASSISTANT" | "SYSTEM" | "TOOL";
  content: unknown;
}

export interface ChatContext {
  userId: string;
  chatId: string;
  messageId: string;
  model: string;
  history: Array<{ role: "user" | "assistant" | "system"; content: string }>;
  memoryPack: MemoryRecord[];
  catalog: ReturnType<typeof publicCatalog>;
  originatingKind: "chat" | "task";
}

/**
 * Thin data layer for chats + messages. Every method scopes queries by the
 * owning user id so a leaked chat id cannot be read by another user.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = prisma as any;

function mapRole(role: string): MessageRow["role"] {
  const r = role.toUpperCase();
  return r === "ASSISTANT" || r === "SYSTEM" || r === "TOOL" ? (r as MessageRow["role"]) : "USER";
}

export const ChatService = {
  async getOwned(id: string, userId: string): Promise<ChatRow> {
    const row = await db.chat.findFirst({
      where: { id, userId, deletedAt: null },
      select: { id: true, userId: true, title: true, summary: true },
    });
    if (!row) throw new BreezeError("not_found", "Chat not found");
    return { id: row.id, userId: row.userId, title: row.title, summary: row.summary ?? undefined };
  },

  async appendUserMessage(chatId: string, body: PostMessageInput): Promise<MessageRow> {
    const row = await db.message.create({
      data: {
        chatId,
        role: "USER",
        content: {
          text: body.content,
          attachments: body.attachments ?? [],
        },
      },
      select: { id: true, chatId: true, role: true, content: true },
    });
    await db.chat.update({ where: { id: chatId }, data: { updatedAt: new Date() } });
    return { id: row.id, chatId: row.chatId, role: mapRole(row.role), content: row.content };
  },

  async appendAssistantMessage(chatId: string, content: unknown, tokens?: number): Promise<MessageRow> {
    const row = await db.message.create({
      data: { chatId, role: "ASSISTANT", content, tokens: tokens ?? null },
      select: { id: true, chatId: true, role: true, content: true },
    });
    return { id: row.id, chatId: row.chatId, role: mapRole(row.role), content: row.content };
  },

  async buildContext(chat: ChatRow, userId: string): Promise<ChatContext> {
    const [messages, memories, accounts, user] = await Promise.all([
      db.message.findMany({
        where: { chatId: chat.id },
        orderBy: { createdAt: "desc" },
        take: 20,
        select: { id: true, role: true, content: true },
      }),
      db.memory.findMany({
        where: { userId, OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }] },
        orderBy: { updatedAt: "desc" },
        take: 50,
      }),
      db.connectorAccount.findMany({
        where: { userId, status: "ACTIVE" },
        select: { connectorKey: true },
      }),
      db.user.findUnique({ where: { id: userId }, select: { id: true } }),
    ]);
    if (!user) throw new BreezeError("not_found", "User not found");

    const latestMessage = messages[0];
    if (!latestMessage) throw new BreezeError("validation", "Chat has no messages");

    const history = [...messages]
      .reverse()
      .map((m: { role: string; content: unknown }) => ({
        role: mapRole(m.role).toLowerCase() as "user" | "assistant" | "system",
        content: extractText(m.content),
      }));

    const memoryPack: MemoryRecord[] = memories.map((m: Record<string, unknown>) => ({
      id: String(m.id),
      userId: String(m.userId),
      type: String(m.type).toLowerCase() as MemoryRecord["type"],
      scope: m.scope ? String(m.scope) : undefined,
      key: String(m.key),
      value: m.value,
      source: (m.source as MemoryRecord["source"]) ?? { kind: "system" },
      reason: String(m.reason ?? ""),
      visibility: String(m.visibility).toLowerCase() as MemoryRecord["visibility"],
      expiresAt: m.expiresAt ? new Date(m.expiresAt as string).toISOString() : undefined,
      createdAt: new Date(m.createdAt as string).toISOString(),
      updatedAt: new Date(m.updatedAt as string).toISOString(),
    }));

    const connected = new Set<string>(accounts.map((a: { connectorKey: string }) => a.connectorKey));

    return {
      userId,
      chatId: chat.id,
      messageId: latestMessage.id,
      model: process.env.BREEZE_PLANNER_MODEL ?? "claude-sonnet-4-6",
      history,
      memoryPack,
      catalog: publicCatalog(connected),
      originatingKind: "chat",
    };
  },

  async recordStepResult(stepId: string, result: unknown): Promise<void> {
    const isError = result instanceof Error;
    await db.planStep.update({
      where: { id: stepId },
      data: {
        status: isError ? "FAILED" : "COMPLETED",
        output: isError ? null : (result as object),
        errorMessage: isError ? (result as Error).message : null,
        endedAt: new Date(),
      },
    });
  },
};

function extractText(content: unknown): string {
  if (typeof content === "string") return content;
  if (content && typeof content === "object" && "text" in content) {
    const text = (content as { text?: unknown }).text;
    if (typeof text === "string") return text;
  }
  return JSON.stringify(content ?? "");
}
