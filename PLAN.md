# Fractals — PLAN

> "Plex-quality browsing and search for IPTV content, running locally on every platform."

**Strategy, phase history, architecture pointers.** For actionable work (bugs, gaps, debt, planned features) see [`BACKLOG.md`](BACKLOG.md).

Architecture, tech stack, schema, conventions, design language: [`fractals/CLAUDE.md`](fractals/CLAUDE.md).

---

## Phase map

| Phase | Status | Scope |
|---|---|---|
| 0 | Complete | Core scaffold, DB, Xtream sync, FTS5 search, player, EPG, user data |
| 1 | Complete | UX refinement (pagination nav, Escape behavior, library search) |
| 2 | Complete | V2 data model cutover (canonical + streams, v1 dropped) |
| 2.5 | Complete | V3 data model + search (canonical split, association layer, MetadataProvider, advanced search, two-phase sync) |
| g1 | Complete | Pure provider-data app. 12 tables. LIKE search + debounce. |
| g1c | Complete | 15-table per-type split. LIKE on `search_title` (inline at sync). Test → Sync pipeline (EPG auto-chains). |
| g2 | Complete | iptv-org ingestion, detail panels, mini player, NSFW filtering, EPG sync, M3U parity, ADV search, TVmaze enrichment |
| g3 | **Complete** | TMDB enrichment, post-sync auto-chain, full code sweep, unit test suite (125 tests) |
| g4 | Not started | Capacitor (Android/iOS/TV), Tizen, three-tier product split |

---

## Snapshot (2026-04-19 — g3 closed)

- **Branch:** `g3` (tagged `g3`, g4 opens next)
- **DB:** 15 tables + enrichment tables (`movie_enrichment_g2`, `series_enrichment_g2` with `tvmaze_id`). Per-type split, no canonical, no FTS.
- **Search:** LIKE on `search_title`. ADV search (`@` prefix) tokenized parser with `md_*` filters + title LIKE fallback.
- **Pipeline:** Test → Sync. Ingest states `added → tested → synced → epg_fetched`. EPG auto-chains for Xtream.
- **Enrichment:** 3-level picker (off / keyless / TMDB). Keyless = FM-DB + Wikidata/Wikipedia + TVmaze. TMDB Level 2 key-gated, sequential after v3.
- **Player:** episode surf (PgUp/PgDn + Cmd+↑/↓, Prev/Next pills), draggable floating mini player for VoD, resume-aware autoplay.
- **M3U:** full parity with Xtream — channels, movies, series+episodes, EPG (`url-tvg`/`x-tvg-url`), HTTP headers (`#EXTVLCOPT`).
- **Code health:** `handlers.ts` split (8 domain files), dead code removed, 125 unit tests passing (normalize / title-parser / adv-query-parser / m3u-parser / export-selection). ~115 `as any` remaining (content item shapes — deferred to g4).
- **Security:** Electron sandbox on, contextIsolation on, nodeIntegration off. NSFW default-off.

---

## g1c — shipped (design record)

Drops the 12-table g1 schema for 15 per-type tables. Data is expendable at cutover — users re-sync from providers.

**Tables:**
- **Core (3):** `sources`, `profiles`, `settings`
- **Content (8):** `channel_categories`, `channels`, `epg` · `movie_categories`, `movies` · `series_categories`, `series`, `episodes`
- **User data (4):** `channel_user_data`, `movie_user_data`, `series_user_data`, `episode_user_data`

**Key design decisions shipped on top of the original g1c plan:**

1. **FTS removed.** Tried trigram + unicode61 — posting lists too large, SQLite couldn't push `source_id` / `category` filters into FTS, COUNT enumerated full match sets. LIKE + B-tree + LIMIT wins at 10k–100k rows per source.
2. **`search_title` inline at sync INSERT**, not a separate Index button. `search_title = anyAscii(title).toLowerCase()` — bidirectional diacritic + ligature match (ae↔æ, e↔é, ss↔ß, oe↔œ). Reversed the "manual button for transformational ops" rule for this specific column: microseconds per row, can't fail, Index button blocked diacritic search from "just working" for new users.
3. **EPG auto-chains inside Sync** for Xtream sources. M3U stops at `synced`. Progress streams through the shared `sync:progress` IPC channel.
4. **Pipeline is 2 buttons: Test → Sync** (was Test → Sync → EPG → Index). `'indexed'` state removed from enum.
5. **User data is not preserved across resync.** CASCADE on source delete/sync wipes per-source user_data. Hard cut — users re-sync after schema transition.

**Normalizer (one function, two callers):** `electron/lib/normalize.ts` — lowercase + any-ascii. Sync workers populate `search_title`; search handler normalizes the user's query before LIKE.

---

## g2 — shipped (highlights)

Full shipped list in git history (branch `g2`). Headlines:

- iptv-org channel DB ingestion (39K channel snapshot, tvg-id matching, country/category/NSFW flags)
- Unified detail panel spine (`DetailShell`) — Channel/Movie/Series share chrome
- Mini player in detail panels → later removed embedded zones (Phase C), VoD always floats
- PlayerOverlay reconnect overlay — 5-attempt exponential backoff
- IptvStrip siblings redesign, panel visual separation, EPG Sync button (Xtream only)
- NSFW filtering end-to-end — category flag + content row propagation + Settings toggle
- VoD enrichment pipeline (keyless): Wikipedia REST + Wikidata + IMDb suggest; v1/v2/v3 algos
- TVmaze enrichment (series only, sequential after v3)
- Movie duration (`md_runtime`, lazy-fetched via `get_vod_info`)
- Episode surf (PgUp/PgDn + Cmd+↑/↓, Prev/Next pills, embedded mode)
- Populate metadata handler — batched UPDATE (1000 rows/txn) for `md_prefix`, `md_language`, `md_year`, `md_quality`, `is_nsfw`
- ADV search (`@` prefix) — tokenized query parser, `field:value` syntax, `md_*` filter + LIKE fallback
- M3U source parity: two-pass series detection, URL-path classification, EPG via `url-tvg`, `#EXTVLCOPT` headers forwarded to HLS.js / mpv / VLC

---

## g3 — shipped (design record)

**Shipped (branch `g3`, tagged `g3`):**

- TMDB enrichment — key-gated Level 2 in the 3-level picker
- Genre pills + cast panel in detail views
- Post-sync auto-chain — iptv-org match → populate metadata runs automatically
- Cast/genre styling polish (pill padding, bg separation, inline label)
- Full code sweep: dead code removed, `handlers.ts` split (2,671 lines → 22-line orchestrator + 8 domain files), `as any` eliminated from IPC bridge + player overlay + row types, 1 silent-catch fixed
- Unit test suite: 125 tests across normalize / title-parser / adv-query-parser / m3u-parser / export-selection

**Deferred to g4:**

- Visual design revamp (tokens + full surface audit) — BACKLOG §7.1
- ~115 `as any` in content item shapes (detail panels, browse) — BACKLOG §5.2
- 42 `react-hooks/exhaustive-deps` warnings triage — BACKLOG §5.5
- libmpv embedded player for direct-file VoD — BACKLOG §3

---

## g4 — future

Detailed strategy: [`docs/reference/multi-platform-strategy.md`](docs/reference/multi-platform-strategy.md).

**Architecture decision (2026-04-19):** One React codebase across all platforms. The UI (cards, panels, search, navigation) is written once and shared everywhere. Platform differences are isolated entirely to the `PlayerAdapter` layer.

TV platforms (Tizen/Vega/webOS) run the same React web app packaged as a native TV app (.wgt/.ipk), calling their proprietary native player APIs (AVPlay/OIPF/Luna) instead of `<video>` — this gives near-universal codec support without a separate native codebase. iOS/Apple TV accept AVPlayer's codec ceiling (MP4/HLS only).

**Execution order:**
1. libmpv for Electron — fixes AVI/MKV on desktop, defines PlayerAdapter interface shape
2. Capacitor scaffold — Android phone/tablet → iOS → Android TV → Apple TV
3. DataService swap — Electron IPC → direct HTTP + `@capacitor-community/sqlite`
4. PlayerAdapter per platform — ExoPlayer (Android), AVPlayer (iOS), AVPlay/OIPF/Luna (TV web apps)
5. TV web app shells — Tizen (.wgt), Vega, webOS (.ipk), same React build
6. Spatial navigation — d-pad/remote input, foundational for all TV targets
7. Three-tier product split (feature flags, single codebase):
  - **M3U Player** — free, all platforms, channel organizer
  - **Xtream Lite** — free, Android only, single source, TMDB
  - **Fractals Pro** — paid, all platforms, multi-source, full features

---

## Future search directions (no commitments)

Possibilities if LIKE ceases to be enough:

- Denormalized per-title "search corpus" column (title + category + hints)
- Trigram index on `search_title` for CJK / Arabic where word boundaries are fuzzy
- Ranking signals (recency, favorites-weight, source-selection)
- Cross-language resolution (same Title under different language names)
- Embeddings / semantic search (sqlite-vec in place, worker not built)

**FTS5 is not on this list** — tried twice, rejected both times. Revisit only past ~1M rows or a concrete use case LIKE can't serve.

---

## Reference docs

| Doc | Purpose |
|---|---|
| [`fractals/CLAUDE.md`](fractals/CLAUDE.md) | Architecture, tech stack, schema, conventions, design language |
| [`BACKLOG.md`](BACKLOG.md) | Actionable work — bugs, gaps, debt, planned features |
| [`docs/reference/M3U-Format.md`](docs/reference/M3U-Format.md) | M3U playlist format reference |
| [`docs/reference/XtreamCodesAPI.md`](docs/reference/XtreamCodesAPI.md) | Xtream Codes API reference |
| [`docs/reference/metadata-extraction-strategy.md`](docs/reference/metadata-extraction-strategy.md) | VOD title analysis — prefix taxonomy, extraction rules (implemented as `parseTitle()`) |
| [`docs/reference/business-plan.md`](docs/reference/business-plan.md) | Competitor analysis, monetization, GTM |
| [`docs/reference/multi-platform-strategy.md`](docs/reference/multi-platform-strategy.md) | Capacitor / Tizen implementation plan |
| [`fractals/docs/USER-GUIDE.md`](fractals/docs/USER-GUIDE.md) | End-user documentation |
