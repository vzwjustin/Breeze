import { redirect } from "next/navigation";
import { requireUser } from "@/server/auth/require-user";
import { prisma } from "@breeze/db";

const db = prisma as any;

export default async function NewChatPage() {
  const { user } = await requireUser();

  const chat = await db.chat.create({
    data: { userId: user.id, title: "New chat" },
    select: { id: true },
  });

  redirect(`/chat/${chat.id}`);
}
