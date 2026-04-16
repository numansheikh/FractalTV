# Fractals — TODO / Bug List

## High Priority

- [ ] **ADV search + md_* column population** — Three-phase task: (1) audit which `md_*` columns are populated at sync vs. NULL; (2) fill sync gaps — wire missing fields from Xtream API response into INSERT; (3) build ADV parser (`@` prefix, `field:value` tokenizer → WHERE clauses on `md_*` columns). Frontend `@` chip + IPC `isAdvanced` flag already wired; backend falls through to plain LIKE (stopgap, `handlers.ts:789`).

## P1 Bugs (from QA audit, 2026-04-16) — fixed 2026-04-16

- [x] `enrichTriggered` ref stays true after source delete — stale ref blocks re-enrichment
- [x] `activeSeason` not persisted — reopening Series Detail always resets to season 1
- [x] Stale `embeddedAnchor` after source delete — can leave orphan player state
- [x] `FullscreenHint` invisible — pointer-events blocked hover handler
- [x] `goBack()` depth-1 stack — replaced with `viewHistory[]` stack
- [x] Player error has no retry button — already existed, no change needed
- [x] Worker sync has no timeout — 15min timeout added
- [x] Series info fetch has no timeout — 30s AbortController added
- [x] Channel surf race condition — sequence counter guards stale responses

## P2 (friction / quality)

- [x] No loading skeleton on browse grids — already implemented in ContentArea.tsx
- [x] No empty-state illustration when search returns zero results — already implemented
- [x] EPG guide timezone label not shown — timezone badge added to EPG header
- [x] VirtualGrid scroll position lost on view switch — scrollCache + scrollKey prop wired
- [x] No keyboard shortcut help overlay (? key) — ShortcutsOverlay added to App.tsx
- [x] Category sidebar doesn't indicate item counts — already implemented in BrowseSidebar
- [x] Movie Detail panel doesn't show duration — md_runtime col + get_vod_info fetch on first open; displayed in MetadataBlock
- [x] No bulk source operations (enable/disable all) — Enable all / Disable all in SourcesPanel header
- [x] Source card doesn't show last sync timestamp in human-readable form — already implemented in SourceCard
- [x] Player volume not persisted across sessions — localStorage fractals-volume, read on init / write on change
- [ ] ~~Settings changes require manual page refresh~~ — parked
- [ ] ~~No "mark all episodes watched"~~ — parked

## Backlog

- [ ] **M3U source parity review** — M3U has been out of scope since g1. After ADV search ships, revisit: audit feature gaps vs. Xtream (sync gaps, missing md_* fields, EPG, catchup, VoD enrichment applicability), then fix in a focused pass.

## Tech Debt

- [ ] **Full code sweep** — After ADV search + M3U parity ship: comprehensive pass covering TypeScript `any` elimination (~143 casts, worst in `lib/api.ts` / `PlayerOverlay` / `ipc/handlers.ts`), dead code, logic issues, stale comments, and anything that accumulated during g2 feature work.
- [ ] ~143 `as any` casts across IPC boundary — subsumed into full code sweep above
