/**
 * ID helpers. We use cuid-style IDs (short, url-safe, sortable-ish) for
 * app-level identifiers. The real implementation uses `@paralleldrive/cuid2`
 * or `ulid` — this file is a stable boundary so we can swap later without
 * touching callers.
 */
export function newId(): string {
  // Placeholder: in production, replace with cuid2 or ulid.
  const ts = Date.now().toString(36);
  const rand = Math.random().toString(36).slice(2, 10);
  return `${ts}${rand}`;
}

export function idempotencyKey(parts: Array<string | number>): string {
  return parts.map((p) => String(p)).join(":");
}
