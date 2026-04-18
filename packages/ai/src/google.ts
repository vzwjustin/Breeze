import type { AIProvider, CompleteJsonArgs, StreamArgs } from "./index.js";

export const googleProvider: AIProvider = {
  kind: "google",
  async completeJson<T>(_args: CompleteJsonArgs): Promise<T> {
    throw new Error("googleProvider.completeJson not implemented");
  },
  stream(_args: StreamArgs) {
    throw new Error("googleProvider.stream not implemented");
  },
};
