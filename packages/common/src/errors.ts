/**
 * Shared error taxonomy. Every connector normalizes upstream errors into
 * one of these. The broker and UI branch on `code`.
 */
export type BreezeErrorCode =
  | "auth"
  | "permission"
  | "not_found"
  | "conflict"
  | "rate_limit"
  | "upstream"
  | "validation"
  | "policy_denied"
  | "unknown";

export class BreezeError extends Error {
  readonly code: BreezeErrorCode;
  readonly retryable: boolean;
  readonly cause?: unknown;
  readonly details?: Record<string, unknown>;

  constructor(
    code: BreezeErrorCode,
    message: string,
    opts: {
      retryable?: boolean;
      cause?: unknown;
      details?: Record<string, unknown>;
    } = {}
  ) {
    super(message);
    this.name = "BreezeError";
    this.code = code;
    this.retryable = opts.retryable ?? false;
    this.cause = opts.cause;
    this.details = opts.details;
  }
}

export function isBreezeError(e: unknown): e is BreezeError {
  return e instanceof BreezeError;
}
