// infrastructure/rate_limiter.ts — Durable Object implementing per-IP token bucket.
//
// Each IP gets its own DO instance (idFromName(ip)), so there is no global
// bottleneck — this is the correct pattern per Cloudflare DO best practices.
//
// Token bucket parameters:
//   DEFAULT_CAPACITY — max burst tokens        (default: 20)
//   DEFAULT_RATE     — tokens added per second  (default: 2)
//
// On each request we compute how many tokens to add since the last check,
// cap at capacity, then try to consume 1 token. If the bucket is empty → 429.

import { DurableObject } from "cloudflare:workers";

interface BucketState {
  tokens: number;
  lastRefill: number; // Unix milliseconds
}

// Minimal interface that only requires what rate_limiter.ts needs,
// breaking the circular dependency with index.ts.
interface RateLimiterEnv {
  RATE_LIMITER: DurableObjectNamespace<RateLimiterDO>;
}

export class RateLimiterDO extends DurableObject<RateLimiterEnv> {
  private static readonly DEFAULT_CAPACITY = 20;
  private static readonly DEFAULT_RATE = 2; // tokens / second

  async checkLimit(): Promise<{ allowed: boolean; remaining: number }> {
    const capacity = RateLimiterDO.DEFAULT_CAPACITY;
    const rate = RateLimiterDO.DEFAULT_RATE;
    const now = Date.now();

    const stored = await this.ctx.storage.get<BucketState>("bucket");
    const state: BucketState = stored ?? { tokens: capacity, lastRefill: now };

    // Refill tokens proportional to elapsed time.
    const elapsed = (now - state.lastRefill) / 1000; // seconds
    const refill = elapsed * rate;
    const newTokens = Math.min(capacity, state.tokens + refill);

    if (newTokens < 1) {
      // No token available — do NOT update storage (preserve the starved state).
      return { allowed: false, remaining: 0 };
    }

    // Consume one token.
    const updated: BucketState = {
      tokens: newTokens - 1,
      lastRefill: now,
    };
    await this.ctx.storage.put("bucket", updated);

    return { allowed: true, remaining: Math.floor(updated.tokens) };
  }
}

// ---------------------------------------------------------------------------
// Helper used by handlers to call the per-IP Durable Object.
// ---------------------------------------------------------------------------

export async function checkRateLimit(
  env: RateLimiterEnv,
  ip: string
): Promise<{ allowed: boolean; remaining: number }> {
  // One DO instance per IP — correct pattern for per-entity coordination.
  const id = env.RATE_LIMITER.idFromName(ip);
  const stub = env.RATE_LIMITER.get(id);
  return stub.checkLimit();
}
