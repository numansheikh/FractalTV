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
| g1 | Complete | Strip to pure provider-data app. 12 tables. LIKE search + debounce. |
| g1c | **Complete** | 15-table per-type split. LIKE on `search_title` (inline at sync). Test → Sync pipeline (EPG auto-chains). |
| g2 | Future | Search improvements (possibilities listed below; no commitments) |
| 3 | Not started | Capacitor (Android/iOS/TV), Tizen |

---

## g1c — shipped

Branch: `g1c`. Drops the old 12-table g1 schema and rebuilds on 15 per-type tables. Data is expendable at cutover — users re-sync from providers.

**15 tables:**

- **Core (3):** `sources`, `profiles`, `settings`
- **Content (8):**
  - Channels: `channel_categories`, `channels`, `epg`
  - Movies: `movie_categories`, `movies`
  - Series: `series_categories`, `series`, `episodes`
- **User data (4):** `channel_user_data`, `movie_user_data`, `series_user_data`, `episode_user_data`

No FTS tables. Search is plain `LIKE '%query%'` on a `search_title` column.

**What shipped on top of the original g1c design:**

1. **FTS removed.** The original design baked in `channel_fts` / `movie_fts` / `series_fts`. Tried trigram and unicode61 tokenizers — posting lists were large, SQLite couldn't push `source_id` / `category` filters into FTS, and COUNT enumerated full match sets. LIKE + B-tree index + LIMIT short-circuits better at this catalog scale (10k–100k rows per source).
2. **`search_title` is populated inline at sync INSERT**, not via a separate Index button. `search_title = anyAscii(title).toLowerCase()` — gives bidirectional diacritic/ligature match (ae↔æ, e↔é, ss↔ß, oe↔œ). This reversed the earlier "manual button for transformational ops" preference for this specific column: it's microseconds per row, can't fail, and the Index button was blocking diacritic search from "just working" for new users.
3. **EPG auto-chains after Sync** inside the sync-done handler. EPG progress streams through the same `sync:progress` IPC channel with `phase: 'epg'` so the source card's message bar shows it inline. M3U sources skip EPG (no endpoint).
4. **Pipeline is 2 buttons: Test → Sync** (was Test → Sync → EPG → Index). The `'indexed'` ingest_state is removed from the enum; terminal state is `'epg_fetched'`. Sync button "done" shows at both `'synced'` and `'epg_fetched'` so EPG-less sources aren't stuck purple.
5. **Deleted services/code:** `electron/services/enrichment/` (iptv-org cache + Wikidata + IMDb-suggest providers), `electron/services/indexing/`, `electron/services/search/query-parser.ts`, `electron/workers/enrichment.worker.ts`, plus helper scripts `fractals/scripts/resync-from-dumps.mjs` and `sync-and-compare.mjs`. All were the canonical-layer enrichment pipeline, separate indexing worker, and old parsed-query search path — superseded by the flat LIKE-on-search_title design.
6. **User data is not preserved across resync.** Per the g1c hard cut, CASCADE on source delete/sync wipes per-source user_data. Users re-sync from providers after the schema transition.

**Normalizer (one function, two callers):** lowercase + any-ascii folding (diacritic strip + ligature fold). Sync workers call it to populate `search_title`; search handler calls it on the user's query before the LIKE comparison. No punctuation strip, no whitespace collapse, no leading-article strip.

**Ingest pipeline:**

- `ingest_state` enum: `added → tested → synced → epg_fetched`
- Test → Sync (two manual buttons on the source card)
- EPG auto-chains inside Sync for Xtream sources; M3U stops at `synced`
- Sync button "done" is true at both `synced` and `epg_fetched`

---

## g2 — future search improvements

No commitments. Possibilities when search needs more:

- Denormalize a per-title "search corpus" column (title + category + hints) so LIKE covers more than just title
- Trigram index on `search_title` for CJK / Arabic where word boundaries are fuzzy
- Ranking signals (recency, favorites-weight, source-selection) on top of LIKE
- Cross-language resolution (single Title seen under different language names)
- Embeddings / semantic search (sqlite-vec in place, worker not built)

FTS5 is **not** on this list — tried twice, rejected both times at this catalog scale. Revisit only if catalog grows past ~1M rows or there's a concrete use case LIKE can't serve.

---

## Known bugs (carry forward)

- [ ] **Black screen** — occasional idle black screen requiring Cmd+R. Undiagnosed, deferred.

---

## Future / Parked Buckets

### Bucket 2 — Experience Polish

- [ ] **Series full-page view** — replace cramped SeriesDetail slide panel for long-running series
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

- Phase state: g1 locked; **g1c shipped** (simplified past the original design — FTS removed, Index step merged into sync, pipeline reduced to 2 buttons)
- Active branch: `g1c`
- DB: 15 tables — per-type split for content/categories/user-data, no canonical, no FTS
- Search: LIKE on `search_title` (populated inline at sync via any-ascii + lowercase). No ranking, no FTS.
- Pipeline: Test → Sync. Ingest states `added → tested → synced → epg_fetched`. EPG auto-chains for Xtream sources.
