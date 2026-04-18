// Swap for @upstash/ratelimit + Redis in production.

import { BreezeError } from "@breeze/common";

interface Bucket {
  tokens: number;
  updatedAt: number;
}

const buckets = new Map<string, Bucket>();

export function rateLimit(
  key: string,
  opts: { capacity: number; refillPerSec: number },
): { ok: boolean; retryAfterMs: number } {
  const now = Date.now();
  const existing = buckets.get(key);

  let tokens: number;
  if (existing === undefined) {
    tokens = opts.capacity;
  } else {
    const elapsedSec = (now - existing.updatedAt) / 1000;
    tokens = Math.min(opts.capacity, existing.tokens + elapsedSec * opts.refillPerSec);
  }

  if (tokens >= 1) {
    buckets.set(key, { tokens: tokens - 1, updatedAt: now });
    return { ok: true, retryAfterMs: 0 };
  }

  const deficit = 1 - tokens;
  const retryAfterMs = Math.ceil((deficit / opts.refillPerSec) * 1000);
  buckets.set(key, { tokens, updatedAt: now });
  return { ok: false, retryAfterMs };
}

export async function enforceRateLimit(
  userId: string,
  tag: string,
  opts: { capacity: number; refillPerSec: number },
): Promise<void> {
  const key = `${userId}:${tag}`;
  const result = rateLimit(key, opts);
  if (!result.ok) {
    throw new BreezeError("rate_limit", "Too many requests", {
      details: { retryAfterMs: result.retryAfterMs },
    });
  }
}
