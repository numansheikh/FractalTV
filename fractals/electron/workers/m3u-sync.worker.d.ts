/**
 * M3U sync worker — V3 cutover (Phase D1.5).
 *
 * Fetches an M3U playlist, parses it, and writes the V3 shape:
 *   - `streams` rows with L14 normalizer outputs
 *   - `canonical_vod` / `canonical_live` identity rows via content_hash
 *   - Per-type FTS mirrors populated inline
 *   - Series-like URLs are reclassified as 'movie' because M3U gives us
 *     individual episode URLs, not a series shell (streams CHECK constraint
 *     bans type='series' — series parents live in `series_sources`, which
 *     requires a Xtream-style hierarchical catalog the M3U format can't
 *     express). Users can still browse them under Films.
 *
 * Wipe semantics: re-sync deletes all streams for this source first.
 */
export {};
