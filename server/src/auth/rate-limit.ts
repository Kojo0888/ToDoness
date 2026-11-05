/** Counts failures per key within a time window (in memory). */
export interface RateLimiter {
  /** Whether this key may try now, and how long to wait if not. */
  check(key: string): { allowed: boolean; retryAfterSec: number };
  /** Records one failure for the key. */
  fail(key: string): void;
  reset(key: string): void;
  size(): number;
}

export function createRateLimiter(opts: {
  max: number;
  windowMs: number;
  now?: () => number;
  /** Upper bound for remembered keys, so an attacker cannot fill the memory. */
  maxKeys?: number;
}): RateLimiter {
  const { max, windowMs, now = Date.now, maxKeys = 10_000 } = opts;
  const failures = new Map<string, number[]>();

  function recent(key: string): number[] {
    const list = failures.get(key);
    if (!list) return [];
    const cutoff = now() - windowMs;
    const kept = list.filter((t) => t > cutoff);
    if (kept.length === 0) failures.delete(key);
    else if (kept.length !== list.length) failures.set(key, kept);
    return kept;
  }

  function trim() {
    if (failures.size <= maxKeys) return;
    for (const key of [...failures.keys()]) recent(key); // drop expired keys
    for (const key of failures.keys()) {
      if (failures.size <= maxKeys) break;
      failures.delete(key); // oldest first (Map keeps insertion order)
    }
  }

  return {
    check(key) {
      const list = recent(key);
      if (list.length < max) return { allowed: true, retryAfterSec: 0 };
      const wait = list[0]! + windowMs - now();
      return { allowed: false, retryAfterSec: Math.max(1, Math.ceil(wait / 1000)) };
    },
    fail(key) {
      const list = recent(key);
      list.push(now());
      failures.set(key, list);
      trim();
    },
    reset(key) {
      failures.delete(key);
    },
    size: () => failures.size,
  };
}
