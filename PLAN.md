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
| 3 | Not started | Capacitor (Android/iOS/TV), Tizen |

---

## Active Working List

The current in-flight queue. Closes **QA Cycle 3** (Phase 2.5 verification tail) and finishes the remaining **Bucket 1 — Source Management** work.

**Sequencing:** bugs (1–4) → defensive hardening (5–6) → UI consistency (7) → sync tests (8–14) → close QA Cycle 3 → Bucket 1 remaining (15–16).

### Bugs — blocking QA close

1. [x] **Search grid broken** — VirtualGrid renders badly in search mode. Root cause: cross-type search data bled into `searchItems` because search queryKeys didn't include `contentType`. Fixed by adding `contentType` to the three queryKeys in `ContentArea.tsx`. Verified.
2. [x] **Mixed card sizes in search** — same root cause as #1. Fixed by the same queryKey change. Verified.
3. [x] **Diacritic search** — Root cause was not the normalizer. `indexing.worker.ts` was missing from `electron.vite.config.ts` entry points, so Phase 2 indexing spawn-failed silently and `canonical_vod_fts` / `canonical_live_fts` were never populated. Search fell through to LIKE on raw titles (matches `förg` literally, misses `forg`). Fix: added the entry + shipped per-source Re-index action (new IPC handler, preload, api wrapper, SourceCard button). Verified.
4. [ ] **Episode stream hang** — player shows spinner indefinitely when episode URL 404s. Needs timeout + error overlay.
4a. [x] **Search bleeds across tabs via NavRail** — Could not reproduce in the live build; user confirmed the bleed was gone. Likely stale code from a prior build. Closed, no code change.

### Defensive hardening (follow-ups to #1 / #2)

5. [x] **Scope `searchItems` by `contentType`** before concatenating in `ContentArea.tsx` — belt to the queryKey fix's suspenders. Verified.
6. [x] **VirtualGrid: prefer `contentType` prop for `isLive`** with `items[0]?.type` as fallback — removes the fragile first-item heuristic. Verified.

### UI consistency

7. [x] **Home ChannelCard size** must match the ChannelCard size used in the Live channels grid. Fixed: DiscoverStrip grid now sets `gridAutoRows: 116px` (live) / `242px` (poster) and caps each cell at `maxWidth: 220` / `180`, mirroring VirtualGrid. Verified.

### Sync tests — shelved, resume after bugs fixed

8. [ ] Both sources (Opplex + 4K) sync fully; verify Phase 1 browse works before indexing completes
9. [ ] Phase messages in order: Downloading → Saving → Indexing channels/movies/series → Search ready
10. [ ] Search locked until indexing completes (not available during Phase 1)
11. [ ] Cancel mid-sync — Phase 1 and Phase 2 separately
12. [ ] Factory reset during active sync
13. [ ] Two sources syncing simultaneously
14. [x] VirtualGrid last-row padding (last-row cards shouldn't stretch wider than the rest) — already fixed as part of #1/#2; VirtualGrid pads the last row with null cells so widths stay uniform.

### Bucket 1 remaining — after QA cycle closes

15. [ ] **Enrichment end-to-end assessment** — verify IMDb + Wikidata providers work with real sources
16. [ ] **Real-usage friction gaps** — surfaces as two sources are added + sync'd. Observe, pick off.

---

## Future / Parked Buckets

Not active. Picked up after the Active Working List clears. Order is most-actionable → least-actionable. Bucket 1 (Source Management) is absorbed into the Active Working List above; Data & Search retired (Phase 2.5 complete).

### Bucket 2 — Experience Polish

**Status:** Open. Independent items, each self-contained.

- [ ] **Series full-page view** — replace cramped SeriesDetail slide panel for long-running series. Full-screen real estate for seasons + episode grid. Player's series chip on minimize targets this page.
- [ ] **Timeshift bottom bar** in fullscreen player — catchup channels only. XMLTV parser + Full Guide panel already done; player-side bottom bar pending.
- [ ] **Design system overhaul** (parked) — borders + washed-out lavender feel off; overhaul explicitly deferred, do not start unprompted.

**Next action:** Pick one at a time, discuss approach, build.

---

### Bucket 3 — Tech Health

**Status:** Backlog, no sweep in progress. Top P0/P1:

- [ ] Missing `profile_id` in `user_data` writes — position / favorites / watchlist may silently fail
- [ ] `tsconfig.node.json` broken — TypeScript isn't actually type-checking
- [ ] Hardcoded TMDB API key in source
- [ ] Electron sandbox + webSecurity disabled
- [ ] 130+ `as any` casts across IPC layer (`api.ts` / `preload.ts` type drift)
- [ ] `HomeView` isFetching uses `&&` instead of `||` (causes flash "no results")
- [ ] Season sort is string-based (Season 10 sorts before Season 2)
- [ ] `removeAllListeners` in preload kills sibling listeners
- [ ] Credential URL construction in renderer process
- [ ] M3U path traversal vulnerability
- [ ] FTS rebuild deletes-then-rebuilds (crash mid-rebuild = no search)

**Next action:** Batch P0s into a sweep in a quiet window between feature buckets.

---

### Bucket 4 — Multi-Platform Reach

**Status:** Not started. This is Phase 3.

**Reference:** `fractals/docs/multi-platform-strategy.md` — priority matrix, DataService / PlayerAdapter abstractions, SQLite-on-mobile, Tizen AVPlay specifics, ~75% shared code estimate.

**Order:** Electron (done) → Android phone → Android TV → iOS → Tizen → PWA.

**Key abstractions needed first:**
- `DataService` interface — Electron IPC vs Capacitor HTTP+SQLite
- `PlayerAdapter` interface — HLS.js vs ExoPlayer vs AVPlayer vs AVPlay

**Next action:** Defer until data model + source management fully settled.

---

### Bucket 5 — Product Shape

**Status:** Discussion only. Direction set, no build work yet.

**Reference:** `fractals/docs/business-plan.md` — competitor analysis, monetization, go-to-market.

**Three-tier split** (same React codebase, feature flags, split at packaging time):
- **M3U Player** — free, all platforms, channel organizer, no TMDB, iptv-org metadata
- **Xtream Lite** — free, Android only, single source, TMDB enrichment, trimmed UI
- **Fractals Pro** — paid, all platforms, multi-source M3U + Xtream, full features

**Feeds the free tier:** M3U parsing improvements (EXTVLCOPT parsing, x-tvg-url header support).

**Monetization:** Leaning open-source core + one-time purchase on mobile/TV app stores (TiviMate model).

**Next action:** Decide where feature flags live and the minimum tag set. Tag features with their tier as they ship so current dev isn't blocked.

---

## Reference docs

| Doc | Purpose |
|---|---|
| `fractals/CLAUDE.md` | Architecture, tech stack, schema, conventions, design language |
| `fractals/docs/business-plan.md` | Bucket 5 — three-tier split, competitors, monetization |
| `fractals/docs/multi-platform-strategy.md` | Bucket 4 — platform priority, abstractions, platform specifics |
| `fractals/docs/USER-GUIDE.md` | User-facing documentation |
| `XtreamCodesAPI.md` | Xtream Codes API reference |

---

## Snapshot (2026-04-11)

- Phase state: 2.5 complete, 3 not started
- QA cycle: 3 in progress, shelved at bugs
- DB: fresh wipe 2026-04-11
- First real-world sync (2 sources) planned 2026-04-12
- Active queue: 13 items (see Active Working List above)
