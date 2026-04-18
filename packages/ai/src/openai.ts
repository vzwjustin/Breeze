import type { AIProvider, CompleteJsonArgs, StreamArgs } from "./index.js";

export const openaiProvider: AIProvider = {
  kind: "openai",
  async completeJson<T>(_args: CompleteJsonArgs): Promise<T> {
    throw new Error("openaiProvider.completeJson not implemented");
  },
  stream(_args: StreamArgs) {
    throw new Error("openaiProvider.stream not implemented");
  },
};
