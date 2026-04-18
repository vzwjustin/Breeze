import { createLogger, type Logger } from "@breeze/common";

export function getRequestId(req: Request): string {
  const header = req.headers.get("x-request-id");
  return header && header.trim() !== "" ? header.trim() : crypto.randomUUID();
}

export function withRequestLogger(req: Request): { requestId: string; logger: Logger } {
  const requestId = getRequestId(req);
  const logger = createLogger({ requestId });
  return { requestId, logger };
}
