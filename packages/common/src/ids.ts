import { randomUUID } from "node:crypto";

/**
 * ID helpers. We use UUIDs for app-level identifiers via node:crypto's
 * randomUUID — cryptographically random, no external dependency.
 */
export function newId(): string {
  return randomUUID();
}

export function idempotencyKey(parts: Array<string | number>): string {
  return parts.map((p) => String(p)).join(":");
}
