/**
 * iptv-org weekly refresh scheduler — L10 of the V3 data-search plan.
 *
 * Runs as a low-priority background task. On startup, checks the cache age
 * via `cache.getCacheAge()`. If stale (or never fetched), kicks off a
 * refresh via `setImmediate` so it yields to the main event loop before
 * any network work begins. Thereafter, a rolling `setTimeout` re-checks
 * every `CHECK_INTERVAL_MS` and triggers a refresh when the cache exceeds
 * `REFRESH_THRESHOLD_MS`.
 *
 * No UI notifications — all status flows through `console.log`. The caller
 * (main.ts, later) wires this in once and forgets about it. Calling
 * `stopRefreshScheduler()` cleans up any pending timer.
 */
import type { IptvOrgCache } from './iptv-org-cache';
/**
 * Start the weekly refresh loop. Safe to call multiple times — a second
 * call with a different cache instance replaces the previous scheduler.
 *
 * Does NOT block on the initial refresh. The first check is deferred to
 * `setImmediate` so it yields to the main loop before doing any network
 * I/O — critical for app startup responsiveness.
 */
export declare function startRefreshScheduler(cache: IptvOrgCache): void;
/**
 * Stop the scheduler. Any in-flight refresh already dispatched to the
 * cache will still complete (we don't abort fetches mid-flight), but no
 * further checks will be scheduled.
 */
export declare function stopRefreshScheduler(): void;
