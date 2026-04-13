# Feature Buckets

Six-bucket taxonomy for all feature work. Updated 2026-04-14.

## Bucket map

| # | Bucket | Status |
|---|--------|--------|
| 1 | Data & Search | Active — g3 Phase 1 in integration, Phase 2 pending |
| 2 | Product shape | Discussion only, no build |
| 3 | Source management | Partially done (7-step manual pipeline in progress) |
| 4 | Multi-platform reach | Phase 3, not started |
| 5 | Experience polish | Open, independent — episode 404 hang, timeshift, design system |
| 6 | Tech health | Backlog — profile_id missing, tsconfig broken, ~130 `as any` casts |

## What shipped recently (bucket 1 + 3, 2026-04-11 → 2026-04-14)

### Search & UI (bucket 1)
- Per-tab search isolation: `queries: Record<string, string>` keyed by `activeView`
- `lastQueries` persists last query; BrowseSidebar shows `Search (string)` restore entry
- Server-side search pagination (`SEARCH_TOTAL_CAP=2000`, returns `{items, total}`)
- Favorites search: client-side filter; `isSearchFetching` prevents empty-state flash
- "More →" from Home seeds target tab query via `seedQuery()`
- CommandBar: unified input, `@` ADV amber chip (always visible, 92px left pad), sort button with icon+label, source dots 12px
- Category filter per-view: `categoryFilters: Record<string, string|null>`; `setView`/`goBack` no longer reset
- LiveSplitView search breadcrumb: `Search "bbc"` pill when arriving from search
- g2 FTS5 on streams + series_sources with ligature folding at index + query time
- g3 canonical layer with two-pass match, `canonical_fts`, badges configurable per Settings → Data

### Source management (bucket 3)
- Cancel sync: `sources:sync:cancel` IPC, terminates worker, resets status
- Run in background: dialog dismisses, worker keeps running, SourceCard shows progress via App.tsx global listener
- `activeSyncWorkers` map in `handlers.ts` tracks running workers by `sourceId`
- 7-step manual pipeline (in progress): Test → Add → Sync → Fetch EPG → Index VoD FTS → Fetch iptv-org → Build Canonical → Canonical FTS
- Step badges on SourceCard buttons
- Terminal logging in IPC handlers per button press
- Test button gets primary styling in Add Source dialog when Add is disabled

## Queued / deferred

- **Series full-page view** (bucket 5)
- **Episode 404 hang** (bucket 5) — see [open-bugs.md](open-bugs.md)
- **Tech health P0 sweep** (bucket 6)
- **Enrichment end-to-end** (bucket 3) — deferred
- **Pass 2 redesign** — substring match with country tiebreaker; see [manual-pipeline.md](manual-pipeline.md)
- **Group View** — hidden from UI until Pass 2 density improves
- **g3 Phase 2 — VoD keyless canonical** (bucket 1)
- **Flatten canonical into streams** (bucket 1/6) — possible next direction if canonical joins keep hurting browse perf
