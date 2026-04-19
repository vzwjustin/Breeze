import { notFound } from "next/navigation";
import { requireUser } from "@/server/auth/require-user";
import { prisma } from "@breeze/db";
import { ChatClient } from "../chat-client";

const db = prisma as any;

interface Props {
  params: { id: string };
}

export default async function ChatPage({ params }: Props) {
  const { user } = await requireUser();

  const chat = await db.chat.findFirst({
    where: { id: params.id, userId: user.id, deletedAt: null },
    select: { id: true, title: true },
  });

  if (!chat) notFound();

  const messages = await db.message.findMany({
    where: { chatId: chat.id },
    orderBy: { createdAt: "asc" },
    take: 100,
    select: { id: true, role: true, content: true, createdAt: true },
  });

  const initialMessages = messages.map((m: any) => ({
    id: m.id,
    role: m.role.toLowerCase() as "user" | "assistant" | "system",
    content: extractText(m.content),
    createdAt: m.createdAt.toISOString(),
  }));

  return <ChatClient chatId={chat.id} initialMessages={initialMessages} />;
}

function extractText(content: unknown): string {
  if (typeof content === "string") return content;
  if (content && typeof content === "object" && "text" in content) {
    const t = (content as { text?: unknown }).text;
    if (typeof t === "string") return t;
  }
  return JSON.stringify(content ?? "");
}
