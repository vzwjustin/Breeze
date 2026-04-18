import type { AIProvider, CompleteJsonArgs, StreamArgs } from "./index.js";

export const anthropicProvider: AIProvider = {
  kind: "anthropic",
  async completeJson<T>(_args: CompleteJsonArgs): Promise<T> {
    throw new Error("anthropicProvider.completeJson not implemented");
  },
  stream(_args: StreamArgs) {
    throw new Error("anthropicProvider.stream not implemented");
  },
};
