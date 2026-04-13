# Data Model

Two-layer model separating ephemeral provider data from persistent canonical identity.

## Layer 1 — Provider data (ephemeral)

Sourced from Xtream or M3U provider payloads. Disappears when source is removed or subscription lapses.

- `sources` — user's configured providers (Xtream creds or M3U URL)
- `streams` — one row per playable live / movie stream, with title, `tvg_id`, category refs, thumbnail, container, plus added `canonical_channel_id` FK and `user_flagged` (g3)
- `series_sources` — one row per series-as-known-to-provider (episodes fetched on demand)
- `categories` — provider-supplied groups (e.g. "Action", "USA ➾ News"); namespaced per source
- `stream_categories`, `series_source_categories` — junction tables
- `epg` — EPG entries keyed by source + `channel_external_id`

Content type vocabulary: **Live, Movie, Series** (Radio = Live variant).

## Layer 2 — Canonical identity (persistent)

Survives provider churn. Search and user-data keys sit here.

- `canonical_channels` (g3 Phase 1, live only) — denormalized by design: UUID PK, title, country, network, owners (JSON), categories (JSON), is_nsfw, launched, closed, replaced_by, website, logo_url, `iptv_org_id` nullable, timestamps. Synthetic canonicals (unmatched streams) need their own data, so denormalization keeps runtime reads single-table.
- `canonical_fts` — FTS5 virtual table over `canonical_channels(title, alt_names)`.
- Planned g5: canonical for movies/series anchored by `tmdb_id` with free-tier fields (English title, original_title, year, genres, poster_path, vote_average) and Pro fields (cast, director, keywords, overview, spoken_languages, embeddings).
- Parental rating: deferred, lazy-fetch on detail open.

## Bridge

- Many provider streams → one canonical identity.
- Decoupled: deleting a source removes provider rows only; canonical survives.
- User-interacted rows (watched / favorited / rated / watchlisted) persist forever. Uninteracted canonicals are evictable when no active streams reference them.

## User data

- `stream_user_data` — keyed by stream id (Movie user data)
- `series_user_data` — keyed by series id
- `channel_user_data` (g3) — keyed by `canonical_channel_id` (previously keyed by stream id, dropped + rebuilt; favorites were expendable pre-release)
- `profiles`, `settings` — misc app state

## Canonical ID policy

- Canonical id is a **local UUID** (Option B).
- `iptv_org_id` is a **separate nullable column**.
- Join to iptv-org only fires at batch match time. **Never at runtime browse/search** — that join is what the denormalization is designed to avoid.

## Match strategy (sync-time, two-pass today, three passes including fallback)

1. **Pass 1 — tvg_id exact:** `stream.tvg_id == iptv_channels.id` → link + copy iptv-org fields into canonical.
2. **Pass 2 — normalized title match:** today exact normalized title + alt_names. Planned redesign: substring match with word boundaries + country tiebreaker (see [manual-pipeline.md](manual-pipeline.md)).
3. **Pass 3 — synthetic fallback:** if still unmatched, create a synthetic canonical from the stream title.

Observed density (2026-04-13): ~10% tvg_id coverage on the test source, ~99.8% canonicals ended up synthetic. Pass 2 redesign is the fix — until then, any UI feature relying on iptv-org-only fields (country flag, iptv-org categories, logos) must degrade gracefully for synthetic canonicals.

## Export / import

Whenever data moves between schemas (e.g. v1 → v2 → v3), update export/import in `handlers.ts` (`sources:export`, `sources:import`). Backup files must capture the full current state. After any data model migration, grep `sources:export` and verify all active user-data tables are present.

## Refresh safety

Any replace-all refresh (iptv-org, future TMDB pulls, enrichment catalogs):

1. Download + parse the payload.
2. Sanity-check shape: array (or expected top-level type), non-empty, sampled rows carry required fields with expected types.
3. Only then open a transaction: `DELETE` existing rows, `INSERT` new rows.
4. If the check fails, abort and surface error. **Never leave the table empty after a failed parse.** Stale is better than empty.
