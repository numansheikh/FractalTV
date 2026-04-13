# Fractals — PLAN

> "Plex-quality browsing and search for IPTV content, running locally on every platform."

Architecture, tech stack, schema, conventions, design language: see `fractals/CLAUDE.md`.

---

## Phases

> **Naming convention:** `g` = generation. Each generation is **cumulative** — it inherits everything from the prior generation and adds its own layer on top. g2 includes all of g1; g3 includes all of g2; etc. When describing where a feature lives, attribute it to the generation it *entered* the stack.

| Phase | Status | Scope |
|---|---|---|
| 0 | Complete | Core scaffold, DB, Xtream sync, FTS5 search, player, EPG, user data |
| 1 | Complete | UX refinement (pagination nav, Escape behavior, library search) |
| 2 | Complete | V2 data model cutover (canonical + streams, v1 dropped) |
| 2.5 | Complete | V3 data model + search (canonical split, association layer, MetadataProvider, advanced search, two-phase sync) |
| g1 | **Complete** | Strip to pure provider-data app. 12 tables. LIKE search + debounce. User data survives resync. UI polish. |
| g2 | **Complete** | FTS5 on streams + series_sources. Manual + auto indexing. Diacritic + ligature folding. Grid LIKE fallback. |
| g3 | In progress | Keyless canonical layer. **Phase 1:** channels + iptv-org enrichment. **Phase 2:** VoD (movies/series) keyless canonical via title normalization. |
| g4 | Not started | Embeddings / semantic search |
| g5 | Not started | Keyed enrichment (TMDB) + cross-language resolution |
| 3 | Not started | Capacitor (Android/iOS/TV), Tizen |

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
- Type-bleeding fix: search results scoped by active view's `contentType`

---

## g2 — locked (2026-04-12)

Branch: `search-rebuild-g1-g2`

**What shipped:**
- `content_fts` FTS5 virtual table (id/source_id/type UNINDEXED, title searchable)
- Tokenizer: `unicode61 remove_diacritics 2` (handles diacritics natively)
- `fold_ligatures()` SQLite scalar + JS query-side pre-fold (œ→oe, æ→ae, ß→ss, ﬁ→fi, ﬂ→fl, ĳ→ij)
- Per-source index build, yields between 5000-row batches (main thread stays responsive)
- Auto-index runs at end of every successful sync; `ftsEnabled` forced on after each index
- Sources panel FTS toggle (debug, will be hidden later)
- SourceCard redesign: icon-only Disable/Edit/Delete on top row, labeled Test/Sync/Reindex FTS on bottom row
- NavRail pulse + home info strip reflect indexing activity
- Grid views augment FTS results with LIKE when <10 results (`ftsFallback: true`); home/discover stays FTS-only for speed

---

## g3 — in progress

Branch: `search-rebuild-g1-g2-g3`

**Goal:** Keyless canonical identity layer (no API keys). Built in two phases:
- **Phase 1 — Channels:** iptv-org enrichment for live channels, FTS moves to canonical, channel detail panel.
- **Phase 2 — VoD:** keyless canonical for movies/series via title normalization; unified canonical FTS covering all three content types.

Phase 1 design decisions below are locked. Phase 2 design pending.

**Design decisions (locked 2026-04-13):**

### Schema
- `canonical_channels` (denormalized): `id` UUID PK, `title`, `country`, `network`, `owners` (JSON), `categories` (JSON), `is_nsfw`, `launched`, `closed`, `replaced_by`, `website`, `logo_url`, `iptv_org_id` TEXT nullable indexed, `created_at`, `updated_at`
- `streams`: add `canonical_channel_id` FK + `user_flagged INTEGER DEFAULT 0`
- `channel_user_data`: drop + rebuild keyed by `canonical_channel_id` (existing data expendable)
- Canonical ID: local UUID; `iptv_org_id` is separate nullable column — join only at batch match time, never at runtime

### Match strategy (runs at sync time, two passes)
1. Pass 1 — exact: `stream.tvg_id == iptv_channels.id` → link + copy iptv-org fields into canonical
2. Pass 2 — title: normalized title + alt_names match against canonical
3. Unmatched → synthetic canonical created from stream title

### FTS
- Drop stream-keyed `content_fts`
- New FTS5 virtual table over `canonical_channels(title, alt_names)`
- Query path: FTS hit → canonical_id → fan out to streams for variants
- VoD FTS (movies/series) unchanged — deferred to g5

### UI
- Channel card: shows canonical title; badges = country flag + variant count + multi-source dots
- Badges are user-configurable (Settings → Data → checkbox list, fixed order)
- Channel detail panel: new overlay mirroring Movie/Series pattern; shows enrichment + variant picker
- NSFW filtering: deferred

### Deferred
- Stream health / user-flag UI (column added, logic later — TODO)
- VoD canonical (g5+)
- TV-oriented redesign pass (post-g3)

### Next dev session queue
- [ ] **Add Source dialog: Test > Add prominence** — Test button should be the primary/prominent action in the Add Source dialog, Add secondary. User should be nudged to test credentials before committing. Currently inverted.
- [ ] **Manual per-source pipeline (locked 2026-04-14)** — replace auto-chain with 7 explicit buttons. See `memory/project_g3_manual_pipeline.md`.
  - In dialog: (1) Test, (2) Add (no auto-sync, dialog closes)
  - On Source Card, sequential, downstream gated: (3) Sync, (4) Fetch EPG, (5) Index FTS, (6) Build Canonical, (7) Canonical FTS
  - Source Card shortcut to global "Fetch iptv-org data"
  - Source Card stat line: `X / Y live streams have tvg_id`
  - Optional "Run all remaining" to restore the chain as explicit opt-in
- [ ] **Pass 2 redesign** — replace exact-title match with longest word-boundary substring match (min 4 chars) + country-tiebreaker. On test data only 10% of live streams have tvg_id, so Pass 2 density matters.
- [ ] **Unhide Group View** — hidden as of 2026-04-14 because 99%+ of canonicals are synthetic (carrying provider-prefixed noise). Restore toolbar toggle once Pass 2 redesign lands and match rate improves (ballpark: >50% non-synthetic).

### iptv-org ingestion — parked (TTL/splash bundle)

Design locked 2026-04-13 (see memory `project_iptv_ingestion_plan.md`). Not blocking; refresh-button enrichment rerun is enough for now. Pick these up together:
- [ ] First-launch splash screen blocking UI while initial iptv-org pull runs (empty DB)
  - **Alt idea (2026-04-13):** skip the splash — kick the iptv-org fetch in the background the moment the Add Source dialog mounts, so by the time the user finishes entering credentials the channel DB is populated. Open: race resolution if user submits fast (block sync vs proceed unenriched + re-enrich later), failure surfacing, trigger point (app mount vs dialog open).
- [ ] TTL-expired gate on add-source flow (Hybrid C: empty → block, populated → parallel)
- [ ] TTL-expired gate on manual sync flow (same Hybrid C behavior)

---

## Known bugs (carry forward)

- [ ] **Episode stream hang** — player infinite spinner on 404. Needs timeout + error overlay.
- [ ] **Black screen** — occasional idle black screen requiring Cmd+R. Undiagnosed, deferred.
- [ ] **ADV mode thorough testing** — test ADV (advanced search) across g1, g2, g3 phases: basic query, diacritic input, ligature folding, FTS fallback to LIKE, canonical title match, per-view isolation.
- [x] **Diacritic / ligature search** — FIXED in g2.
- [x] **Search type bleeding** — FIXED in g1 (2026-04-12).

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

## Snapshot (2026-04-13 end of day)

- Phase state: g1 locked, g2 locked, g3 in progress (on `search-rebuild-g1-g2-g3`)
- DB (g3): adds `canonical_channels` (with `alt_names`, `logo_url`), `canonical_fts`, `iptv_channels` (with `logo`), `channel_user_data` re-keyed to canonical_channel_id
- Search: LIKE (g1), FTS5 on streams (g2), canonical FTS with alt_names + ligature folding (g3)
- Browse/search perf: EXISTS-based `content:browse-live-grouped`, two-pass id→hydrate in g1/g3 live search, categories counted by actual stream type
- iptv-org refresh (Settings): pulls channels.json + logos.json, then re-runs `buildCanonicalLayer` across all sources + `buildCanonicalFts`. Schema-validated before overwrite, retry-once on fetch.
- Parked (see `memory/project_iptv_ingestion_plan.md`): splash on first launch, TTL gate on add-source + manual-sync, Hybrid C routing

**Next session clean-slate walkthrough:**
- Delete `~/Library/Application Support/fractaltv/data/` (DB) + `.../Local Storage/` (Zustand)
- Optional: kill legacy `/Applications/Fractals.app` (not our code; unrelated old install using `electron-backend/` userData dir)
- Start dev, add a source, sync, watch canonical build + iptv-org refresh flow end-to-end as a new user
