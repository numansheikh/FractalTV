/**
 * Sync worker — g1c per-type split.
 *
 * Fetches Xtream catalog for a single source and writes to the per-type tables:
 *   - `channels` (Live) with `search_title` populated inline (any-ascii + lowercase)
 *   - `movies` (VOD) with `search_title` populated inline
 *   - `series` parents with `search_title` populated inline
 *   - Per-type categories: `channel_categories`, `movie_categories`, `series_categories`
 *   - Episodes are lazy-fetched via `get_series_info` on first detail open, not here.
 *
 * EPG auto-chains after the catalog sync for Xtream sources (M3U stops at `synced`).
 *
 * Wipe semantics: a re-sync of the same source wipes per-type content rows for it.
 * CASCADE drops per-source user_data rows too (g1c hard cut — users re-sync from
 * providers). Categories are upserted (positions matter).
 *
 * This worker only talks to SQLite and the Xtream HTTP API. No metadata providers.
 */
export {};
