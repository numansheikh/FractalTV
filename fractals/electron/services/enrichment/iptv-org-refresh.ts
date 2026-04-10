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

import type { IptvOrgCache } from './iptv-org-cache'

const CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000 // 6 hours — cheap cache-age check
const REFRESH_THRESHOLD_MS = 7 * 24 * 60 * 60 * 1000 // 7 days

interface SchedulerState {
  paused: boolean
  timer: NodeJS.Timeout | null
  cache: IptvOrgCache | null
}

const state: SchedulerState = {
  paused: false,
  timer: null,
  cache: null,
}

function shouldRefresh(cache: IptvOrgCache): boolean {
  const age = cache.getCacheAge()
  if (age == null) return true
  return age > REFRESH_THRESHOLD_MS
}

async function runRefresh(cache: IptvOrgCache): Promise<void> {
  console.log('[iptv-org-refresh] refresh: starting')
  try {
    await cache.refresh(true)
    console.log('[iptv-org-refresh] refresh: complete')
  } catch (err) {
    console.warn('[iptv-org-refresh] refresh: failed', err)
  }
}

function scheduleNextCheck(): void {
  if (state.paused || !state.cache) return
  state.timer = setTimeout(() => {
    state.timer = null
    if (state.paused || !state.cache) return
    void checkAndRefresh(state.cache)
  }, CHECK_INTERVAL_MS)
  // Don't keep the event loop alive just for this scheduler.
  state.timer.unref?.()
}

async function checkAndRefresh(cache: IptvOrgCache): Promise<void> {
  if (state.paused) return
  try {
    await cache.initCache()
    if (shouldRefresh(cache)) {
      await runRefresh(cache)
    }
  } catch (err) {
    console.warn('[iptv-org-refresh] check failed:', err)
  } finally {
    scheduleNextCheck()
  }
}

/**
 * Start the weekly refresh loop. Safe to call multiple times — a second
 * call with a different cache instance replaces the previous scheduler.
 *
 * Does NOT block on the initial refresh. The first check is deferred to
 * `setImmediate` so it yields to the main loop before doing any network
 * I/O — critical for app startup responsiveness.
 */
export function startRefreshScheduler(cache: IptvOrgCache): void {
  stopRefreshScheduler()

  state.cache = cache
  state.paused = false

  console.log('[iptv-org-refresh] scheduler started')

  setImmediate(() => {
    if (state.paused || !state.cache) return
    void checkAndRefresh(state.cache)
  })
}

/**
 * Stop the scheduler. Any in-flight refresh already dispatched to the
 * cache will still complete (we don't abort fetches mid-flight), but no
 * further checks will be scheduled.
 */
export function stopRefreshScheduler(): void {
  state.paused = true
  if (state.timer) {
    clearTimeout(state.timer)
    state.timer = null
  }
  state.cache = null
  console.log('[iptv-org-refresh] scheduler stopped')
}
