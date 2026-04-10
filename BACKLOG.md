# Fractals — Backlog

High-level buckets. Each bucket has a status, notes, and a pointer to the detailed doc that lives alongside it. Small, already-scoped bugs live in `fractals/docs/qa-cycle-2.md`.

---

## 1. Data & Search  *(next pick)*

Canonical data model + search redesign + TMDB enrichment are one tightly-coupled effort. The sketch (provider layer + canonical identity + rich meta) is locked; the implementation split has been scoped.

**Status:** Discussion/scoping phase. Scope breakdown complete, waiting on blocker decisions.

**Detailed plan:** `~/.claude/plans/scalable-leaping-cake.md`
**Target visual:** `fractals/docs/data-model-diagram.html` (two-layer: provider streams → canonical → TMDB enrichment, free/pro tiers)

**Notes:**
- V2 schema already splits canonical / streams / user_data, has FTS5 on canonical, sync-time population, and a TMDB enrichment worker. The sketch is partially realized.
- Only one sub-item is unblocked today: **refactor TMDB service into a pluggable `MetadataProvider` interface** (keeps TMDB as sole impl for now). Doesn't depend on any of the ambiguous decisions.
- Everything else waits on four ambiguous decisions: (1) what counts as "light" vs "rich" meta, (2) canonical identity scheme, (3) merge policy, (4) where the canonical name comes from at sync time.
- **Cross-references:** iptv-org integration (channel metadata source, same family as TMDB) belongs here, not with M3U parsing.
- Absorbs the earlier "TMDB English title indexing" and cross-language search items.

**Next action:** Resolve the 4 blockers, then open an implementation plan.

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

## 3. Multi-platform reach  *(not started)*

Desktop (Electron) is stable. Expansion plan covers Android phone/tablet, Android TV / Fire TV, iOS, Samsung Tizen, PWA.

**Status:** Phase 3 — not started. Plan document is comprehensive and ready.

**Detailed plan:** `fractals/docs/multi-platform-strategy.md` (priority matrix P0-P5, DataService abstraction, SQLite-on-mobile, PlayerAdapter, Tizen AVPlay specifics, ~75% shared code estimate)

**Notes:**
- Recommended order: Electron (done) → Android phone → Android TV → iOS → Tizen → PWA
- Key abstractions needed before any platform work: `DataService` interface (Electron IPC vs Capacitor HTTP+SQLite), `PlayerAdapter` interface (HLS.js vs ExoPlayer vs AVPlayer vs AVPlay)
- Capacitor is the primary mobile path; Tizen uses the same web build wrapped as `.wgt`

**Next action:** Finish Electron stabilization first; defer Capacitor scaffolding until data model work lands.

---

## 4. Experience polish  *(independent, small-to-medium)*

UX and player fixes that don't depend on the bigger architectural work. Each item is self-contained and can be picked off in its own session.

**Status:** Open, independent of all other buckets.

**Items:**
- **Live TV nav polish** — `LiveSplitView` breadcrumb/origin context so the sidebar shows where the user came from (`Browsing: Sports`, `From: Search`, `From: Favorites`) and channel-surfing stays scoped. Also fix Discover Favorites pill mapping (currently routes to Browse Favorites, should return to Home Discover). Discuss approach before building.
- **Series full-page view** — replace the cramped `SeriesDetail` slide panel for long-running series (many seasons, long episode lists). Full-screen real estate for season tabs + episode grid. Player's series chip on minimize targets this page instead of the slide panel.
- **Player: EPG timeshift timeline in fullscreen** — catchup channels only. XMLTV parser and Full Guide panel already done; this is the player-side bottom bar.
- **Player: episode stream 404 hang** — when an episode 404s, player hangs with spinner. Needs timeout + error overlay.

**Next action:** Pick one at a time, discuss approach, build.

---

## 5. Tech health  *(backlog)*

Quality and hardening debt surfaced by the QA cycle 2 audit. Not blocking product work but worth chipping away at.

**Status:** 30+ findings catalogued, no sweep in progress.

**Detailed reference:** `fractals/docs/qa-cycle-2.md`

**Top-of-list (P0/P1 from the audit):**
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

- **Phase state:** Phase 0 (core) + Phase 1 (UX refinement) + Phase 2 (V2 data model cutover) all complete as of 2026-04-10. Phase 3 (multi-platform) not started.
- **Next pick:** Data & Search (bucket 1). Blocker resolution first, then implementation plan.
