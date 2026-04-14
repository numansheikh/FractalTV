/**
 * M3U sync worker — g1c per-type split.
 *
 * Fetches an M3U playlist, parses it, and writes to the per-type tables:
 *   - `channels` / `movies` with `search_title` populated inline (any-ascii + lowercase)
 *   - Per-type categories via M3U group-title
 *   - Series-like URLs are reclassified as 'movie' because M3U gives us individual
 *     episode URLs, not a series shell. Users can still browse them under Films.
 *
 * Wipe semantics: re-sync deletes all per-type rows for this source first; CASCADE
 * drops the source's user_data (g1c hard cut). M3U sync stops at `synced`;
 * EPG auto-chain applies to Xtream only.
 */
export {};
