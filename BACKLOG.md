# Fractals — Backlog

High-level buckets. Each bucket has a status, notes, and a pointer to the detailed doc that lives alongside it.

---

## 1. Data & Search  *(complete)*

V3 canonical data model, pluggable enrichment pipeline, and search UI all shipped.

**Status:** Complete as of 2026-04-11.

**What shipped:**
- V3 schema: `canonical_vod` / `canonical_series` / `canonical_live`, `streams`, `series_sources`, `stream_categories` — full association layer
- Title normalizer (L14 strip-and-capture rules, NFKC, European diacritic fold, non-Latin passthrough)
- Pluggable `MetadataProvider` interface; IMDb suggest + Wikidata + iptv-org providers implemented
- Enrichment worker with rate limiter + circuit breaker
- Advanced search parser (`@` prefix, language/quality/year/type tokens, dual-interpretation for numerics)
- Per-tab search isolation (`queries: Record<string, string>` keyed by `activeView`)
- Server-side search pagination matching browse grids
- Sidebar hybrid: All/Favorites clear search, categories narrow within search, "Search (string)" restore entry
- CommandBar revamp: unified input, ADV @ amber chip, sort button, source dots 12px
- Category filter per-view (`categoryFilters: Record<string, string|null>`)
- LiveSplitView search breadcrumb (`Search "bbc"` pill when entry from search)
- "More →" from Home seeds target tab query

---

## 2. Product shape  *(discussion)*

Three-tier split of the same React codebase via feature flags, plus M3U format work that feeds the free tier.

**Status:** Direction set, no build work yet. Tag features with their tier as they ship so current dev isn't blocked.

**Detailed reference:** `fractals/docs/business-plan.md` (competitor analysis, monetization, go-to-market)

**Notes:**
- **M3U Player** — free, all platforms, channel organizer, no TMDB, iptv-org channel metadata, lightweight
- **Xtream Lite** — free, Android only, single source, TMDB enrichment, trimmed UI
- **Fractals Pro** — paid, all platforms, multi-source M3U + Xtream, full features
- **M3U parsing improvements** (feed the free tier): EXTVLCOPT parsing, x-tvg-url header support
- Monetization leaning toward open-source core + one-time purchase on mobile/TV app stores (TiviMate model)

**Next action:** Decide where feature flags live and what the minimum tag set looks like.

---

## 3. Source management  *(partially done)*

Gaps and improvements to the add/sync source flow surfaced through real usage.

**Status:** Cancel + background sync shipped. Assessment and friction gaps remain.

**Done:**
- Cancel sync mid-flight (`sources:sync:cancel` IPC, terminates worker, resets status to idle)
- Run in background (dialog dismisses, worker keeps running, SourceCard shows live progress)

**Remaining:**
- **Enrichment assessment** — verify IMDb + Wikidata providers work end-to-end with real sources
- **Gaps from usage** — friction points to emerge from real usage (two sources being added 2026-04-12)

**Next action:** Add sources, observe, pick off friction points.

---

## 4. Multi-platform reach  *(not started)*

Desktop (Electron) is stable. Expansion plan covers Android phone/tablet, Android TV / Fire TV, iOS, Samsung Tizen, PWA.

**Status:** Phase 3 — not started. Plan document is comprehensive and ready.

**Detailed plan:** `fractals/docs/multi-platform-strategy.md` (priority matrix P0-P5, DataService abstraction, SQLite-on-mobile, PlayerAdapter, Tizen AVPlay specifics, ~75% shared code estimate)

**Notes:**
- Recommended order: Electron (done) → Android phone → Android TV → iOS → Tizen → PWA
- Key abstractions needed before any platform work: `DataService` interface (Electron IPC vs Capacitor HTTP+SQLite), `PlayerAdapter` interface (HLS.js vs ExoPlayer vs AVPlayer vs AVPlay)
- Capacitor is the primary mobile path; Tizen uses the same web build wrapped as `.wgt`

**Next action:** Defer until data model + source management settled.

---

## 5. Experience polish  *(independent, small-to-medium)*

UX and player fixes that don't depend on the bigger architectural work. Each item is self-contained and can be picked off in its own session.

**Status:** Open, independent of all other buckets. Live TV nav breadcrumb now done.

**Items:**
- **Series full-page view** — replace the cramped `SeriesDetail` slide panel for long-running series (many seasons, long episode lists). Full-screen real estate for season tabs + episode grid. Player's series chip on minimize targets this page instead of the slide panel.
- **Player: EPG timeshift timeline in fullscreen** — catchup channels only. XMLTV parser and Full Guide panel already done; this is the player-side bottom bar.
- **Player: episode stream 404 hang** — when an episode 404s, player hangs with spinner. Needs timeout + error overlay.

**Next action:** Pick one at a time, discuss approach, build.

---

## 6. Tech health  *(backlog)*

Quality and hardening debt. Not blocking product work but worth chipping away at.

**Status:** 30+ findings catalogued, no sweep in progress.

**Top-of-list (P0/P1):**
- Missing `profile_id` in `user_data` writes — watch position / favorites / watchlist writes may silently fail
- `tsconfig.node.json` broken — TypeScript isn't actually type-checking
- Hardcoded TMDB API key in source
- Electron sandbox + webSecurity disabled
- 130+ `as any` casts — entire IPC layer untyped, `api.ts` / `preload.ts` type drift
- `HomeView` isFetching uses `&&` instead of `||` (flash "no results")
- Season sort is string-based (Season 10 before Season 2)
- `removeAllListeners` in preload kills sibling listeners
- Credential URL construction in renderer process
- M3U path traversal vulnerability
- FTS rebuild deletes-then-rebuilds (crash = no search)

**Next action:** Batch P0s into a sweep when we have a quiet window between feature buckets.

---

## Cross-bucket notes

- **Phase state:** Phase 0–2.5 complete as of 2026-04-11 (V3 data model + search shipped). Phase 3 (multi-platform) not started.
- **DB state:** Fresh wipe 2026-04-11. First real-world sync with two sources planned 2026-04-12.
- **Current queue:** Empty. Next pick TBD after observing real-world sync.
