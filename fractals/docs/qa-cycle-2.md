# QA Cycle 2 — Comprehensive Gap Analysis

**Date:** 2026-04-10
**Scope:** Full codebase audit — `fractals/src/`, `fractals/electron/`, CSS, config
**Method:** File-by-file static analysis, pattern detection, architecture review

---

## SEVERITY LEGEND

| Tag | Meaning |
|-----|---------|
| **P0 — CRITICAL** | Broken functionality, data loss, security risk |
| **P1 — HIGH** | Significant UX degradation, latent bugs, incorrect behavior |
| **P2 — MEDIUM** | Code quality, maintainability, minor UX issues |
| **P3 — LOW** | Nits, cleanup, polish |

---

## 1. TYPE SAFETY — SYSTEMIC `as any` ABUSE

**Severity: P1**

The codebase has **130+ `as any` casts** spread across virtually every file. This is the single biggest quality issue — it defeats TypeScript's entire purpose and masks real bugs.

### 1.1 Untyped API Layer (`api.ts`)

**Every** IPC method beyond the initial batch uses `(window.api as any).namespace.method()`. The preload correctly types these methods, but `api.ts` doesn't consume those types.

- `api.ts:18,21,27,33,45,48,51,54` — sources namespace
- `api.ts:75` — content.getCatchupUrl
- `api.ts:95-126` — entire user namespace (favorites, watchlist, history, bulk, clear*)
- `api.ts:131-137` — entire channels namespace
- `api.ts:155-161` — entire enrichment namespace
- `api.ts:166-175` — entire epg namespace
- `api.ts:180,185,190,195,197` — series, settings, dialog, window

**Impact:** No compile-time checking on ~70% of IPC calls. If a handler signature changes in `handlers.ts`, the renderer will silently pass wrong arguments.

### 1.2 Untyped IPC Response Consumption

Components receive IPC results and immediately cast to `any` to access properties:

- `ActionButtons.tsx:37-42` — `(d as any).favorite`, `(d as any).watchlist`, `(d as any).rating`, `(d as any).last_position`, `(d as any).completed`
- `PlayerOverlay.tsx:86,119,120,153,155,159,183,244,288,364,449` — massive `as any` surface
- `SourceCard.tsx:83-84,122-123` — test result shape guessed
- `SettingsPanel.tsx:566-567,642,651,960` — dialog/import results
- `SeriesDetail.tsx:69,81-83,90` — seasons, server credentials
- `SourceTabBar.tsx:144,305,328` — account info, toggle result
- `BrowseSidebar.tsx:42,46,53,207` — categories array
- `BrowseView.tsx:98,157-158,254` — categories, search results
- `BrowseViewH.tsx:101,163-164,335` — identical pattern
- `ContentArea.tsx:85,102` — type coercion

### 1.3 The `primarySourceId` Quad-Fallback Pattern

This expression appears **12 times** across the codebase, always with `(item as any).source_ids`:

```ts
item.primarySourceId ?? item.primary_source_id ?? (item as any).source_ids ?? item.id?.split(':')[0]
```

**Files:** `PosterCard.tsx` (browse + cards), `ChannelCard.tsx` (browse + cards), `ContentCard.tsx`, `VirtualGrid.tsx`, `MovieDetail.tsx`, `SeriesDetail.tsx`, `PlayerOverlay.tsx`, `LiveSplitView.tsx`, `ChannelSurfer.tsx`, `HomeView.tsx`

**Issue:** This is a symptom of `ContentItem` not having a single resolved `sourceId` property. The dual `camelCase`/`snake_case` property names (`posterUrl` vs `poster_url`, `primarySourceId` vs `primary_source_id`, `ratingTmdb` vs `rating_tmdb`) in `types.ts:9-24` prove the DB→renderer mapping is inconsistent.

### 1.4 ArtPlayer HLS Instance Tracking

`PlayerOverlay.tsx` stores `hls` on the ArtPlayer instance via `(art as any).hls`:
- Lines 203, 239, 288, 341, 454, 456, 459, 474, 475, 478

This is an untyped side-channel that will break silently if ArtPlayer changes its internal structure.

---

## 2. ARCHITECTURE — DUPLICATE COMPONENTS

**Severity: P2**

### 2.1 Two Parallel Card Systems

The codebase has **two complete sets** of card components:

| browse/ (used in BrowseView/BrowseViewH) | cards/ (used in grids, home, library) |
|---|---|
| `browse/ChannelCard.tsx` (145 lines) | `cards/ChannelCard.tsx` (147 lines) |
| `browse/PosterCard.tsx` (249 lines) | `cards/PosterCard.tsx` (182 lines) |
| `browse/ContentCard.tsx` (dispatches) | `cards/CardActions.tsx` (shared) |

The `browse/` versions and `cards/` versions are **not identical** — they diverge in:
- Import structure (browse/ imports from `ContentCard.tsx`, cards/ imports from types)
- State management (browse/ uses `useQueryClient`, cards/ uses `useContextMenuStore`)
- Error handling (different `imgError` patterns)
- Feature set (cards/ has `CardActions` integration, browse/ has inline favorite toggle)

### 2.2 BrowseView vs BrowseViewH

Two 500-700 line components implementing the same browse screen with slightly different layouts:
- `BrowseView.tsx` (543 lines) — vertical sidebar layout
- `BrowseViewH.tsx` (687 lines) — horizontal layout variant

These share ~60% identical code (search queries, pagination, filter logic, category handling). No shared abstraction.

### 2.3 Empty Directory

`src/components/content/` is an empty directory — `ContentDetail.tsx` and `SeriesView.tsx` were deleted but the directory remains.

---

## 3. SECURITY CONCERNS

**Severity: P0-P1**

### 3.1 Hardcoded TMDB API Key

`connection.ts:286`:
```ts
db.prepare(`INSERT OR IGNORE INTO settings (key, value) VALUES ('tmdb_api_key', '6b1134d6382480dbbecad0055d5ab2e4')`).run()
```

A real TMDB API key is hardcoded in source and committed to git. Even though it's a free-tier key, this violates security best practices and could be revoked by TMDB if they detect abuse.

### 3.2 Credentials Stored in Plaintext

Xtream credentials (`username`, `password`, `server_url`) are stored in plaintext in SQLite:
- `schema.ts:14-15` — password field with no encryption
- `preload.ts:19` — update endpoint accepts raw passwords
- `handlers.ts` — credentials read and used in API calls without any encryption layer

**Impact:** Any process with filesystem access can read all IPTV credentials. On shared machines this is a real risk.

### 3.3 Credential Exposure in Stream URL Construction

`PlayerOverlay.tsx:155`:
```ts
url: `${(content as any)._serverUrl.replace(/\/$/, '')}/series/${encodeURIComponent((content as any)._username)}/${encodeURIComponent((content as any)._password)}/${(content as any)._streamId}.${(content as any)._extension ?? 'mkv'}`
```

Credentials are passed through the renderer process to construct URLs client-side. If any XSS or logging captures this URL, credentials are exposed. URL construction should happen exclusively in the main process.

### 3.4 IPC Event Listener Cleanup

`preload.ts:155-158`:
```ts
on: (channel: string, callback: (...args: unknown[]) => void) => {
    ipcRenderer.on(channel, (_event, ...args) => callback(...args))
    return () => ipcRenderer.removeAllListeners(channel)
}
```

`removeAllListeners(channel)` removes **all** listeners on that channel, not just the one registered. If two components listen to the same channel (e.g., `sync:progress`), unsubscribing one kills the other.

### 3.5 Unbounded IPC Channel Names

The `on()` handler accepts arbitrary channel strings without allowlisting. The preload should validate channels against a known set.

---

## 4. DATA INTEGRITY & DATABASE

**Severity: P1**

### 4.1 Migration Strategy — Silent `try/catch {}`

`connection.ts:217-253` uses 20+ bare `try {} catch {}` blocks for ALTER TABLE migrations. If a migration fails for a reason other than "column already exists" (e.g., disk full, DB locked), the error is silently swallowed and the app runs with a partially migrated schema.

### 4.2 Destructive V1 Table Drops on Every Startup

`connection.ts:52-57`:
```ts
db.exec(`
    DROP TABLE IF EXISTS content_categories;
    DROP TABLE IF EXISTS content_sources;
    DROP TABLE IF EXISTS content_fts;
    DROP TABLE IF EXISTS content;
`)
```

This runs **every time the app starts**. While these are v1 tables that should be gone, repeatedly executing DROP TABLE is wasteful and masks the fact that proper migration tracking doesn't exist.

### 4.3 FTS Index Rebuild Blocking

`rebuildFtsIfNeeded()` in `connection.ts:307-333` deletes the entire FTS index (`DELETE FROM canonical_fts`) before rebuilding. If the app crashes mid-rebuild, search is completely broken until next successful startup. A shadow-copy-and-swap approach would be safer.

### 4.4 No FK Constraint on `streams.category_id`

`streams` table (`connection.ts:165`) has `category_id TEXT` without a FOREIGN KEY constraint. Categories can be deleted (source removal cascades) but streams will retain orphaned `category_id` values.

### 4.5 Missing Index on `user_data.last_watched_at`

`user_data` has no index on `last_watched_at`, but continue-watching and history queries (`ORDER BY last_watched_at DESC`) are common operations. For users with large libraries this will degrade.

---

## 5. PLAYER — `PlayerOverlay.tsx` (986 LINES)

**Severity: P1-P2**

### 5.1 God Component

At 986 lines, `PlayerOverlay.tsx` is the largest component and handles:
- Stream URL resolution (Xtream, M3U, episodes, catchup)
- HLS.js initialization and error recovery
- ArtPlayer setup and lifecycle
- Position tracking (save on interval, pause, close)
- Channel surfing (next/prev)
- Subtitle loading
- External player detection
- Timeshift/catchup
- Keyboard shortcuts
- UI overlay (controls, info bar, category breadcrumb)

This should be at least 4-5 separate modules.

### 5.2 HLS Error Recovery Loop Risk

`PlayerOverlay.tsx:244`:
```ts
hls.on(Hls.Events.ERROR, (_e: any, data: any) => {
```

The error handler has recovery logic but no circuit breaker. A persistent stream error (e.g., expired credentials, geo-blocked) will cause infinite recovery attempts.

### 5.3 Position Save Race Condition

Position is saved on an interval AND on unmount AND on pause. If the component unmounts during an interval save, there's a brief window where two `user:set-position` IPCs could fire simultaneously. The last-write-wins nature of SQLite prevents data loss, but the IPC queue could briefly process stale data.

### 5.4 Memory Leak — HLS Instance Management

Multiple code paths create new HLS instances (`new Hls()`) but cleanup is inconsistent:
- `switchSource()` (line ~474) destroys old HLS inline
- `loadNextEpisode()` (line ~449) destroys old HLS
- Unmount cleanup relies on `artRef.current` which may be null

If `loadNextEpisode` is called rapidly (e.g., user skipping through episodes), old HLS instances may not be destroyed before new ones are created.

---

## 6. UX ISSUES

**Severity: P1-P2**

### 6.1 `tsconfig.node.json` Missing `composite: true`

TypeScript emits two errors on `tsc --noEmit`:
```
tsconfig.json(25,18): error TS6306: Referenced project must have setting "composite": true.
tsconfig.json(25,18): error TS6310: Referenced project may not disable emit.
```

This means **TypeScript type-checking is not actually running** in CI/dev. The compiler bails before checking any source files.

### 6.2 No Type-Check in Build Pipeline

`package.json` has `"typecheck": "tsc --noEmit"` but:
- It's not in the `build` script chain
- It currently fails (see 6.1)
- There's no `lint` in `build` either

**Impact:** The app builds and ships without any static analysis verification.

### 6.3 Font Loading — No @font-face or CDN

`useTheme.ts` sets `--font-ui` to fonts like "DM Sans", "Inter", "Rubik" etc., but there's no `@font-face` declaration or Google Fonts import. These fonts only work if already installed on the user's system, which is unlikely for most (especially Windows/Linux users).

**Impact:** Font selector in settings appears to work but silently falls back to system sans-serif for 6 of 7 options on most machines.

### 6.4 Search Query Sent as `categoryName: '__favorites__'`

CLAUDE.md documents this guard exists, but the sentinel value `__favorites__` is a magic string that could collide with an actual category name (unlikely but not impossible with user-generated IPTV data).

### 6.5 `homeStripSize` Default and Range

`app.store.ts:38` — `homeStripSize: 10` is persisted but there's no validation on the setter. A user or stale localStorage could set this to 0 or negative, causing empty/broken home screen rows.

### 6.6 Navigation Stack is Depth-1 Only

`app.store.ts:100-101`:
```ts
setView: (activeView) => set((s) => ({ activeView, previousView: s.activeView, categoryFilter: null })),
goBack: () => set((s) => ({ activeView: s.previousView ?? 'home', previousView: null, categoryFilter: null })),
```

Only one level of back-navigation is supported. Navigating Home → Live → Films → pressing Escape goes to Live (correct), but pressing Escape again goes to Home (skips whatever view was before Live). This is documented but still a UX gap.

---

## 7. CSS & THEMING

**Severity: P2-P3**

### 7.1 Duplicate Token Systems

`globals.css` has THREE overlapping token systems:
1. **V2 tokens** (`:root`, lines 6-37) — `--bg-0..4`, `--text-0..3`, `--accent-*`
2. **Color system** (`[data-theme="dark"]`, lines 62-91) — `--color-*`
3. **V2 Token Bridge** (`[data-theme]`, lines 143-162) — maps V2 tokens to color system

The bridge at lines 143-162 re-maps V2 tokens to color system values, but `--bg-0` is NOT bridged (only `--bg-1` through `--bg-4`). Components using `--bg-0` always get the hardcoded dark value `#080808`, even in light theme.

### 7.2 Light Theme `--bg-0` and `--bg-3` Collision

`globals.css:170-173`:
```css
--bg-0: var(--color-card);     /* #eeeeee */
--bg-3: var(--color-card);     /* #eeeeee */
```

In fractals-day theme, `--bg-0` and `--bg-3` resolve to the same value, breaking the visual hierarchy these tokens are supposed to maintain.

### 7.3 Source Color Palette Comment Inaccuracy

`globals.css:42-45` says sources get "violet, gold, orange, fuchsia, pink, amber, purple, yellow" but actual values at lines 48-56 are sky blue, amber, lime green, red, yellow, purple, pink/mauve, teal. The comment doesn't match the implementation.

### 7.4 Theme Swatch Colors Don't Match Actual Theme

`useTheme.ts:15-18`:
```ts
export const THEME_SWATCHES: Record<ThemeId, [string, string]> = {
  dark:          ['#0c0c18', '#7c4dff'],
  'fractals-day':['#fafaff', '#4f46e5'],
}
```

The dark swatch shows `#0c0c18` (blue-tinted) but the actual `--color-bg` is `#080808` (pure neutral). The fractals-day swatch shows `#4f46e5` (indigo) but the actual `--color-primary` is `#7733ff` (violet).

### 7.5 `zoom: 1` on `html`

`globals.css:195`: `html { zoom: 1; }` — this does nothing but adds a CSS property that's non-standard (not in CSS spec, Chromium-only). Remove or replace with proper scaling approach for TV mode.

---

## 8. CONSOLE LOGGING

**Severity: P2**

### 8.1 Excessive Production Logging

`handlers.ts` has **15+ `console.log` calls** that will appear in production:
- Lines 680, 709 — logs every search query and token breakdown
- Lines 1623, 1636, 1640, 1644, 1670 — logs enrichment lifecycle
- Lines 1684, 1690, 1711, 1750, 1755 — logs manual enrichment

`sync.worker.ts` has **8+ `console.log` calls** logging sync progress.
`connection.ts` has `console.log` for FTS rebuild progress.

These should be behind a debug flag or use a proper logging framework.

---

## 9. PERFORMANCE CONCERNS

**Severity: P2**

### 9.1 `rebuildFtsIfNeeded` Loads All Rows Into Memory

`connection.ts:314`:
```ts
const rows = db.prepare(`SELECT id, title, original_title, overview, cast_json, director, genres, keywords FROM canonical`).all() as any[]
```

For a library with 100K+ items, this loads all rows into memory at once before batching writes. Should use a cursor/iterate pattern.

### 9.2 Unpaginated Category Lists

`categories:list` IPC likely returns all categories for a source. With providers that have 1000+ categories, this could be a large payload on every view switch.

### 9.3 `loadBulk` on Every Render

`PersonalizedRows.tsx:22,34,46` calls `loadBulk(items.map(i => i.id))` on query success. If the parent re-renders frequently (e.g., during search), this fires repeated bulk IPC calls for the same data.

---

## 10. MISSING FEATURES / INCOMPLETE IMPLEMENTATIONS

**Severity: P2-P3**

### 10.1 `test-search.ts` Committed as Production Code

`electron/test-search.ts` (213+ lines) is a standalone test script with `console.log` output. It's not in a `tests/` directory and isn't referenced by any test runner. Dead code in the electron directory.

### 10.2 Embeddings Table Exists But Is Unused

`connection.ts:95-100` creates an `embeddings` table that's never populated. The entire embedding/vector search pipeline described in CLAUDE.md is not implemented.

### 10.3 Profiles Table Created But Unused in UI

`connection.ts:102-108` creates a `profiles` table. `user_data` has a `profile_id` column. But there's no profile UI, no profile switching, and everything uses `'default'` profile.

### 10.4 No Export/Import for User Data Across Machines

CLAUDE.md mentions local-first philosophy. While there's `sources:export` and `sources:import`, there's no documented way to export the full database (user_data, canonical enrichments) for backup or migration.

### 10.5 `debug:category-items` IPC Exposed in Production

`preload.ts:146`:
```ts
debug: {
    categoryItems: (search: string) => ipcRenderer.invoke('debug:category-items', search),
}
```

Debug endpoints should not be in production builds.

---

## 11. PRELOAD / IPC SURFACE MISMATCH

**Severity: P1**

### 11.1 `api.ts` and `preload.ts` Type Drift

`api.ts` wraps every call with `(window.api as any)` because the `window.api` type declaration at `preload.ts:169-172` doesn't include the full surface. The preload **does** expose all methods, but `api.ts` doesn't trust the types.

This means:
- No autocomplete for developers
- No compile-time safety for IPC argument shapes
- Breaking changes in handlers silently pass through

### 11.2 Missing `search:query` `categoryName` Parameter

`preload.ts:40` — the search query interface doesn't include `categoryName`:
```ts
query: (args: { query: string; type?: 'live' | 'movie' | 'series'; sourceIds?: string[]; limit?: number; offset?: number })
```

But the handler in `handlers.ts` accepts and uses `categoryName`. Callers must cast to pass it.

---

## 12. CONFIGURATION

**Severity: P2**

### 12.1 `tsconfig.node.json` Missing `composite: true`

```json
{
  "compilerOptions": {
    "noEmit": true
  }
}
```

This is referenced by `tsconfig.json` but lacks `composite: true` and has `noEmit: true`, causing the TS6306/TS6310 errors. TypeScript project references don't work.

### 12.2 No ESLint Config Found

`package.json` has `"lint": "eslint src electron --ext .ts,.tsx"` but no `.eslintrc`, `eslint.config.*`, or similar config file was found in the project root. The lint command likely fails or uses defaults.

### 12.3 No Prettier Config

No `.prettierrc` or prettier config found. Code formatting consistency relies entirely on developer discipline.

---

## 13. DEAD CODE & CLEANUP

**Severity: P3**

| Item | Location | Notes |
|------|----------|-------|
| Empty `content/` directory | `src/components/content/` | Both files deleted, dir remains |
| `test-search.ts` | `electron/test-search.ts` | Standalone test not in test runner |
| `split-logos.js` | `src/assets/logos/split-logos.js` | Build utility script with console.logs |
| V1 DROP TABLE statements | `connection.ts:52-57` | V1 is gone; these can be removed after one release cycle |
| `data-model.html` | `fractals/docs/data-model.html` | Untracked file |
| `QA-AUDIT.md` | root | Previous QA cycle artifact |
| `swatches.svg` | root | Untracked design asset |

---

## 14. ACCESSIBILITY

**Severity: P2**

### 14.1 No ARIA Labels on Interactive Elements

Cards, buttons, and navigation items use icon-only UI without `aria-label`. Screen readers would announce generic "button" for most interactive elements.

### 14.2 Focus Management on Panel Open/Close

When `SlidePanel` opens (content detail, settings, sources), focus doesn't appear to be trapped inside. Tabbing could move focus behind the panel.

### 14.3 No `role` Attributes on Custom Components

Grids, sidebars, and navigation use `<div>` without semantic roles. The NavRail should be `<nav>`, the sidebar could be `<aside>`, grids should have `role="grid"`.

### 14.4 Color-Only Information

Source identity is communicated solely through color dots/bars. No text labels or patterns for colorblind users to distinguish sources.

---

## SUMMARY — TOP 10 PRIORITIES

| # | Issue | Severity | Effort |
|---|-------|----------|--------|
| 1 | TypeScript not actually checking (`tsconfig.node.json` broken) | P0 | Small |
| 2 | 130+ `as any` — entire IPC layer untyped | P1 | Large |
| 3 | Hardcoded TMDB API key in source | P0 | Small |
| 4 | Credential URL construction in renderer | P1 | Medium |
| 5 | IPC event listener `removeAllListeners` bug | P1 | Small |
| 6 | Duplicate card components (browse/ vs cards/) | P2 | Medium |
| 7 | Font loading — selected fonts not actually available | P1 | Medium |
| 8 | PlayerOverlay.tsx god component (986 lines) | P2 | Large |
| 9 | FTS rebuild deletes-then-rebuilds (crash = no search) | P1 | Medium |
| 10 | Excessive production console.log in handlers | P2 | Small |

---

## 15. ELECTRON SECURITY — SANDBOX & WEB SECURITY DISABLED

**Severity: P0**

### 15.1 Sandbox Disabled

`main.ts:21`: `sandbox: false` disables Electron's process sandbox, allowing direct OS resource access from the renderer if compromised.

### 15.2 Web Security Disabled

`main.ts:23`: `webSecurity: false` disables CORS and origin checks. Comment says this is for cross-origin IPTV streams with HLS.js, but it means any renderer-level vulnerability can bypass all origin restrictions.

### 15.3 M3U Path Traversal

`m3u.service.ts:21-29`: Local M3U file paths are not validated or normalized. `file:///etc/passwd` or path traversal attacks are possible via crafted M3U URLs. Should use `path.resolve()` and validate within user data directory.

---

## 16. DATA INTEGRITY — USER DATA MUTATIONS

**Severity: P0**

### 16.1 Missing `profile_id` in user_data INSERT Statements

`handlers.ts:939-947`: The `user:set-position` handler INSERT does not specify `profile_id`:
```sql
INSERT INTO user_data (canonical_id, watch_position, last_watched_at)
VALUES (?, ?, unixepoch())
ON CONFLICT(canonical_id, profile_id) DO UPDATE SET ...
```

The PRIMARY KEY is `(canonical_id, profile_id)` but `profile_id` is not provided. SQLite inserts NULL, violating the NOT NULL DEFAULT 'default' constraint. This likely affects **all user:* write handlers** (toggle-favorite, toggle-watchlist, set-completed, set-rating).

**Impact:** Watch position, favorites, and watchlist operations may silently fail or create orphaned rows.

### 16.2 No Concurrent Sync Lock

`handlers.ts:390-474`: Multiple `sources:sync` calls can run on the same source simultaneously — no in-memory lock prevents it. Two workers writing to the same streams/canonical tables create race conditions on INSERT OR REPLACE.

### 16.3 Partial Sync Not Transactional

`sync.worker.ts:195-217`: Individual batches are transacted, but the full sync operation is not. A crash mid-sync leaves partial data persisted (e.g., 2500 of 5000 items) with no rollback or idempotency mechanism.

---

## 17. LOGIC BUGS — SPECIFIC FINDINGS

**Severity: P1**

### 17.1 `HomeView.tsx:734` — Wrong Boolean Operator for `isFetching`

```ts
const isFetching = liveFetching && movieFetching && seriesFetching
```

Uses AND — all three must be fetching for the spinner to show. Should be OR. User sees "No results" flash while individual queries are still loading.

### 17.2 `SeriesDetail.tsx:70-72` — Season Sort is String-Based

```ts
seasonKeys.sort()
```

Sorts season numbers as strings: `["0", "1", "10", "2", "3"]`. Season 10+ appears before Season 2. Should use `seasonKeys.sort((a, b) => Number(a) - Number(b))`.

### 17.3 `PosterCard.tsx` (both versions) — NaN Progress Bar

```ts
progressPct = Math.min(100, (userData.last_position / (item.runtime * 60)) * 100)
```

If `item.runtime` is 0 or undefined, division produces NaN. The progress bar renders with `width: NaN%`.

### 17.4 `EpisodeRow.tsx:163-169` — Style Tag Injection on Every Render

Injects a `<style>` tag with `episodeBarPulse` keyframes every time `isPlaying === true`. Re-renders with `isPlaying=true` create duplicate style tags that accumulate in the DOM.

### 17.5 `CardActions.tsx:98` — Missing `pulse` Keyframe

```ts
animation: confirmUnfav ? 'pulse 0.4s ease' : 'none'
```

The `pulse` keyframes referenced here are never defined. The animation silently does nothing. (Note: `globals.css` has a `pulse` keyframe at line 298, but it uses opacity 0.3-1.0, not the expected scale/color effect for a confirm-unfavorite action.)

### 17.6 `EpgGuide.tsx:77` — Unstable useCallback Dependency

```ts
useCallback(..., [allChannelIds.join(','), windowStart])
```

`.join(',')` creates a new string every render, defeating memoization. The callback recreates on every render, potentially causing infinite fetch loops.

### 17.7 `ErrorBoundary.tsx` — Uses Legacy Color Tokens

Uses `var(--color-bg)`, `var(--color-error)`, `var(--color-text-secondary)` instead of V2 tokens. Will render with wrong colors in light theme.

### 17.8 NavRail.tsx — Dev Feature in Production

Comment says "DEV: theme toggle — remove before ship" but the toggle renders unconditionally. Should be wrapped in `process.env.NODE_ENV === 'development'`.

---

## 18. KEYBOARD & CARD ACCESSIBILITY

**Severity: P2**

### 18.1 Cards Not Keyboard Accessible

All card components (`ChannelCard`, `PosterCard`, `ContinueCard`, `EpisodeRow`, `ContentCard`) are clickable `<div>` elements without `role="button"`, `tabIndex={0}`, or `onKeyDown` handlers. Users cannot Tab-navigate or Enter-activate cards.

### 18.2 Sort/Filter Dropdowns Missing Escape Handler

`BrowseView.tsx:83-88`, `BrowseViewH.tsx:85-91`, `BrowseSidebar.tsx:140-172`: Sort menus close on outside click only — no Escape key support, conflicting with the app-level Escape layering system.

### 18.3 SlidePanel Missing `aria-labelledby`

`SlidePanel.tsx`: Has `role="dialog"` but no `aria-labelledby` or `aria-label`. Screen readers can't announce the dialog's purpose.

---

## REVISED SUMMARY — TOP 15 PRIORITIES

| # | Issue | Severity | Effort |
|---|-------|----------|--------|
| 1 | Missing `profile_id` in user_data writes (position/fav/watchlist broken) | P0 | Small |
| 2 | TypeScript not actually checking (`tsconfig.node.json` broken) | P0 | Small |
| 3 | Electron sandbox disabled + webSecurity disabled | P0 | Medium |
| 4 | Hardcoded TMDB API key in source | P0 | Small |
| 5 | 130+ `as any` — entire IPC layer untyped | P1 | Large |
| 6 | `HomeView` isFetching uses AND instead of OR (flash "no results") | P1 | Small |
| 7 | Season sort is string-based (Season 10 before Season 2) | P1 | Small |
| 8 | IPC event listener `removeAllListeners` kills sibling listeners | P1 | Small |
| 9 | Credential URL construction in renderer process | P1 | Medium |
| 10 | M3U path traversal vulnerability | P1 | Small |
| 11 | NaN progress bars when runtime is 0/undefined | P1 | Small |
| 12 | FTS rebuild deletes-then-rebuilds (crash = no search) | P1 | Medium |
| 13 | Font loading — selected fonts not available on most systems | P1 | Medium |
| 14 | No concurrent sync lock (duplicate worker data corruption) | P1 | Medium |
| 15 | Duplicate card/browse components (maintenance burden) | P2 | Medium |

---

*Report generated by comprehensive static analysis (5 parallel audit agents + manual review). No changes made — all findings are observational.*
