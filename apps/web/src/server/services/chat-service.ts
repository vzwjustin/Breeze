import type { PostMessageInput } from "@breeze/common";

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

export const ChatService = {
  async getOwned(_id: string, _userId: string): Promise<ChatRow> {
    throw new Error("ChatService.getOwned not implemented (wire to prisma.chat.findFirst)");
  },

  async appendUserMessage(_chatId: string, _body: PostMessageInput): Promise<MessageRow> {
    throw new Error("ChatService.appendUserMessage not implemented");
  },

  async buildContext(_chat: ChatRow, _userId: string) {
    throw new Error("ChatService.buildContext not implemented");
  },

  async recordStepResult(_stepId: string, _result: unknown): Promise<void> {
    throw new Error("ChatService.recordStepResult not implemented");
  },
};
