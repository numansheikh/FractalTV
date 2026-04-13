# Project Context

Fractals is a React + Electron IPTV client with a planned Capacitor mobile/TV story.

## Repo layout

- `legacy/` — frozen Angular + Electron app. Reference only, do not touch.
- `fractals/` — active app. React 19 + Vite + Electron + SQLite (better-sqlite3).
- `PLAN.md` (root) — single source of truth for phase state, QA cycles, buckets, bugs.
- `fractals/CLAUDE.md` — architecture, tech stack, schema, conventions, design language.
- `fractals/docs/archive/` — older plans (`TODO.md`, `BACKLOG.md`, `data-search-v3-plan.md`, `QA-Request.md`, `legacy-comparison.md`).

## Key branches

- `master` — stable branch (g1 locked)
- `search-rebuild-g1` — g1 baseline
- `search-rebuild-g1-g2` — g2 (FTS5 + ligature folding) on top of g1
- `search-rebuild-g1-g2-g3` — g3 (canonical layer, iptv-org) on top of g2
- `search-rebuild-g1-g2-g3-manual-pipeline` — current working branch; strips auto-chain, adds 7-step manual pipeline, browse perf fixes
- `snapshot/v0.2.1-pre-redesign` — preserved for pre-V3 rollback

## Phase state (as of 2026-04-14)

| Phase | Status | Scope |
|---|---|---|
| 0 | Complete | Core scaffold, DB, Xtream sync, FTS5 search, player, EPG, user data |
| 1 | Complete | UX refinement (pagination nav, Escape behavior, library search) |
| 2 | Complete | V2 data model cutover (canonical + streams, v1 dropped) |
| 2.5 | Complete | V3 data model + search (canonical split, advanced search, two-phase sync) |
| g1 | **Complete (2026-04-12)** | Provider-data-only app. 12 tables, LIKE search, no canonical, no FTS. |
| g2 | **Complete (2026-04-12)** | FTS5 on streams + series_sources, manual + auto indexing, ligature folding, LIKE fallback in grids. |
| g3 | **In progress** | Keyless canonical layer. Phase 1 = channels + iptv-org enrichment. Phase 2 = keyless VoD (pending). |
| g4 | Not started | Embeddings / semantic search |
| g5 | Not started | Keyed enrichment (TMDB) + cross-language resolution |
| 3 | Not started | Capacitor (Android/iOS/TV), Tizen |

## `g` numbering — cumulative

`g1/g2/g3/g4/g5` are cumulative generations, not phase labels. Each inherits everything from prior.

- g1 = baseline provider data, LIKE search, EPG, user data, player, UI polish (absorbs Phase 0–2.5)
- g2 = g1 + FTS5 primary search (ligature folding, auto-index post-sync)
- g3 = g2 + canonical identity layer + iptv-org enrichment for live channels
- g4 = g3 + embeddings / semantic search
- g5 = g4 + keyed enrichment (TMDB, cross-language)

When attributing a feature, name the generation it **entered** the stack. EPG is "in g1" even though it originated during Phase 0.

## Tiered search plan

- g1: LIKE on provider titles + 250ms debounce + min 2 chars (DONE)
- g2: FTS5 on streams + series_sources, manual per-source indexing, toggle (DONE)
- g3: FTS5 on canonical + bridge to streams (Phase 1 DONE for live; Phase 2 VoD pending)
- g4: embeddings / semantic
- g5: cross-language resolution

## Known bugs

- Episode stream hang — infinite spinner on 404 (needs timeout + error overlay)
- Black screen — occasional idle black screen, needs DevTools diagnosis (deferred)
- Search type bleeding — **FIXED 2026-04-12**, stale TanStack cache caused cross-type results
- Diacritic search — **FIXED in g2** via FTS5 unicode61 + ligature folding

Active bug list + QA backlog: `fractals/docs/archive/TODO.md`, plus `PLAN.md` QA cycle section.
