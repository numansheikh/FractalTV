# Fractals — BACKLOG

_Last full prune + reprioritization: 2026-04-19 (post g3 code sweep + test suite)._

Single source of truth for **actionable work**: bugs, gaps, planned features, code debt.
Strategic roadmap + shipped history lives in [`PLAN.md`](PLAN.md).
Reference docs (API formats, strategy, competitors): [`docs/reference/`](docs/reference/).

**Priority order (from user-visible pain → long-term hygiene):**
1. Integration / error handling (user-visible failure modes)
2. UI / UX polish (nav, empty states, copy, right-click)
3. Accessibility (ARIA, focus trap, keyboard grid)
4. Code sweep (debt)
5. Testing & integrity
6. Parked / future (visual revamp, g4+ Capacitor, security notes)

**Legend:** `P0` breaks a feature · `P1` severe UX/integrity friction · `P2` quality/debt · `P3` nice-to-have.

**Priority order for g4 opening:**
1. P1 correctness first: React Query invalidation audit, enrichment-vod tests, fixture files
2. P2 quality: exhaustive-deps triage, store tests, Playwright e2e, design token pass
3. libmpv: unlocks AVI/MKV/audio-track switching on desktop; defines PlayerAdapter interface shape for all g4 platform work
4. Capacitor scaffold: Android/iOS first platform after Electron
5. PlayerAdapter + TV web apps: ExoPlayer (Android), AVPlayer (iOS), AVPlay/Luna/OIPF (Tizen/Vega/webOS)

**Next actionable** (discuss before starting):
- §6 React Query invalidation audit (P1) — correctness bug, should go first
- §6 enrichment-vod tests (P1) — algo dispatch + confidence scoring
- §3 libmpv (P2) — first g4 foundation piece

---

## 1. Shipped history (recent)

### 1.0 Session 2026-04-18 (perf + NSFW override batch)

- [x] **`applyNsfwFlags` clobbers manual NSFW toggles** (was §2 #2). New `category_overrides` table keyed on `(source_id, content_type, category_external_id)` persists user toggles across resync (category rows CASCADE but external_ids are stable). `applyNsfwFlags` now reapplies overrides last so user intent wins over iptv-org rules. `categories:set-nsfw` UPSERTs into the override table in a tx. `schema.g1c.sql.ts`, `handlers.ts`.
- [x] **Performance profiling — static pass** (was §2 #1). Two-batch renderer + SQL optimization. Batch 1: `PosterCard` wrapped in `memo()` + direct `_colorMap[primarySourceId]` selector (was calling `buildColorMapFromSources(sources)` per render); `BrowseView` store subscriptions narrowed to per-field selectors, `PAGE_SIZE` / `SEARCH_LIMIT_DEFAULTS` hoisted to module level, `allVisibleIds` memoized. Batch 2: composite indexes `(source_id, added_at DESC)` on channels/movies/series; module-level `enabledSourcesCache: Set<string>` with `getEnabledSourceIds` / `invalidateEnabledSources` — three hot callers (`search:query`, `categories:list`, `content:browse`) now read from cache, invalidated on add/remove/toggle/import/factory-reset. Runtime instrumentation deferred. `ContentCard` + `BrowseViewH` discovered dead, deferred to §5.1.

### 1.1 Session 2026-04-18 (§2/§3 resilience batch)

- [x] **Episode surf Prev regression** (was §2 #1). Compute surf index live from `localContent.id` in the overlay render — store's `episodeSurfIndex` only updates on surf actions, so going stale when the user clicks a specific episode. `PlayerOverlay.tsx`.
- [x] **Export worker bundling** (was §2 #2). Added `export.worker` entry to `electron.vite.config.ts` main build. Missing artifact was breaking the shipped Export Playlist feature.
- [x] **Xtream error disambiguation** (was §2 #4). `testConnection` now returns `{ success, kind: 'auth' | 'network' | 'server' | 'unknown', error? }` — detects 401/403, 5xx, ENOTFOUND/ECONNREFUSED/timeout/fetch failed. `electron/services/xtream.service.ts`.
- [x] **M3U 404 preserves last-good snapshot** (was §2 #5). Schema guard after `parseM3u` refuses to wipe on empty/unplayable parse; catch block keeps `status='active'` with staleness `last_error` if existing content survives, else `status='error'`. `electron/workers/m3u-sync.worker.ts`.
- [x] **Replace-all schema validation** (was §2 #9). Xtream sync prefetches all three content streams before the wipe; if all three error, throws before any DELETE. Same last-good-snapshot catch pattern as M3U. `electron/workers/sync.worker.ts`. iptv-org + EPG verified already safe (pre-wipe `validateAll` + `<programme>`/`<channel>` tag count check).
- [x] **Staleness banner in SourceCard** (companion to M3U/Xtream snapshot preservation). Yellow warning banner when `status='active' && lastError` present; red error banner unchanged. `App.tsx` sync-error handler re-fetches sources list instead of force-setting `error`.
- [x] **iptv-org snapshot validate** (was §2 #6). Verified existing `validateAll(payloads)` guard + `replaceAll` transaction (DELETE+INSERT with rollback) already satisfies the spec. No change needed.
- [x] **TMDB rate-limit backoff** (was §2 #7). Retry-After-aware loop (3 retries, 8s max per attempt), 10-minute module-level lockout after exhaustion, listener broadcast `enrichment:tmdb-rate-limit` via `BrowserWindow.getAllWindows()`. `electron/services/enrichment-vod/sources/tmdb.ts`, wired in `ipc/handlers.ts`.
- [x] **Playback-failed overlay polish** (was §3 #1). Backdrop dim (`rgba(0,0,0,0.72)`), scoped `<style>` hides ArtPlayer's `.art-mask`/`.art-loading` while the error overlay is up. Button regroup: `[Retry][Go back] | [MPV][VLC] | ⓘ` with vertical-rule separators. Copy URL removed; Stream info is now an icon-only circle button. `PlayerOverlay.tsx`.
- [x] **SourceCard cleanup** (was §3 #2). EPG button relabeled "Refresh EPG" / "Refreshing…" (clearer intent post auto-chain). Enrich VoD button, progress bar, result banner, handler, and derived state removed — auto-enrichment on detail-panel open handles the need. `SourceCard.tsx`.

### 1.2 Session 2026-04-18 (evening)

- [x] **M3U `url-tvg` silent skip** (was §2.2 #2). Warning in worker + "No EPG URL in playlist" info pill on source card. `m3u-sync.worker.ts`, `SourceCard.tsx`.
- [x] **Stream-failure overlay rethink** (was §2.3 #1). Kill 12s timeout race during HLS backoff · Retry · Open in MPV / VLC (detection-gated) · Copy stream URL. `PlayerOverlay.tsx`.
- [x] **Resume countdown ring** (was §2.3 #5). Conic-gradient drain animation (`@property --drain` + `@keyframes drain`) on Resume button. `PlayerOverlay.tsx`, `globals.css`.
- [x] **Copy stream URL context menus** (new). Right-click on MovieDetail / ChannelDetail / EpisodeRow (series). Shared `CopyUrlContext` + `resolveStreamUrl` helper. Not previously backlogged.
- [x] **Export Playlist feature** (new). Settings → Data → "Export as .m3u". Tri-state tree picker with cascade; series categories flatten to per-episode (on-demand `get_series_info` prefetch). Worker phases: resolving → fetching_series → writing → done. Not previously backlogged.

### 1.4 Session 2026-04-19 (g3 code sweep + test suite)

- [x] **§5.1 Dead code removal.** `metadataProgress`/`metadataResult` store fields + `metadata:progress` useEffect + `isPopulatingMetadata` nav var deleted. `preload.ts` orphan APIs (`populateMetadata`, `enrichment` stub, `matchSource`) removed. `api.ts` purged of `populateMetadata`, `matchSource`, `enrichment` namespace.
- [x] **§5.2 `as any` elimination (IPC + player layer).** `api.ts`: 57 window.api casts → direct access (window.d.ts was already the type source). `handlers/shared.ts`: `SourceRow` + 4 user-data row interfaces; all handler `.get()` / `.all()` typed. `PlayerOverlay.tsx`: `ArtWithHls` local type replaces all `(art as any)` casts; error callback fixed.
- [x] **§5.3 Silent catch audit.** 33 instances reviewed; 1 genuine swallow fixed (`handleTmdbInvalidKey` persist in `enrichment-vod/index.ts` now `console.warn`s). Rest confirmed intentional.
- [x] **§5.4 `handlers.ts` split.** 2,671-line monolith → 22-line orchestrator + 8 domain files (`shared.ts`, `sources.ts`, `sync.ts`, `epg.ts`, `search.ts`, `content.ts`, `enrichment.ts`, `settings.ts`). Typecheck clean.
- [x] **§6 Unit test suite — 5 modules, 125 tests.** `normalize.ts` (11), `title-parser.ts` (38), `adv-query-parser.ts` (26), `m3u-parser.ts` (27), `export-selection.ts` (23). All green. `vitest.config.ts` created with node environment + path aliases.

### 1.3 Earlier 2026-04-18

- [x] **Build-health batches 1/2** (§1.1 + §1.2). ESLint 9 flat config, `manualChunks` (2,648 → 295 kB main), `ELECTRON_RENDERER_URL`, 11 orphan `.d.ts` cleaned, 41 `exhaustive-deps` warnings surfaced.
- [x] **Post-sync auto-chain** (`090fb53b`). `runPostSyncChain`: iptv-org match → NSFW flags → populate metadata. Cancellable on re-sync.
- [x] **Resync user-data wipe confirmation.** `window.confirm()` on re-sync of `synced|epg_fetched` sources.
- [x] **Orphan categories cleanup.** Both sync workers now `DELETE FROM {cat_table} WHERE id NOT IN …` before final done.
- [x] **Xtream `get_short_epg` on-demand fallback.** `fetchShortEpgForChannel` + `epg:fetch-short` IPC gated by 1h cache. Hook in `LiveView` `EpgStrip`.
- [x] **Sync progress UI survives card collapse.** `epgSyncing` / `epgResult` lifted to sources store.
- [x] **TMDB invalid-key graceful degrade.** `TmdbInvalidKeyError` → flip `tmdb_key_invalid=1`, demote `enrichment_level=1`, broadcast `enrichment:tmdb-invalid`, banner until user edits key.
- [x] **"Not this film?" picker — use auto-pick.** Added "Use auto-pick (top match)" → `vodEnrich.reset`.
- [x] **TVmaze/TMDB session-guard.** Module-scope `Set` prevents repeat augment on every detail open.
- [x] **Enrichment skeleton.** Pulse skeleton in `CastPanel` when `loading && cast.length === 0`.
- [x] **Re-enrich action** in detail-panel footer.
- [x] **ADV-search placeholder cycling** (`Search…` → `Try @ 2020` → …).
- [x] **Empty search result state** with ADV tip.
- [x] **Search < 2-char defense-in-depth** in `search:query` handler.
- [x] **Episode surf flattens across seasons**; pills disable only at true series boundaries.
- [x] **Mute state persists** (`fractals-muted`).
- [x] **Mini player clamps to viewport** on mount + resize.
- [x] **`[` / `]` channel surf guarded from input focus.**
- [x] **Catchup / timeshift** audit — already wired end-to-end.

_Everything below is still open._

---

## 2. Integration / error handling (top priority — user-visible failure modes)

_No open items in this bucket. Remaining perf work (runtime instrumentation for IPC timing, React Profiler capture) deferred — revisit only if users report lag._

---

## 3. UI / UX polish

- [x] **Background enrichment of visible Browse cards** (P2, 2026-04-18). `enrichSingle(contentId, force, maxLevel?)` gained a `maxLevel` param that caps the effective enrichment level (setting is respected as upper bound). New IPC `vodEnrich:prefetchVisible(contentIds)` / `vodEnrich:cancelPrefetch` — module-level `prefetchEpoch` counter; each call bumps it, cancelling the previous loop on the next iteration. Loop runs sequential `enrichSingle(id, false, '1')` with `setImmediate` yields between items, silent-catch per item. `VirtualGrid.tsx` derives visible IDs from the virtualizer's `getVirtualItems()` + rows, debounces 400ms on range change, skips `contentType === 'live'`, and cancels on unmount. Session-guard `Set`s (`tvmazeAugmentedThisSession`, `tmdbAugmentedThisSession`) + algo-version skip in `enrichSingle` dedupe for free. Level 2 TMDB stays on-demand — the `maxLevel='1'` cap protects user quota.
- [x] **viewHistory stack (Escape → goBack) audit** (P2, 2026-04-18). Walked all 11 `keydown` listeners: 8 overlay Escape handlers (App `ShortcutsOverlay`, `SlidePanel`, `EnrichmentPicker`, `PlayerOverlay`, `ContextMenu`, `CopyUrlMenu`, `AddSourceForm`, `LiveView`) all correctly use capture phase + `stopImmediatePropagation`. Remaining 3 (App global, `HomeView`, `CommandBar`) are app-level shortcut listeners (Cmd+1-5, `/`, Cmd+K) that don't handle Escape — intentionally not capture. No code change required.
- [x] **Scroll restoration on back navigation** (P2, 2026-04-18). Already satisfied. `VirtualGrid.tsx` has module-level `scrollCache: Map<string, number>` with restoration `useEffect` on `scrollKey` / `items.length > 0` and an `onScroll` writer. `ContentArea.tsx:322` passes `scrollKey={`${activeView}-${categoryFilter ?? ''}`}`. Detail panels are overlays (rendered alongside grid in `App.tsx:461-491`, not replacing it) — grid stays mounted so DOM preserves scroll through panel open/close without needing the cache. Cache covers the view/category-switch remount case. No code change required.
- [x] **Breadcrumbs clickability** (P3, 2026-04-18). `DetailShell.BreadcrumbItem` interface requires `onClick: () => void` — TypeScript enforces every segment has a handler. All three detail panels (Movie / Series / Channel) wire Source / Type / Category segments through `onNavigate` → `handleBreadcrumbNav` in `App.tsx` → `setView` + `toggleSourceFilter` / `setCategoryFilter`. Every segment routes. No code change required.
- [x] **F from mini player doesn't go fullscreen** (P2, 2026-04-18). `PlayerOverlay.tsx` mini-mode early return now bifurcates: F → `onExpand()` (promotes mini → fullscreen), other keys still return. OS-fullscreen toggle remains gated to fullscreen mode.
- [x] **Empty / error states** (P2, bundle, 2026-04-18).
  - [x] No sources added → empty state CTA "Add your first source". Already in place at `ContentArea.tsx:265-275` with `onAddSource` button and ⌘, hint.
  - [x] Source added, sync failed → error card. Already in place: `SourceCard.tsx:432-442` renders a red banner on `status='error' + lastError`; step-2 Sync button doubles as retry (same pipeline button, user clicks it again).
  - [x] Offline detection → NavRail indicator. Added `navigator.onLine` + `online`/`offline` listeners in `NavRail.tsx`; shows a red slashed-wifi icon above the theme toggle while offline.
  - [x] Network error during detail load → retry button. `SeriesDetail.tsx` episode fetch (`api.series.getInfo`) now exposes `isError` + `refetch`; renders an error line with a Retry button in the episodes column instead of perpetual spinner + "No episodes found" fallback. MovieDetail / ChannelDetail don't block on network (enrichment is silent-fallback, channel schedule is pre-synced) — no change needed.
- [ ] **libmpv embedded player for Electron** (P2). VOD on this provider is 100% direct files (272k MKV, 133k MP4, 1.5k TS — zero HLS). Chromium cannot switch audio tracks on direct files, and cannot play AVI at all. libmpv embedded via native Node addon renders into the player container, replacing ArtPlayer for direct-file streams. HLS streams stay on ArtPlayer + HLS.js. Shape: detect stream type on load → route to libmpv (direct files) or ArtPlayer (HLS). React overlay (controls, OSD, chips, badges) stays on top unchanged. Audio/subtitle track badges then work for MKV/MP4/AVI VOD on desktop. On Android/Fire TV: ExoPlayer handles this (g4). On Tizen/Vega/webOS: AVPlay/OIPF/Luna native player APIs handle it from within the web app (g4 TV layer).
- [ ] **"Open in MPV/VLC" in right-click context menu on cards** (P3). Pre-play escape hatch — right-click a VOD card → "Open in MPV" / "Open in VLC" without launching the in-app player. Bundled with §3 right-click UX pass.
- [ ] **Right-click context menus** (P3, _deferred — needs UX thought_). Category NSFW toggle exists; extending to source dots / content cards ("Hide source", "Rename", "Copy URL", etc.) needs a proper menu-shape pass before wiring.
- [x] **Copy / vocabulary audit** (P3, 2026-04-18). 8 decisions locked via interactive Q&A. Executed: "account"→"source" in 5 empty-state strings (BrowseView, ContentArea, SourcesPanel, HomeView, Sidebar delete-confirm); "account" kept only in Add Source dialog caption (Xtream onboarding warmth); M3U "playlist" kept in sync-phase labels and tech copy; `'cancelled'`→`'canceled'` (handlers.ts phase emit, App.tsx comparison, store comment, algo comment); "grey"→"gray" (globals.css comment). Repo-wide sweep found no other UK spellings. Gold standard: `docs/reference/vocabulary.md`.

---

## 4. Accessibility

- [x] **Arrow-key grid navigation** (P2, 2026-04-18). Custom navigator in `VirtualGrid.tsx`. Container `tabIndex=0` + `onKeyDown` + `outline:none`. `focusedIndex: number | null` state resets on `items` change. Arrow keys: ±1 (left/right), ±columns (up/down), clamp to `[0, items.length-1]`; Enter calls `onSelect`; `virtualizer.scrollToIndex` keeps focused row visible. `onBlur` clears focus. Each card wrapper gets `outline: 2px solid var(--accent-interactive)` when focused. Foundational for g4 TV D-pad (same as §7.2 Spatial navigation).

---

## 5. Code sweep (debt)

### 5.1 Dead code (safe removals) ✓ shipped 2026-04-19

- [x] **g1 enrichment stubs removed.** `sources.store.ts` — `metadataProgress`, `metadataResult`, `setMetadataProgress`, `setMetadataResult` deleted (initial state + implementations). `App.tsx` — four removed from destructure + `metadata:progress` useEffect deleted. `NavRail.tsx` — `isPopulatingMetadata` derived var removed; `isBusy` simplified.
- [x] **Orphaned preload APIs removed.** `electron/preload.ts` — `populateMetadata` (content object), `enrichment` stub object, `matchSource` (iptvOrg object) all removed.
- [x] **`src/lib/api.ts` purged.** `populateMetadata`, `matchSource`, `enrichment` namespace deleted. All 57 `(window.api as any).x` → `window.api.x` (`window.d.ts` was already the source of truth — casts were stale dead weight). File shrank from ~400 → 261 lines.

### 5.2 `as any` elimination ✓ partial shipped 2026-04-19

- [x] **`src/lib/api.ts`** — 57 casts eliminated (all were window.api casts).
- [x] **`electron/ipc/handlers/shared.ts`** — `SourceRow` interface + `ChannelUDRow`, `MovieUDRow`, `SeriesUDRow`, `EpisodeUDRow` row types. All handler `.get() as any` / `.all() as any[]` replaced with typed variants across `epg.ts`, `sources.ts`, `content.ts`.
- [x] **`src/components/player/PlayerOverlay.tsx`** — `ArtWithHls` local type (`Artplayer & { hls?: Hls | null; resize?: () => void; on: (...) => Artplayer }`) replacing all `(art as any)` casts. Error callback typed `(_e: unknown, msg: unknown)`.
- [ ] **Component-level casts** (P3, ~115 remaining — detail panels, browse, source cards). Extend `ContentItem` in `src/lib/types.ts` with optional dynamic fields (`_parent`, `_streamId`, etc.). Deferred to g4.

### 5.3 Silent error swallowing ✓ audited 2026-04-19

Audited all 33 instances. 1 genuine swallow fixed:
- [x] `electron/services/enrichment-vod/index.ts` — `handleTmdbInvalidKey` persist step now `console.warn`s on failure.

All other 32 are intentional resilience patterns (IPC optimistic updates, background enrichment, player reconnect). No annotation pass done yet — deferred.

- [ ] **Annotation pass** (P3) — intentional silent catches get `// Intentional: <reason>` comment. Low urgency since audit confirmed no hidden bugs.

### 5.4 `handlers.ts` split ✓ shipped 2026-04-19

- [x] **2,671-line monolith → 8 files.** `handlers.ts` is now a 22-line orchestrator. Domain files: `handlers/shared.ts` (row types), `sources.ts`, `sync.ts`, `epg.ts`, `search.ts`, `content.ts`, `enrichment.ts`, `settings.ts`. Typecheck clean.

### 5.5 Misc

- [ ] **Triage 42 `react-hooks/exhaustive-deps` warnings** (P2). Classify each: real missing-dep bug vs intentional mount-only (add inline disable + `// Intentional: <reason>`). Count is 42 as of 2026-04-19 (was 41 — one net new from PlayerOverlay error-handler fix).
- [ ] `console.log` → `console.debug` outside debug code paths (P3).
- [ ] Duplicate utilities across `MovieDetail` / `SeriesDetail` / `ChannelDetail` — extract only if 3+ panels share identical logic (P3).

---

## 6. Testing & integrity

**Current state:** **125 unit tests passing** across 5 modules. Harness: vitest + node environment, `tests/**/*.test.ts`. No e2e.

### 6.1 Shipped unit tests ✓ 2026-04-19

- [x] `tests/normalize.test.ts` — 11 tests. Diacritics (é/ü/ñ), ligatures (æ→ae / ß→ss / œ→oe), Arabic/Cyrillic passthrough, spaces + numbers.
- [x] `tests/title-parser.test.ts` — 38 tests. Prefix extraction (dash/colon/long/plain), year (valid/last/out-of-range/none), quality (4K/1080p/720p/HD/BluRay/WEB-DL/LQ), bracket stripping, NSFW scoring (hard prefix/studio/term/accumulated/innocent/single-soft), searchTitle normalization, `parseSeriesTitle` (S01E08 / S01 E08 / s1e8 / Season N Episode M / 1x08 / S01-only / plain-movie / prefix-strip).
- [x] `tests/adv-query-parser.test.ts` — 26 tests. Year/quality/language/prefix auto-detection, 2-letter ISO ambiguity guard, explicit `field:value` syntax, title fallback, multi-token, quoted strings, `buildAdvWhere` (exact/OR-fallback/LIKE/AND-join/alias).
- [x] `tests/m3u-parser.test.ts` — 27 tests. `guessType` (path + extension precedence), `extractContainerExt` (query-string strip, lowercase, no-ext), `parseM3u` (single entry, movie, EPG `url-tvg`/`x-tvg-url`, null epg, `#EXTVLCOPT` User-Agent + Referer, type detection, multi-entry, CRLF, empty, unknown directives).
- [x] `tests/export-selection.test.ts` — 23 tests. `buildNodes` (favorites root, source nodes, leaf kinds, empty-group skip), `getLeafIds`, `computeState` (unchecked/checked/partial/leaf), `toggleNode` (check-all/uncheck-all/partial→all/immutability), `countSelectedItems`, `resolveSelection` (empty/favoritesChannels/channelCategoryIds/movieCategoryIds/full).

### 6.2 Remaining test coverage

- [ ] **`electron/services/enrichment-vod/`** (P1) — algo-v1/v2/v3 dispatch, confidence scoring, per-field fallback merge, TMDB rate-limit path.
- [ ] **Stores** (P2) — `app.store`, `search.store`, `user.store` key transitions. Not every setter — focus on state machines (ingest_state, player transitions).
- [ ] **Fixture M3U / Xtream responses** (P1) — real-world samples in `tests/fixtures/` to back parser edge cases.
- [ ] **E2E smoke (Playwright)** (P2) — add source → sync → search → open detail → play → back. One happy path per content type.
- [ ] **React Query invalidation audit** (P1, known rule) — long-lived components (App.tsx, NavRail, source cards) invalidate on success, not only in effect cleanup.

---

## 7. Parked / future

### 7.1 Visual design revamp (P3 — parked 2026-04-18)

Borders + washed-out lavender feel off, but not blocking. Pick up after functional gaps, code sweep, testing, and accessibility.

- [ ] **Full design-token pass** — re-tune `--bg-0..4`, `--text-0..3`, `--border-*`, accent palette values.
- [ ] **Surface audit** — walk every visible surface (cards, detail panels, NavRail, CommandBar, sidebars, settings, overlays, player chrome) to confirm token usage and catch hardcoded colors.
- [ ] **Token audit (hardcoded colors)** — grep for hex/rgb literals that should be tokens.
- [ ] **Dark/light theme parity** — light theme adjustment block in `globals.css` needs per-surface verification after revamp.
- [ ] **Focus-ring consistency** — 2px + 2px offset everywhere; 3px on TV mode.
- [ ] **Source color dots** — verify palette ordered for maximum visual distance; add 1 regression fixture.
- [ ] **Card density at TV 1.5x scale** — grids break into 2-3 columns instead of 4-6 on 1080p TV; redo grid breakpoints.

### 7.2 Future generations (g4+)

Detailed strategy in [`docs/reference/multi-platform-strategy.md`](docs/reference/multi-platform-strategy.md).

**Decided architecture (2026-04-19):** One React codebase across all platforms. Platform differences isolated entirely to the PlayerAdapter layer — the UI (cards, panels, search, navigation) is written once and shared everywhere.

**Platform → player adapter map:**

| Platform | Adapter | Container ceiling |
|---|---|---|
| Electron (desktop) | libmpv | Universal |
| Android phone/tablet/TV | ExoPlayer + FFmpeg ext | Universal |
| iOS / iPadOS / Apple TV | AVPlayer | MP4/HLS only |
| Tizen (Samsung TV) | AVPlay API (from web app) | Near-universal |
| Vega OS (Philips TV) | OIPF player API (from web app) | Near-universal |
| LG webOS | Luna player API (from web app) | Near-universal |
| PWA / browser | ArtPlayer + HLS.js | MP4/HLS only |

TV platforms (Tizen/Vega/webOS) run the same React web app but call their proprietary native player APIs instead of `<video>` — bypassing Chromium's codec ceiling entirely. No separate native TV app needed.

iOS/Apple TV accept the codec ceiling — AVPlayer only. AVI/MKV without H.264 will not work; document clearly.

- [ ] **libmpv for Electron** — defines PlayerAdapter interface, fixes AVI/MKV on desktop now.
- [ ] **Capacitor scaffold** — Android phone → tablet → Android TV → iOS → iPadOS → Apple TV.
- [ ] **DataService interface swap** — Electron IPC → direct HTTP + `@capacitor-community/sqlite`.
- [ ] **PlayerAdapter abstraction** — implement per-platform, swap at runtime.
- [ ] **TV web app shells** — Tizen (.wgt), Vega, webOS (.ipk) — same React build, AVPlay/OIPF/Luna adapter injected.
- [ ] **Spatial navigation** — `@noriginmedia/norigin-spatial-navigation` or custom; foundational for all TV + Apple TV targets.
- [ ] **Three-tier product split** (feature flags, single codebase):
  - **M3U Player** — free, all platforms, channel organizer.
  - **Xtream Lite** — free Android, single source, TMDB enrichment.
  - **Fractals Pro** — paid, all platforms, multi-source, full features.

### 7.3 Security (noted, not blocking — local-first desktop app)

- [ ] Electron: `contextIsolation` on, `nodeIntegration` off, sandbox enabled — verify still true in `main.ts`.
- [ ] `preload.ts` contextBridge surface — audit for any renderer-reachable API that takes raw user input and interpolates into SQL or shell.
- [ ] Xtream credentials stored in plain SQLite — acceptable for desktop local-first. Note in README privacy section.
- [ ] TMDB API key in settings table — same note.
- [ ] External player paths (MPV / VLC) — validate with `which` / path-exists before exec; no user-controlled argv concatenation.

---

## Sources

- `PLAN.md` — phase map, shipped list
- `archive/code-sweep.md` — original code-sweep plan (superseded by §5)
- `archive/qa-audit.instructions.md` — original audit prompt (superseded by this doc)
- `archive/VOD-extraction.md` — original extraction prompt (superseded by `docs/reference/metadata-extraction-strategy.md`)
- git log on branch `g3`
- `fractals/CLAUDE.md` — architecture, known limitations
