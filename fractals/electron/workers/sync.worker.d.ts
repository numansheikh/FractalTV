/**
 * Sync worker — V3 cutover (Phase D1).
 *
 * Fetches Xtream catalog for a single source and writes the V3 shape:
 *   - `streams` rows with L14 normalizer outputs (year_hint, language_hint, …)
 *     and provider-raw fields; polymorphic FK is left NULL pending oracle.
 *   - `canonical_vod`, `canonical_series`, `canonical_live` identity rows,
 *     deduped via `content_hash` (sha1(normalized_title + year + type)) for
 *     VOD/series, sha1(tvg_id or normalized_name + country) for live.
 *   - Per-type FTS mirrors populated inline (light cols only — normalized_title
 *     / canonical_name).
 *   - New canonicals start `oracle_status='pending'`; the enrichment worker
 *     drains the queue after sync completes.
 *
 * Wipe semantics (user Q6): a re-sync of the same source wipes all streams
 * belonging to it before re-inserting. Categories are upserted (positions
 * matter). Empty canonicals (no streams pointing at them) are swept at the
 * end of the sync.
 *
 * This worker only talks to SQLite and the Xtream HTTP API. It never touches
 * metadata providers, iptv-org, or TMDB — enrichment is a separate worker.
 */
export {};
