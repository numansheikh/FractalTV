# Fractals — TODO

## g1c redesign implementation (DESIGN LOCKED, IN PROGRESS)

Target branch: `g1c`. Sits on tag `g1-baseline` at commit `bde63083`. See `PLAN.md` for the full 15-table design and the ten locked decisions.

**Pipeline:** Test → Sync → EPG → Index. `sources.ingest_state` chain: `added → tested → synced → epg_fetched → indexed`. Index runs normalize + FTS build in one step.

- [x] Write normalizer utility (pure JS): lowercase + diacritic strip + ligature fold æ→ae, ß→ss, œ→oe. No punctuation strip, no whitespace collapse, no leading-article strip. Same function used at Index time to populate `search_title` AND at search time to normalize query strings before MATCH.
- [x] Draft new schema DDL (15 tables) as a reviewable SQL constant in `electron/database/schema.g1c.sql.ts`. Not yet wired into `connection.ts` — next commit applies the destructive migration.
- [ ] Apply the destructive migration in `connection.ts` — drop old g1 tables, create the 15 new tables. User re-syncs; data expendable.
- [ ] Update Drizzle `schema.ts` for the new `sources.ingest_state` value (`indexed`) and any Drizzle-managed tables.
- [ ] Rewrite sync worker with three insert paths (channels, movies, series) plus lazy episodes. Sync writes content rows only. FTS and `search_title` are NOT populated at sync time — the Index button handles that.
- [ ] Add Index pipeline step: 4th button + IPC handler + worker that (a) computes `search_title` via the shared normalizer and writes it to channels/movies/series, (b) populates channel_fts / movie_fts / series_fts, (c) advances `ingest_state` to `indexed`. All in one transaction.
- [ ] Rewrite IPC handlers for search, browse, user-data, favorites, categories, and EPG against the new tables. Search MATCH uses `normalize(query)` at call time.
- [ ] Rewrite frontend types + TanStack queries to match the split content and user-data tables.
- [ ] Update export / import schema to match the new 15-table layout.
- [ ] Smoke test with a fresh sync end-to-end (drop DB, sync source, run EPG, run Index, verify browse + search + favorites + EPG).

---

## UI punchlist (pre-g1c)

- [ ] Category pill shown on bottom-right in every fullscreen launch path

---

## Bucket 3 — Source Management (partially done)

- [ ] Source management UX improvements (details TBD from real usage)
- [ ] Enrichment implementation assessment (IMDb + Wikidata end-to-end) — deferred

---

## Bucket 5 — Experience Polish

- [ ] Series page / detail view improvements
- [ ] Design system rethink — borders + washed-out lavender (parked, explicitly deferred)

---

## Bucket 6 — Tech Health

- [ ] `profile_id` missing in user_data writes
- [ ] `tsconfig.node.json` broken
- [ ] Hardcoded TMDB key
- [ ] Electron sandbox disabled
- [ ] 130+ `as any` casts

---

## Bucket 2 — Product Shape (discussion only, no build)

- [ ] Three-tier split: M3U Player (free) / Xtream Lite (free Android) / Fractals Pro (paid) — feature flags, same codebase. Not started.
