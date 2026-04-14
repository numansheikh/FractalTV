# Fractals — TODO

## g1c redesign implementation (DESIGN LOCKED, NOT YET STARTED)

Target branch: `g1c`. Sits on tag `g1-baseline` at commit `3cfac99c`. See `PLAN.md` for the full 15-table design and the nine locked decisions.

- [ ] Write new `schema.ts` + `connection.ts` with the 15 tables (sources, profiles, settings; channel/movie/series categories; channels, movies, series, episodes; channel/movie/series/episode user_data; channel/movie/series FTS virtual tables; epg)
- [ ] Register the normalizer as a SQLite scalar function (lowercase + diacritic strip + ligature fold æ→ae, ß→ss, œ→oe; no punctuation strip, no whitespace collapse, no leading-article strip). Used both at sync time to populate `search_title` and at query time to normalize user input before MATCH.
- [ ] Rewrite sync worker with three insert paths (channels, movies, series) plus lazy episodes. Each path writes the content row and its `channel_fts` / `movie_fts` / `series_fts` entry inside a single transaction. No triggers.
- [ ] Rewrite IPC handlers for search, browse, user-data, favorites, categories, and EPG against the new tables.
- [ ] Rewrite frontend types + TanStack queries to match the split content and user-data tables.
- [ ] Update export / import schema to match the new 15-table layout.
- [ ] Smoke test with a fresh sync end-to-end (drop DB, sync source, verify browse + search + favorites + EPG).

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
