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
| g1c | **Complete** | 15-table per-type split. LIKE on `search_title` (inline at sync). Test → Sync pipeline (EPG auto-chains). VoD card redesign, vocabulary sweep, Channel Detail panel (logo/title/actions + Schedule section + EPG identity) + card Details buttons. Continue-watching invalidation bug fixed (2026-04-15). Tech cleanup: `tsconfig.node.json` fixed, Electron sandbox enabled. |
| g2 | **Complete** | iptv-org ingestion, detail panels, mini player, NSFW filtering, EPG sync, M3U parity, ADV search, TVmaze enrichment |
| g3 | Not started | TMDB enrichment, design overhaul, settings live-apply |
| g4 | Not started | Capacitor (Android/iOS/TV), Tizen, three-tier product split |

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

## Generation roadmap

### g3 — Enrichment, polish & cleanup

- TMDB/OMDb enrichment — optional API key in Settings, supplements keyless pipeline
- Visual design revamp
- Daisy-chain sync worker — auto-run Populate Metadata after sync (like EPG auto-chains)
- Full code sweep — ~143 `as any` casts, dead code, stale comments, accumulated debt

### g4 — Multi-platform & product tiers

- Capacitor: Android phone → Android TV → iOS → Tizen → PWA
- `DataService` interface swap (Electron IPC → direct HTTP + `@capacitor-community/sqlite`)
- D-pad navigation, focus management, 1.5x TV spacing
- Three-tier product split (feature flags, same codebase):
  - **M3U Player** — free, all platforms, channel organizer
  - **Xtream Lite** — free, Android only, single source, TMDB enrichment
  - **Fractals Pro** — paid, all platforms, multi-source, full features

---

## Reference docs

| Doc | Purpose |
|---|---|
| `fractals/CLAUDE.md` | Architecture, tech stack, schema, conventions, design language |
| `metadata-extraction-strategy.md` | VOD title analysis — prefix taxonomy, extraction rules, implemented as `parseTitle()` |
| `XtreamCodesAPI.md` | Xtream Codes API reference |

---

## g2 — shipped so far (branch: g2, 2026-04-17)

- **iptv-org channel DB ingestion** — 39K channel snapshot, tvg-id matching, country/category/NSFW flags
- **Unified detail panel spine** (`DetailShell`) — Channel/Movie/Series share chrome; breadcrumbs, type badge, source indicator
- **Mini player in detail panels** — 2s autoplay, pause/play, one-time prompt, `autoplay_detail` setting; all three panel types
- **PlayerOverlay reconnect overlay** — 5-attempt exponential backoff, spinner + attempt counter
- **IptvStrip siblings redesign** — list rows (dot + source + title), V+H scrollable
- **Panel visual separation** — `--bg-panel` tint + left-edge drop shadow; series left column (`--bg-panel-sub`) distinct from right
- **EPG Sync button** — explicit "EPG" pipeline step in SourceCard (Xtream only); 24h auto-refresh on startup (silent)
- **Bottom panel collapse rule** — LiveView bottom panel expanded only if EPG or iptv-org data present
- **Adult content (NSFW) filtering** — `is_nsfw` on 3 category + 3 content tables; right-click category → mark/unmark; "Allow adult content" toggle in Settings; flag propagates to content rows on mark and post-sync
- **VoD enrichment (movies + series)** — keyless (Wikipedia REST + Wikidata + IMDb suggest); algo v1 + v2; candidate rows in `movie_enrichment_g2` / `series_enrichment_g2`; `selected_enrichment_id` + `enrichment_disabled` on content rows; auto-enrich on first detail open; per-field fallback merge in MovieDetail/SeriesDetail; "Not this film?" picker (`EnrichmentPicker`); source-level enrich button
- **Movie detail duration** — `md_runtime` column on movies, lazy-fetched via `get_vod_info` on first open, persisted, `staleTime: Infinity` for instant reloads; displayed in MetadataBlock strip
- **Episode surf** — Prev/Next pills in fullscreen player for series episodes (bounded by season, no wrap). Keyboard: PgUp/PgDn + Cmd+↑/↓. `episodeSurfList`/`episodeSurfIndex` in app store, populated per-season in SeriesDetail.
- **Episode click → embedded mode** — clicking episode row loads into embedded player zone in detail panel instead of fullscreen. Top play button tracks embedded episode label, click expands to fullscreen.
- **Series resume fixes** — autoplay waits for continue-watching data before starting; season auto-select overrides cache when resume points to different season; `resume_episode_id` matching handles full content ID format; season/episode state resets on series switch.
- **Populate metadata handler** — `content:populate-metadata` IPC handler wired to `parseTitle()` in `title-parser.ts`. Batched UPDATE (1000 rows/txn) for `md_prefix`, `md_language`, `md_year`, `md_quality`, `is_nsfw` across channels/movies/series. Progress broadcast via `metadata:progress`.
- **ADV search (`@` prefix)** — tokenized query parser (`adv-query-parser.ts`). Auto-detects year (4-digit), language (English names + ISO codes), quality keywords, IPTV prefix codes. Each recognized token → `(md_* = value OR search_title LIKE '%token%')`. Unrecognized → title LIKE only. `field:value` syntax for power users (no OR fallback). All tokens AND together. ~90-entry hardcoded lookup table. Plain search (no `@`) unchanged.
- **Bug fixes** — SeriesPosterCard double-wrapped `resume_episode_id`, LibraryView unsafe `clearId` fallback, SeriesDetail dead code in resume match, MovieDetail resume label on play button.
- **M3U source parity** — two-pass series detection in sync worker (`parseSeriesTitle` + URL `/series/` classification); `series:get-info` M3U early return (DB query, no Xtream API); `content:get-stream-url` returns headers for M3U; SeriesDetail conditional Xtream vs M3U; guessType priority fix (URL path over duration); M3U EPG support (`epg_url` from `url-tvg`/`x-tvg-url`); `#EXTVLCOPT` parsing (User-Agent, Referer, Origin → `provider_metadata`); HTTP headers to HLS.js + mpv + VLC; parser consolidated to `electron/lib/m3u-parser.ts`.
- **Source toggle refresh** — individual + bulk enable/disable → `queryClient.invalidateQueries()` refreshes all views.
- **TVmaze enrichment** — free API (no key), series-only. Phase A: `tvmaze.ts` source (IMDb-first lookup, title fallback, year ±2 guard). Phase B: `mergeTvmaze()` fills status/network/rating/cast/genres/tvmaze_id; `augmentSeriesWithTvmaze()` backfills already-enriched series missing `tvmaze_id`. Displayed in MetadataBlock (rating star, network, status). `tvmaze_id` column migrated into `series_enrichment_g2` via `addTvmazeIdColumn()`.
- **Phase C — mini player overhaul** — embedded player zones removed from MovieDetail and SeriesDetail. VoD now always starts in floating mini player. Mini player is draggable (top-bar drag handle, position persisted to localStorage). Live channels keep their ChannelDetail embedded player (separate architecture).
- **Sequential TVmaze calls** — v3 enrichment runs first; TVmaze called only if v3 found a match (uses v3-resolved IMDb ID). `Promise.all` → sequential in both `enrichSingle` and `enrichForSource`. Safer for rate limits; TVmaze gets the better IMDb ID from v3.
- **Plot always full** — removed show more/show less clamp; panel scrolls.
- **Cast pills non-interactive** — pills are plain labels (no search link, not buttons).

## Snapshot (2026-04-17)

- Phase state: **g2 complete** → g3 active
- Active branch: `g3`
- DB: 15 tables + enrichment tables (`movie_enrichment_g2`, `series_enrichment_g2` with `tvmaze_id`). Per-type split for content/categories/user-data, no canonical, no FTS.
- Search: LIKE on `search_title` (plain). ADV search (`@` prefix): tokenized parser with auto-detected `md_*` filters + title LIKE fallback. No FTS.
- Pipeline: Test → Sync → Populate Metadata (manual). Ingest states `added → tested → synced → epg_fetched`. EPG auto-chains for Xtream sources.
- Security: Electron sandbox enabled, contextIsolation on, nodeIntegration off. NSFW default-off (opt-in).
- Player: episode surf (PgUp/PgDn + Cmd+↑/↓, Prev/Next pills), VoD always starts in draggable floating mini player, resume-aware autoplay.
- M3U sources: full parity with Xtream (channels, movies, series+episodes, EPG, HTTP headers).
- Enrichment: keyless pipeline (Wikipedia REST + Wikidata + IMDb suggest + TVmaze). Auto-enrich on first detail open. TVmaze sequential after v3.

## g2 — queued

None. Remaining work moved to g3.
