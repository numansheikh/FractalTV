Here is the QA report:

---

## QA Code Review: Fractals App

### 1. IPC / Preload / API Consistency

**[MEDIUM] `src/lib/api.ts`:45 -- `search.query` accepts `categoryName` but preload.ts does not**
The `api.ts` wrapper defines `categoryName` as a parameter for `search.query`, but `electron/preload.ts`:32 does NOT include `categoryName` in the type signature for `search:query`. The handler in `handlers.ts`:228 does accept it. The preload passes args through untyped so it works at runtime, but the type mismatch means TypeScript won't catch bugs if the field name changes.

**[LOW] `electron/preload.ts`:100 -- `removeAllListeners` is overly aggressive**
The `on()` cleanup function calls `ipcRenderer.removeAllListeners(channel)`, which nukes ALL listeners on that channel, not just the one added. If two components both call `api.on('sync:progress', ...)`, unsubscribing one kills both. Should use `ipcRenderer.removeListener(channel, wrappedCallback)` instead.

### 2. React Component Issues

**[HIGH] `src/App.tsx`:65-86 -- `handleSync` referenced in useEffect but not in dependency array**
The `useEffect` at line 65 calls `handleSync` (defined at line 129) inside its body, but `handleSync` is not in the dependency array `[setSources]`. `handleSync` is recreated every render (it closes over `sources`, `updateSource`, etc.), so the stale closure at first mount will use stale `updateSource`/`setSyncProgress` references. Since `handleSync` is only called for sources without `lastSync` on initial load, the practical impact is limited, but it is technically a stale closure.

**[MEDIUM] `src/components/content/ContentDetail.tsx`:91-121 -- enrichment useEffect has race condition**
The `enrichAttemptedRef` prevents re-enrichment across renders, but it is never reset when `item.id` changes (it persists via `useRef`). If the user opens ContentDetail for item A (enrich attempted), then navigates to item B, the ref still holds `true` and enrichment for B is skipped. The dependency array includes `item.id`, but the ref is never reset in the effect body.

**[MEDIUM] `src/components/player/Player.tsx`:146-154 -- `setTimeout` callbacks not cleaned up**
The `checkAudioOnly` calls at lines 154-155 use `setTimeout(checkAudioOnly, 4000)` and `setTimeout(checkAudioOnly, 8000)` inside the `art.on('ready')` callback, but these timeouts are never cleared in the cleanup function (line 228-237). If the component unmounts before 8s, these fire against a destroyed player, checking `cancelled` for `setIsAudioOnly` but still accessing `video.videoWidth` on a potentially destroyed element.

**[LOW] `src/components/browse/BrowseViewH.tsx`:167 -- unstable dependency in useEffect**
`allVisibleIds.join(',')` is recalculated every render since `allVisibleIds` is a new array each time. The `loadBulk` call inside the effect is guarded by `missing.length` check, so it won't re-fetch, but the effect still re-runs needlessly on every render.

**[LOW] `src/components/browse/PosterCard.tsx`:37 -- `buildColorMap` called on every render of every card**
Each `PosterCard` calls `buildColorMap(sources.map(s => s.id))` independently. With 100 cards visible, this runs 100 times per render cycle. Same issue in `ChannelCard.tsx`:15 and `ContentCard.tsx`:36. Should be lifted to the parent or memoized.

### 3. Database Schema vs Queries

**[HIGH] `electron/database/connection.ts`:128-137 -- `user_data` PK is `content_id` only, but queries filter by `profile_id`**
The `CREATE TABLE` has `content_id TEXT PRIMARY KEY`, meaning only ONE row per content_id across ALL profiles. But read queries (lines 502, 516, 530, etc.) filter `WHERE profile_id = 'default'`, and the Drizzle schema at `schema.ts`:131 also defines `contentId` as the sole primary key. When multi-profile support is added, the INSERT ... ON CONFLICT(content_id) statements will silently overwrite other profiles' data. The PK should be `(content_id, profile_id)`.

**[MEDIUM] `electron/ipc/handlers.ts`:462-468 -- INSERT into user_data omits `profile_id`**
All the `INSERT INTO user_data` statements (lines 463, 475, 486, 566, 579) rely on the DEFAULT value for `profile_id`, which works now but is a latent bug when profiles are implemented. The column should be explicitly set.

### 4. Error Handling Gaps

**[HIGH] `electron/ipc/handlers.ts`:258,383 -- SQL injection via string interpolation for `type`**
Lines 258 and 383 use template literal interpolation: `` `AND c.type = '${type}'` ``. The `type` value comes from the renderer via IPC args. While it passes through TypeScript type narrowing in the preload, a compromised renderer or direct IPC call could inject SQL. Should use parameterized `AND c.type = ?` with params.

**[MEDIUM] `src/components/player/Player.tsx`:41-43 -- episode URL construction with no validation**
The episode URL is built by string concatenation from `content._streamId`, `_serverUrl`, `_username`, `_password` (lines 42-43). These come from `seriesInfo` returned by the IPC handler which includes raw source credentials at `handlers.ts`:447. If any of these values contain special URL characters, the URL will be malformed. `encodeURIComponent` is used for username/password but not for the stream ID or extension.

**[LOW] `electron/ipc/handlers.ts`:68-78 -- `sources:remove` worker can resolve twice**
The worker's `on('message')` and `on('exit')` can both call `resolve()`. If the worker sends a message and then exits with code 0, only the first resolve takes effect (which is correct), but if it exits with non-zero after sending a success message, the second resolve is silently ignored. Not a crash bug, but the pattern is fragile.

### 5. Dead Code & Unused Items

**[LOW] `src/components/content/ContentDetail.tsx`:577-594 -- `PosterIcon` function is defined but never used**
The `PosterIcon` component is defined but never referenced anywhere in the file or codebase.

**[LOW] `src/components/browse/PersonalizedRows.tsx`:96 -- `onSelect` passed to `ScrollRow` but unused**
The `ScrollRow` component receives `onSelect` prop (aliased as `_onSelect` with underscore prefix) but never uses it.

**[LOW] `src/components/browse/ContentCard.tsx` -- appears to be the old list-view card**
This file exports `ContentItem` type (used everywhere) but the `ContentCard` component itself appears unused in the current horizontal layout. `BrowseViewH.tsx` uses `PosterCard` and `ChannelCard` instead.

### 6. Edge Cases

**[MEDIUM] `electron/database/connection.ts`:232 -- Hardcoded TMDB API key in source code**
`6b1134d6382480dbbecad0055d5ab2e4` is seeded as default. This key will be visible to anyone with access to the binary. If it gets rate-limited or revoked, all users without a custom key lose enrichment.

**[MEDIUM] `src/components/content/ContentDetail.tsx`:641 -- StarRating local state drifts from prop**
`StarRating` initializes `useState(currentRating)` but never updates when `currentRating` prop changes (e.g., after re-fetching user data). The local state will show stale rating if the component stays mounted while the parent re-renders with new data.

**[LOW] `electron/ipc/handlers.ts`:549-561 -- `user:bulk-get-data` with large arrays**
If `contentIds` has hundreds of entries, the generated `IN (?, ?, ?, ...)` clause can hit SQLite's variable limit (default 999). With page sizes of 60 this is fine, but edge cases with multiple concurrent calls could accumulate.

**[LOW] `src/components/content/ContentDetail.tsx`:621-623 -- `tryParse` fallback wraps non-JSON in array**
`tryParse` returns `[s]` on parse failure. If `genres` is a comma-separated string instead of JSON (e.g., from raw Xtream data), the UI shows one big genre chip like `"Action, Drama, Thriller"` instead of separate chips.

---

**Summary: 3 high, 7 medium, 9 low findings.** The most impactful issues are the SQL string interpolation for `type` in search queries, the `user_data` primary key not including `profile_id`, and the enrichment `useRef` not resetting across item changes in ContentDetail.
