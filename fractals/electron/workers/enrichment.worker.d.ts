/**
 * Enrichment worker — V3 Phase D2.
 *
 * Drains `oracle_status='pending'` canonicals through the keyless metadata
 * provider chain (L8 for VoD, L10 for Live):
 *
 *   VoD (Latin hint):     IMDb suggest → Wikidata-by-tconst → Wikidata search
 *   VoD (non-Latin hint): Wikidata search → IMDb suggest
 *   Live:                 iptv-org bulk lookup (direct tvg_id match + fuzzy)
 *
 * Runs as a Node worker thread so rate limiting and fetches don't block the
 * main process. Messages to the parent:
 *   { type: 'progress', done, total, phase }
 *   { type: 'done', stats }
 *   { type: 'error', message }
 *
 * This worker is idempotent: it only touches rows where
 * `oracle_status='pending'`, so repeated invocations are cheap after the
 * queue drains. The sync worker (D1) sets new canonicals to 'pending'; the
 * main process kicks this worker on boot and after every sync.
 */
export {};
