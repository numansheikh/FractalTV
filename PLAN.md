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
| g2 | **Complete** | FTS5 on streams + series_sources. Manual + auto indexing. Diacritic + ligature folding. Grid LIKE fallback. |
| g3 | Not started | Keyless canonical layer — title normalization + iptv-org enrichment (live channels) |
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

**Goal:** Keyless canonical identity layer (no API keys). iptv-org enrichment for live channels. FTS moves to canonical. Channel detail panel.

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
- [ ] **Sources panel pipeline buttons** — add three separate action buttons per source: Reindex (FTS), Build Canonical, and the existing Sync. Each runs independently so you can re-run just canonical without a full resync. FTS toggle to move from prominent to a debug option in Settings → Data.

### iptv-org ingestion — parked (TTL/splash bundle)

Design locked 2026-04-13 (see memory `project_iptv_ingestion_plan.md`). Not blocking; refresh-button enrichment rerun is enough for now. Pick these up together:
- [ ] First-launch splash screen blocking UI while initial iptv-org pull runs (empty DB)
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

## Snapshot (2026-04-13)

- Phase state: g1 locked, g2 locked, g3 in progress
- DB: 12 tables + `content_fts` virtual table + `iptv_channels` (39K rows pulled)
- Branches: `search-rebuild-g1` (g1), `search-rebuild-g1-g2` (g2), `search-rebuild-g1-g2-g3` (g3 WIP)
- Two real-world sources synced + indexed + tested
- Search: LIKE (g1) + FTS5 with diacritic/ligature folding (g2)
- iptv-org pull infrastructure complete: `iptv-org:refresh` IPC, progress events, validation, Settings UI
