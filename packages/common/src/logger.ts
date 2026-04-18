/**
 * Zero-dependency structured logger shim.
 * Outputs one JSON line per call to stdout: { level, time, ...bindings, msg, ...data }
 * API is compatible with pino — swap createLogger for pino() when ready.
 *
 * Redacted keys (case-insensitive): accessToken, refreshToken, idToken,
 * apiKey, credentials, authorization.
 */

const REDACT_KEYS = new Set([
  "accesstoken",
  "refreshtoken",
  "idtoken",
  "apikey",
  "credentials",
  "authorization",
]);

function redact(o: unknown, depth = 0): unknown {
  if (depth > 4) return o;
  if (o === null || typeof o !== "object") return o;
  if (Array.isArray(o)) return o.map((v) => redact(v, depth + 1));
  const result: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(o as Record<string, unknown>)) {
    result[k] = REDACT_KEYS.has(k.toLowerCase()) ? "[REDACTED]" : redact(v, depth + 1);
  }
  return result;
}

export interface Logger {
  info(msg: string, data?: Record<string, unknown>): void;
  warn(msg: string, data?: Record<string, unknown>): void;
  error(msg: string, data?: Record<string, unknown>): void;
  child(bindings: Record<string, unknown>): Logger;
}

function writeLine(
  level: "info" | "warn" | "error",
  bindings: Record<string, unknown>,
  msg: string,
  data?: Record<string, unknown>,
): void {
  const line = JSON.stringify({
    level,
    time: Date.now(),
    ...bindings,
    msg,
    ...(data !== undefined ? (redact(data) as Record<string, unknown>) : {}),
  });
  // eslint-disable-next-line no-console
  process.stdout.write(line + "\n");
}

export function createLogger(bindings: Record<string, unknown> = {}): Logger {
  const redactedBindings = redact(bindings) as Record<string, unknown>;

  return {
    info(msg, data) {
      writeLine("info", redactedBindings, msg, data);
    },
    warn(msg, data) {
      writeLine("warn", redactedBindings, msg, data);
    },
    error(msg, data) {
      writeLine("error", redactedBindings, msg, data);
    },
    child(childBindings) {
      return createLogger({ ...redactedBindings, ...(redact(childBindings) as Record<string, unknown>) });
    },
  };
}
