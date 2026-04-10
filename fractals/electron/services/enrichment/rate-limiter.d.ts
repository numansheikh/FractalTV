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
    concurrency: number;
    /** Max calls *started* per second, averaged via token bucket refill. */
    ratePerSec: number;
    /** Exponential backoff schedule applied on `reportFailure`. */
    backoffMs?: {
        initial: number;
        max: number;
        multiplier: number;
    };
    /** Circuit breaker: pause the key after N consecutive failures. */
    circuitBreaker?: {
        failureThreshold: number;
        pauseMs: number;
    };
}
/** L8 defaults for IMDb suggest. */
export declare const IMDB_RATE_LIMIT: RateLimitConfig;
/** L8 defaults for Wikidata. */
export declare const WIKIDATA_RATE_LIMIT: RateLimitConfig;
interface KeyState {
    config: RateLimitConfig;
    inFlight: number;
    /** Token bucket: number of tokens currently available (floats are fine). */
    tokens: number;
    /** Monotonic ms timestamp of the last refill. */
    lastRefillMs: number;
    /** Consecutive failure count; reset on `reportSuccess`. */
    consecutiveFailures: number;
    /** Current backoff duration in ms (grows with each failure, capped at max). */
    currentBackoffMs: number;
    /** Monotonic ms timestamp until which this key is paused (0 = not paused). */
    pausedUntilMs: number;
    /** FIFO queue of waiters blocked on concurrency/rate/backoff. */
    waiters: Array<() => void>;
}
/**
 * Per-key rate limiter. One instance is typically shared across the whole
 * enrichment worker — providers receive it via constructor DI.
 */
export declare class RateLimiter {
    private readonly state;
    private readonly defaultConfig;
    /**
     * @param defaultConfig Optional fallback applied when `acquire` is called
     *   for a key that was never explicitly configured. If omitted, unknown
     *   keys throw.
     */
    constructor(defaultConfig?: RateLimitConfig);
    /** Register (or overwrite) a per-key config. Idempotent. */
    configure(key: string, config: RateLimitConfig): void;
    /**
     * Block until a slot is available for this key. Caller MUST pair with
     * `release(key)` in a `try/finally` to free the concurrency slot.
     */
    acquire(key: string): Promise<void>;
    /** Release a slot previously acquired. Safe to call without a matching acquire (no-op). */
    release(key: string): void;
    /** Mark the most recent call as successful — clears the failure streak. */
    reportSuccess(key: string): void;
    /**
     * Mark the most recent call as failed. Optional `status` is accepted for
     * future differentiation (e.g. 429 vs 500 vs transport error) but is not
     * currently used to alter behavior.
     */
    reportFailure(key: string, _status?: number): void;
    /** Snapshot of internal state for a key. Test/debug only. */
    inspect(key: string): Readonly<KeyState> | undefined;
    private ensureState;
}
export {};
