/**
 * Shared rate limiter + circuit breaker used by every keyless metadata
 * provider in the enrichment pipeline (L8).
 *
 * Design:
 * - Per-key state (one key per provider, e.g. `imdb-suggest`, `wikidata`).
 * - Concurrency gate via a semaphore-like in-flight counter.
 * - Rate gate via a token bucket refilled on a per-second cadence.
 * - Exponential backoff: a pending failure applies an artificial delay on the
 *   next `acquire()` for the same key. `reportSuccess()` clears the streak.
 * - Circuit breaker: N consecutive failures pauses the key entirely for a
 *   configured duration. `acquire()` blocks callers until the pause expires.
 *
 * The retry *count* (e.g. L8's "3 retries") is intentionally a consumer
 * concern. This module just hands out the backoff duration and the pause
 * duration and trusts the caller to honor them.
 *
 * Pure Node — only uses `setTimeout` and Promises. No external deps.
 */

/** Configuration for a single rate-limiter key. */
export interface RateLimitConfig {
  /** Max in-flight calls for this key at any moment. */
  concurrency: number
  /** Max calls *started* per second, averaged via token bucket refill. */
  ratePerSec: number
  /** Exponential backoff schedule applied on `reportFailure`. */
  backoffMs?: {
    initial: number
    max: number
    multiplier: number
  }
  /** Circuit breaker: pause the key after N consecutive failures. */
  circuitBreaker?: {
    failureThreshold: number
    pauseMs: number
  }
}

/** L8 defaults for IMDb suggest. */
export const IMDB_RATE_LIMIT: RateLimitConfig = {
  concurrency: 10,
  ratePerSec: 10,
  backoffMs: { initial: 1000, max: 60000, multiplier: 2 },
  circuitBreaker: { failureThreshold: 10, pauseMs: 5 * 60 * 1000 },
}

/** L8 defaults for Wikidata. */
export const WIKIDATA_RATE_LIMIT: RateLimitConfig = {
  concurrency: 10,
  ratePerSec: 10,
  backoffMs: { initial: 1000, max: 60000, multiplier: 2 },
  circuitBreaker: { failureThreshold: 10, pauseMs: 5 * 60 * 1000 },
}

interface KeyState {
  config: RateLimitConfig
  inFlight: number
  /** Token bucket: number of tokens currently available (floats are fine). */
  tokens: number
  /** Monotonic ms timestamp of the last refill. */
  lastRefillMs: number
  /** Consecutive failure count; reset on `reportSuccess`. */
  consecutiveFailures: number
  /** Current backoff duration in ms (grows with each failure, capped at max). */
  currentBackoffMs: number
  /** Monotonic ms timestamp until which this key is paused (0 = not paused). */
  pausedUntilMs: number
  /** FIFO queue of waiters blocked on concurrency/rate/backoff. */
  waiters: Array<() => void>
}

/**
 * Per-key rate limiter. One instance is typically shared across the whole
 * enrichment worker — providers receive it via constructor DI.
 */
export class RateLimiter {
  private readonly state = new Map<string, KeyState>()
  private readonly defaultConfig: RateLimitConfig | undefined

  /**
   * @param defaultConfig Optional fallback applied when `acquire` is called
   *   for a key that was never explicitly configured. If omitted, unknown
   *   keys throw.
   */
  constructor(defaultConfig?: RateLimitConfig) {
    this.defaultConfig = defaultConfig
  }

  /** Register (or overwrite) a per-key config. Idempotent. */
  configure(key: string, config: RateLimitConfig): void {
    const existing = this.state.get(key)
    if (existing) {
      existing.config = config
      return
    }
    this.state.set(key, makeKeyState(config))
  }

  /**
   * Block until a slot is available for this key. Caller MUST pair with
   * `release(key)` in a `try/finally` to free the concurrency slot.
   */
  async acquire(key: string): Promise<void> {
    const s = this.ensureState(key)
    return new Promise<void>((resolve) => {
      const attempt = () => {
        const now = Date.now()

        // Circuit breaker check
        if (s.pausedUntilMs > now) {
          const wait = s.pausedUntilMs - now
          setTimeout(attempt, wait)
          return
        }

        // Backoff check (from most recent failure streak)
        if (s.currentBackoffMs > 0 && s.consecutiveFailures > 0) {
          // Consume the backoff once — future acquires proceed until another
          // failure escalates it. This matches "wait `backoffMs` before retry"
          // semantics without blocking unrelated callers indefinitely.
          const wait = s.currentBackoffMs
          s.currentBackoffMs = 0
          setTimeout(attempt, wait)
          return
        }

        refillTokens(s, now)

        if (s.inFlight >= s.config.concurrency || s.tokens < 1) {
          // Not ready — re-queue. We poll because both concurrency (`release`)
          // and rate (`tokens`) recover on independent triggers; a single
          // wakeup path keeps the state machine simple.
          s.waiters.push(attempt)
          // If we're only waiting on tokens (not concurrency), schedule a
          // wakeup at the projected refill time so the queue doesn't stall.
          if (s.inFlight < s.config.concurrency && s.config.ratePerSec > 0) {
            const msPerToken = 1000 / s.config.ratePerSec
            const msUntilToken = Math.max(1, Math.ceil((1 - s.tokens) * msPerToken))
            setTimeout(() => drainWaiters(s), msUntilToken)
          }
          return
        }

        s.tokens -= 1
        s.inFlight += 1
        resolve()
      }
      attempt()
    })
  }

  /** Release a slot previously acquired. Safe to call without a matching acquire (no-op). */
  release(key: string): void {
    const s = this.state.get(key)
    if (!s) return
    if (s.inFlight > 0) s.inFlight -= 1
    drainWaiters(s)
  }

  /** Mark the most recent call as successful — clears the failure streak. */
  reportSuccess(key: string): void {
    const s = this.state.get(key)
    if (!s) return
    s.consecutiveFailures = 0
    s.currentBackoffMs = 0
  }

  /**
   * Mark the most recent call as failed. Optional `status` is accepted for
   * future differentiation (e.g. 429 vs 500 vs transport error) but is not
   * currently used to alter behavior.
   */
  reportFailure(key: string, _status?: number): void {
    const s = this.state.get(key)
    if (!s) return
    s.consecutiveFailures += 1

    const bo = s.config.backoffMs
    if (bo) {
      if (s.currentBackoffMs === 0) {
        s.currentBackoffMs = bo.initial
      } else {
        s.currentBackoffMs = Math.min(bo.max, Math.round(s.currentBackoffMs * bo.multiplier))
      }
    }

    const cb = s.config.circuitBreaker
    if (cb && s.consecutiveFailures >= cb.failureThreshold) {
      s.pausedUntilMs = Date.now() + cb.pauseMs
    }
  }

  /** Snapshot of internal state for a key. Test/debug only. */
  inspect(key: string): Readonly<KeyState> | undefined {
    return this.state.get(key)
  }

  private ensureState(key: string): KeyState {
    const existing = this.state.get(key)
    if (existing) return existing
    if (!this.defaultConfig) {
      throw new Error(`RateLimiter: key "${key}" has no config and no default was provided`)
    }
    const s = makeKeyState(this.defaultConfig)
    this.state.set(key, s)
    return s
  }
}

function makeKeyState(config: RateLimitConfig): KeyState {
  return {
    config,
    inFlight: 0,
    tokens: config.ratePerSec,
    lastRefillMs: Date.now(),
    consecutiveFailures: 0,
    currentBackoffMs: 0,
    pausedUntilMs: 0,
    waiters: [],
  }
}

function refillTokens(s: KeyState, now: number): void {
  const elapsedMs = now - s.lastRefillMs
  if (elapsedMs <= 0) return
  const refill = (elapsedMs / 1000) * s.config.ratePerSec
  s.tokens = Math.min(s.config.ratePerSec, s.tokens + refill)
  s.lastRefillMs = now
}

function drainWaiters(s: KeyState): void {
  // Re-run waiters in FIFO order. Each waiter re-checks the gates itself, so
  // failed re-entries will just re-queue without starving the queue.
  const queued = s.waiters.splice(0, s.waiters.length)
  for (const w of queued) w()
}
