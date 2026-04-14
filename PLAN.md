# Fractals — PLAN

> "Plex-quality browsing and search for IPTV content, running locally on every platform."

Architecture, tech stack, schema, conventions, design language: see `fractals/CLAUDE.md`.

---

## Phases

| Phase | Status | Scope |
|---|---|---|
| 0 | Complete | Core scaffold, DB, Xtream sync, FTS5 search, player, EPG, user data |
| 1 | Complete | UX refinement (pagination nav, Escape behavior, library search) |
| 2 | Complete | V2 data model cutover (canonical + streams, v1 dropped) |
| 2.5 | Complete | V3 data model + search (canonical split, association layer, MetadataProvider, advanced search, two-phase sync) |
| g1 | **Complete** | Strip to pure provider-data app. 12 tables. LIKE search + debounce. User data survives resync. UI polish. |
| g2 | Not started | FTS5 on streams table |
| g3 | Not started | FTS5 on canonical + bridge to streams |
| g4 | Not started | Embeddings / semantic search |
| g5 | Not started | Cross-language resolution |
| 3 | Not started | Capacitor (Android/iOS/TV), Tizen |

---

## g1c — schema redesign (DESIGN LOCKED, NOT YET IMPLEMENTED)

Branch: `g1c` (currently checked out). Sits on top of tag `g1-baseline` at commit `3cfac99c`.

This is the next implementation milestone. The design below is locked; no code has been written yet.

**15-table surface:**

- **Core (3):** `sources`, `profiles`, `settings`
- **Content (8):**
  - Channels: `channel_categories`, `channels`, `epg`
  - Movies: `movie_categories`, `movies`
  - Series: `series_categories`, `series`, `episodes`
- **User data (4):** `channel_user_data`, `movie_user_data`, `series_user_data`, `episode_user_data`
- **FTS (3, virtual):** `channel_fts`, `movie_fts`, `series_fts`

**Locked design decisions:**

1. **No canonical layer.** Multi-source dedup stays a permanent g1c tradeoff (same channel from two providers = two rows in favorites). Canonical was the biggest complexity source in the discarded g2-flat branch.
2. **`streams` split into four content tables** — `channels`, `movies`, `series`, `episodes`. No `_titles` suffix. "Title" is the user-facing label; DB names stay bare. Episodes are sub-parts of series, not Titles themselves.
3. **Categories split three ways** — `channel_categories`, `movie_categories`, `series_categories`. No shared `type` column. Episodes inherit category from parent series.
4. **No join tables for categories.** Provider reality is 1:many (single `category_id` on Xtream streams, single `group-title` on M3U). `category_id` goes directly on each content table as an FK. Drops the old `stream_categories` and `series_source_categories`.
5. **User data split four ways.** `movie_user_data` carries favorites/watchlist/rating/watch_position; `episode_user_data` carries only playback state (watch_position, completed, last_watched_at); `channel_user_data` carries favorites; `series_user_data` carries favorites/watchlist/rating.
6. **FTS baked in from the start** — `channel_fts`, `movie_fts`, `series_fts`. No episode FTS; episodes are found via parent series. Each FTS table indexes only `search_title` for now. Multi-column FTS (cast/plot/genre for movies+series, tvg_id for channels) is a future expansion when enrichment lands. Tokenizer: `unicode61 remove_diacritics 0` (normalizer already folded upstream). Storage: standalone (FTS copies `search_title`). Populated during Sync in the same transaction as the content INSERT. No triggers. Query side normalizes the user's input with the same normalizer before MATCH.
7. **EPG lives in the Content section**, not Core. EPG is channel metadata even though its FK is on `source_id` (intentional — EPG is re-fetched anyway, orphan-tolerant).
8. **Normalization stage** between content tables and FTS. `channels`, `movies`, `series` each carry a persisted `search_title` column derived from `title` at sync time. Episodes do NOT get `search_title`. Normalizer is minimal: lowercase + diacritic strip + ligature fold (æ→ae, ß→ss, œ→oe). No punctuation strip, no whitespace collapse, no leading-article strip. Column name `search_title` chosen over `normalized_title` (role-based) and `name` (rejected — collides with "primary human label" convention).
9. **Metadata columns** on each content table use the `md_` prefix (`md_country`, `md_language`, `md_year`, `md_origin`, `md_quality`). Replaces the current `language_hint` / `origin_hint` / `quality_hint` / `year_hint`. Column shape locked now; population deferred until enrichment lands.

**Migration strategy:** drop old tables and rebuild fresh. Data is expendable — users re-sync from their providers. No in-place migration.

**Status:** DESIGN LOCKED, NOT YET IMPLEMENTED. See `fractals/docs/archive/TODO.md` for the implementation task list.

---

## g1 — locked (2026-04-12)

Branch: `search-rebuild-g1`

**What shipped:**
- Stripped canonical tables, FTS, enrichment — pure provider data
- 12 tables: sources, streams, stream_categories, series_sources, series_source_categories, stream_user_data, series_user_data, channel_user_data, categories, epg, profiles, settings
- LIKE search with 250ms debounce + min 2 char threshold
- Sync preserves user data (backup/restore around CASCADE delete)
- Title normalizer extracts year/language/origin/quality hints at sync time
- Timezone override in Settings (system default toggle + manual picker)
- EPG: has_epg_data computed via EXISTS, styled description cards, 300px channel column in Full Guide
- NavRail sync pulse indicator + home screen sync status strip
- VirtualGrid dynamic sizing, breadcrumbs pinned top, category filter clearing on navigation
- Settings cleanup: enrichment hidden, grid page size picker, external player hidden

---

## g2 — next up

Branch: `search-rebuild-g2` (to be created)

**Goal:** Add FTS5 search on the streams table. Provider titles indexed, ranked search results.

**Scope (tentative):**
- FTS5 virtual table on streams (title, normalized title)
- Search handler: FTS5 first, LIKE fallback for special characters
- Hybrid ranking: FTS5 rank + recency
- Diacritic folding via FTS5 tokenizer (fixes "forg" → "Forgöraren" bug)
- Re-enable enrichment UI (TMDB metadata on detail panels)

---

## Known bugs (not blocking g1, carry forward)

- [ ] **Episode stream hang** — player infinite spinner on 404. Needs timeout + error overlay.
- [ ] **Diacritic search** — "forg" misses "Forgöraren". Will be fixed by FTS5 in g2.
- [ ] **Black screen** — occasional idle black screen requiring Cmd+R. Undiagnosed, deferred.

---

## Future / Parked Buckets

### Bucket 2 — Experience Polish

- [ ] **Series full-page view** — replace cramped SeriesDetail slide panel for long-running series
- [ ] **Timeshift bottom bar** in fullscreen player — catchup channels only
- [ ] **Design system overhaul** (parked) — borders + washed-out lavender feel off; deferred

### Bucket 3 — Tech Health

Top items:
- [ ] Missing `profile_id` in user data writes
- [ ] `tsconfig.node.json` broken
- [ ] 130+ `as any` casts across IPC layer
- [ ] Season sort is string-based (Season 10 sorts before Season 2)

### Bucket 4 — Multi-Platform Reach (Phase 3)

Order: Electron (done) → Android phone → Android TV → iOS → Tizen → PWA.

### Bucket 5 — Product Shape

Three-tier split (same React codebase, feature flags):
- **M3U Player** — free, all platforms, channel organizer
- **Xtream Lite** — free, Android only, single source, TMDB enrichment
- **Fractals Pro** — paid, all platforms, multi-source, full features

---

## Reference docs

| Doc | Purpose |
|---|---|
| `fractals/CLAUDE.md` | Architecture, tech stack, schema, conventions, design language |
| `fractals/docs/business-plan.md` | Bucket 5 — three-tier split, competitors, monetization |
| `fractals/docs/multi-platform-strategy.md` | Bucket 4 — platform priority, abstractions |
| `XtreamCodesAPI.md` | Xtream Codes API reference |

---

## Snapshot (2026-04-14)

- Phase state: g1 locked; g1c schema redesign DESIGN LOCKED, NOT YET IMPLEMENTED
- Active branch: `g1c` (on top of tag `g1-baseline` @ `3cfac99c`)
- Target DB: 15 tables — split per-type content/categories/user-data, FTS baked in, no canonical layer
- Migration: drop old tables + rebuild; user re-syncs
- Search: LIKE + debounce baseline today; g1c introduces FTS5 on `search_title` with minimal normalizer (lowercase + diacritic strip + ligature fold)
