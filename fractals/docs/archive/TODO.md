# Fractals — TODO

## Bucket 1 — Data & Search

### Fixed (g1/g2)
- [x] Diacritic search — fixed in g2 via FTS5 `unicode61 remove_diacritics 2`
- [x] Ligature search (cœur, œuvre, etc.) — fixed in g2 via `fold_ligatures()` SQLite scalar + JS pre-fold
- [x] Search grid broken — fixed in g1 (type-bleeding fix: scope searchItems by active view's contentType)
- [x] Mixed card sizes in search — fixed in g1 (same type-bleeding fix + card size policy: live→ChannelCard, movie/series→PosterCard)
- [x] FTS hygiene on source remove — delete.worker wipes content_fts rows in same transaction

### Open bugs
- [ ] **Episode stream hang** — player hangs with spinner when an episode URL 404s; needs timeout + error overlay
- [ ] **Black screen** — occasional idle black screen requiring Cmd+R; undiagnosed, deferred

### QA / Sync tests (shelved — resume here)
Two-phase sync implemented, basic tests passed. Resume from:
- [ ] Let both sources (Opplex + 4K) sync fully; verify Phase 1 browse works before indexing completes
- [ ] Test cancel mid-sync — Phase 1 separately, Phase 2 separately (including mid-FTS-build cancel)
- [ ] Test factory reset during active sync
- [ ] Test two sources syncing simultaneously
- [ ] Verify VirtualGrid last-row padding (cards in last row shouldn't stretch wider than the rest)

---

## Bucket 3 — Source Management (partially done)

- [ ] Source management UX improvements (details TBD from real usage)
- [ ] Enrichment implementation assessment — deferred to g3 (keyless: iptv-org) and later (keyed: TMDB)

---

## Bucket 5 — Experience Polish

- [ ] Series page / detail view improvements
- [ ] Timeshift bottom bar in fullscreen player (EPG + catchup UI done, playback bar missing)
- [ ] Design system rethink — borders + washed-out lavender (parked, explicitly deferred)

---

## Bucket 6 — Tech Health

- [ ] `profile_id` missing in user_data writes
- [ ] `tsconfig.node.json` broken
- [ ] Hardcoded TMDB key (pre-g1 remnant, to be cleaned during g5)
- [ ] Electron sandbox disabled
- [ ] 130+ `as any` casts

---

## Bucket 2 — Product Shape (discussion only, no build)

- [ ] Three-tier split: M3U Player (free) / Xtream Lite (free Android) / Fractals Pro (paid) — feature flags, same codebase. Not started.
