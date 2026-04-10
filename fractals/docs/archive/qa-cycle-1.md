# FractalTV QA Audit Report

Aggressive, no-mercy sweep of the entire application. Organized by severity.

---

## CRITICAL — Bugs & Data Loss Risks

- [ ] **1. Sync timeout silently drops entire content types** — `electron/workers/sync.worker.ts:41-56` — `fetchJson()` returns `[]` on timeout/error instead of throwing. If the live stream fetch times out (common with 50k+ channel providers), the entire live category is silently lost — user sees 0 channels with no error. Same for movies and series independently. No retry, no warning.

- [ ] **2. Optimistic favorite/watchlist toggle has no rollback** — `src/stores/user.store.ts` + card components — The heart/bookmark toggle updates the UI optimistically, but if the IPC call fails (DB locked, FK violation), the UI stays in the wrong state. No `.catch()` rollback.

- [ ] **3. Resume prompt races the player load** — `src/components/player/PlayerOverlay.tsx:370-374` — Resume prompt fires a seek after 5s timeout, but player has a 12s load timeout. If player isn't ready when the 5s timer fires, the seek does nothing. User loses their resume position.

- [ ] **4. Sync + delete race condition** — If user starts sync then deletes the source before sync completes, the delete worker cascades all rows away. The sync worker then tries to INSERT streams with FK to the deleted source — silent FK violations, potential batch corruption.

- [ ] **5. Import doesn't validate user_data canonical_id references** — `electron/ipc/handlers.ts:169-171` — After factory reset + import, canonical rows don't exist yet (created by sync). User_data rows are orphaned — favorites and watch history silently vanish because old canonical_ids don't match new ones.

---

## HIGH — Workflow & UX Gaps

- [ ] **6. No stale data cleanup on re-sync** — `electron/workers/sync.worker.ts` — Sync uses `ON CONFLICT DO UPDATE` — adds and updates, never deletes. If a provider removes 500 channels, those channels persist forever. Only fix: delete source and re-add.

- [ ] **7. Dead code: 3 orphaned component files (1,414 lines)** — `src/components/search/SearchBar.tsx` (204 lines), `src/components/content/ContentDetail.tsx` (856 lines), `src/components/content/SeriesView.tsx` (354 lines) — none imported anywhere. Ship in bundle.

- [ ] **8. No confirmation before source deletion** — `src/App.tsx:157-162` — `handleRemove` calls `api.sources.remove(sourceId)` directly. No "Are you sure?" dialog. One mis-click = all streams, categories gone.

- [ ] **9. TMDB API key not validated before save** — `src/components/settings/SettingsPanel.tsx:682-696` — Key stored immediately, no test request. User starts enrichment with bad key → every item fails silently.

- [ ] **10. Channel surfer race condition** — `src/stores/app.store.ts:111-119` — `surfChannel()` reads state via `getState()` outside setter. Rapid arrow key mashing can read stale `channelSurfIndex`, causing channel skips or repeats.

- [ ] **11. EPG now/next fetch has no error handling** — `src/components/player/PlayerOverlay.tsx:52-58` — 60s refresh interval swallows errors (`.then()` with no `.catch()`). Stale data persists until next interval. No retry.

---

## MEDIUM — Design & Aesthetic Issues

- [ ] **12. No loading skeleton for browse grid** — Grid shows blank area during data load. CSS defines shimmer/pulse animations (`globals.css`) but they're unused in browse/grid components.

- [ ] **13. TMDB link is not clickable** — `src/components/settings/SettingsPanel.tsx:679` — "themoviedb.org/settings/api" rendered as `<span>` with accent color — looks like a link but isn't one.

- [ ] **14. No visual feedback during source deletion** — `App.tsx` `handleRemove` has no loading state. User clicks delete → nothing for 1-5s → source vanishes.

- [ ] **15. No "save" indicator for TMDB key** — Key input saves silently. No confirmation, no checkmark. User can't tell if key was persisted.

- [ ] **16. SlidePanel lacks `role="dialog"` and `aria-modal`** — `src/components/layout/SlidePanel.tsx` — Functionally a modal but screen readers don't announce it as one.

- [ ] **17. Source color is the only multi-source indicator** — 3px left-border color stripe is the sole source indicator. No text fallback for color vision deficiency (8% of males).

- [ ] **18. No empty state for disabled source content** — Disabled source content quietly disappears from browse. No explanation. Should show banner.

---

## LOW — Code Quality & Minor Issues

- [ ] **19. `buildColorMapFromSources()` on every render** — `src/components/player/PlayerOverlay.tsx:44` — Rebuilds color map object every render. Should be `useMemo`.

- [ ] **20. Duplicate `fmt` time formatter** — `src/components/player/PlayerOverlay.tsx:122-128` — `fmt()` duplicates `fmtTime()` at line 294. Same logic, different names, same file.

- [ ] **21. HLS error recovery is one-shot only** — `src/components/player/PlayerOverlay.tsx:244-253` — Network/media recovery fire once each via boolean flags. Second hiccup = fatal error. Should allow 3+ attempts.

- [ ] **22. `controlsMode === 'always'` sends `autoHide: 0`** — `src/components/player/PlayerOverlay.tsx:194-198` — ArtPlayer interprets `0` as falsy → default behavior. Should be `autoHide: false`.

- [ ] **23. `isAudioOnly` stale closure** — `src/components/player/PlayerOverlay.tsx:278-279` — Captured from render closure, stale between loadedmetadata and 3s fallback. Should use a ref.

- [ ] **24. No image lazy loading** — PosterCard/ChannelCard `<img>` tags lack `loading="lazy"`. 60+ images load immediately on initial viewport.

- [ ] **25. Factory reset migration flag exclusion is brittle** — `electron/ipc/handlers.ts:193` — Hardcoded `NOT IN (...)` list. Future migrations must remember to update. Should use `WHERE key NOT LIKE 'migration_%'`.

- [ ] **26. Sync worker dumps debug JSON to disk** — `electron/workers/sync.worker.ts:241-253` — Writes to `~/.fractals/sync-dumps/` every sync. Dev artifact shipping to prod. Grows unboundedly.

- [ ] **27. Module-level `queryClient`** — `src/App.tsx:23-25` — Persists across React hot reloads in dev, causing stale cache. Minor in prod, annoying in dev.

---

## COSMETIC / NITPICKS

- [ ] **28. Light theme undertested** — Many inline styles use hardcoded dark-friendly colors (`rgba(255,255,255,0.07)`, `#000` backgrounds). Won't adapt to light theme.

- [ ] **29. Export filename lacks time component** — `fractals-backup-2026-04-10.json` — Two exports same day get same default name.

- [ ] **30. `any` type abuse in IPC handlers** — `handlers.ts` uses `as any` extensively for DB results. No runtime shape validation.

---

## Summary

| Severity | Count |
|----------|-------|
| Critical | 5 |
| High | 6 |
| Medium | 7 |
| Low | 9 |
| Cosmetic | 3 |
| **Total** | **30** |
