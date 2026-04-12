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

## Snapshot (2026-04-12)

- Phase state: g1 locked, g2 next
- DB: 12 tables, no canonical layer
- Branch: `search-rebuild-g1` (g1 complete), `search-rebuild-g2` (to be created)
- Two real-world sources synced + tested
- Search: LIKE + debounce baseline, FTS5 coming in g2
