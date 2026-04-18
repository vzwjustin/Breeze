import type { AIProvider, CompleteJsonArgs, StreamArgs } from "./index.js";

export const openrouterProvider: AIProvider = {
  kind: "openrouter",
  async completeJson<T>(_args: CompleteJsonArgs): Promise<T> {
    throw new Error("openrouterProvider.completeJson not implemented");
  },
  stream(_args: StreamArgs) {
    throw new Error("openrouterProvider.stream not implemented");
  },
};
