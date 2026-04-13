# Search Architecture

Deep dive on the current search pipeline. Subject to revisit — user has flagged that slowness may be rooted in the data model, not just query logic (see bottom of file).

## Flow

1. **UI** (CommandBar / HomeView) — user types query.
2. **SearchStore** — `setQuery(text)` updates state.
3. **ContentArea.tsx** — detects `query` change, fires **three parallel IPC calls**, one per content type.
4. **IPC** (`search:query`) — backend normalizes, runs FTS5 + LIKE hybrid.
5. **Results** — merged, deduped, returned to frontend.
6. **React** — `SearchResults` renders sections: Live / Movies / Series.

## Three-parallel pattern

`ContentArea.tsx` (approx lines 141–158):

```
useQuery(['search', 'live',   categoryFilter, selectedSourceIds, liveSearchLimit])   → api.search.query({type: 'live', ...})
useQuery(['search', 'movie',  categoryFilter, selectedSourceIds, movieSearchLimit])  → api.search.query({type: 'movie', ...})
useQuery(['search', 'series', categoryFilter, selectedSourceIds, seriesSearchLimit]) → api.search.query({type: 'series', ...})
```

**Why 3 not 1:** per-type result limits (20 live + 20 movies + 20 series), sections render independently, N+1 detection per type (if `result.length > limit` there's more).
**Cost:** 3× DB hits and 3× IPC roundtrips per keystroke.

## Backend logic (`handlers.ts` approx lines 420–588)

### Input args
```
{
  query: string                // "dark"
  type?: 'live'|'movie'|'series'
  categoryName?: string
  sourceIds?: string[]
  limit?: number               // default 50
  offset?: number               // default 0
}
```

### Empty query — simple browse

```sql
SELECT ...
FROM content
WHERE type = ?
  AND primary_source_id IN (...)
  [AND category_name = ?]
ORDER BY updated_at DESC
LIMIT ? OFFSET ?
```

### Non-empty query — hybrid FTS5 + LIKE

1. **Normalize:** `normalizeForSearch()` → transliterate (any-ascii), lowercase, strip ligatures. `"Café Größe"` → `"cafe groe"`.
2. **Build FTS5 expression** (space-aware):
   - Split on space. Trailing space = exact; no trailing space = prefix (`dark` → `dark*`).
   - Multi-word example: `dark knight` → `(dark AND knight*)`.
   - `"dark knight"` quoted → exact phrase.
   - Strip FTS5 reserved chars: `(){}*"^+-` (avoid injection).
3. **Special-char check** in the *original* query: `/[\[\]()_\-]/.test(query)`.
   - Contains `[`, `]`, `(`, `)`, `_`, `-` → **LIKE first** (FTS strips these).
   - Otherwise → **FTS first** (faster + ranked).
4. **Run primary + secondary:**
   ```
   if hasSpecialChars:
     primary = runLike(limit); secondary = runFts(remaining)
   else:
     primary = runFts(limit); secondary = runLike(remaining)
   ```
5. **Merge:** dedup by id, primary first, secondary fills.

### FTS5 virtual tables

- **`content_fts` (g2):** `title, original_title, plot, cast, director, genres`. Movies + series.
- **`canonical_fts` (g3):** `title, alt_names`. Channels via canonical.

FTS expression: `{title original_title}: ${titleQuery} OR {cast director genres}: "${exactPhrase}"` — title uses prefix/exact per user typing; cast/director/genres always exact phrase.

Ranking: `ORDER BY fts.rank` (BM25). Title weighted higher; concentrated matches score higher.

### Filters

- **Source (enabled):** `AND c.primary_source_id IN (SELECT id FROM sources WHERE disabled = 0)`
- **Category (junction):** `JOIN content_categories cc ... JOIN categories cat ON cat.name = ?`
- **Type:** `AND c.type = 'movie'`
- **EPG availability:** `CASE WHEN c.epg_channel_id IS NOT NULL AND EXISTS (SELECT 1 FROM epg WHERE ...) THEN 1 ELSE 0 END AS has_epg_data`. **In the live browse path this was removed** because the cross-table EXISTS was O(canonical × epg × streams) — see [g3-postmortem.md](g3-postmortem.md). Detail view can fetch availability on demand.

## Frontend post-processing

After IPC returns:
1. **Bulk user data:** `loadBulk(items.map(i => i.id))` hydrates favorites, positions, ratings.
2. **Source filtering (fav path):** favorites API doesn't accept `sourceIds`, so filtered client-side.
3. **Search state:** per-type `SearchLimit` (`SEARCH_INIT = 21`, `SEARCH_FULL = 9999`) tracks "Show all".
4. **Render `SearchResults`** with three `TypeBucket`s.

## Normalization — any-ascii

Applied at:
- **Search time** (query): ASCII conversion so `"Café"` matches `"Cafe"`, `"München"` matches `"Munchen"`.
- **FTS indexing** (insert/update): title normalized before row inserts.
- Arabic, Cyrillic, CJK currently unhandled.

Ligature folding: `fold_ligatures()` SQLite scalar + JS query-side pre-fold (`œ→oe, æ→ae, ß→ss, ﬁ→fi, ﬂ→fl, ĳ→ij`). Tokenizer is `unicode61 remove_diacritics 2`.

## Performance notes

**Costs:**
1. 3 parallel IPC calls — overhead per query.
2. Hybrid FTS + LIKE fallback — up to 2 queries per type.
3. Bulk user data load after results.
4. `SearchResults` with 3 sections + dynamic grids.
5. No caching beyond TanStack key.

**Legacy was faster because:**
- Single unified query (not 3).
- LIKE only.
- No bulk user data on search.
- Simpler UI.
- No IPC bridge in Angular build.

## Browse performance notes (g3)

After running the full manual pipeline the live browse path got slow (user: "30+ s"). Root cause investigation:

- `G3_LIVE_SELECT` had a per-row `EXISTS` for `has_epg_data` that joined streams × epg across the full paged set — killed the whole query.
- Canonical → streams aggregation with a direct JOIN GROUP BY on the entire `canonical_channels` table scans everything before `ORDER BY … LIMIT`.

Applied fixes (uncommitted on `search-rebuild-g1-g2-g3-manual-pipeline`):

1. Fixed `has_epg_data` to `0` in the browse payload (detail panel can fetch on demand).
2. Added indexes:
   ```sql
   CREATE INDEX IF NOT EXISTS idx_streams_browse ON streams(source_id, type, added_at DESC);
   CREATE INDEX IF NOT EXISTS idx_streams_title  ON streams(title);
   ```
3. **Two-phase live browse:** Phase 1 selects paged canonical IDs via a cheap `EXISTS` join to `streams` (no aggregation) + `ORDER BY … LIMIT`. Phase 2 runs aggregates only on the paged IDs.

Fix did **not** fully solve 30+ s slowness. Next direction under discussion: flatten canonical into streams (denormalize, re-think dedup separately). That is the motivation for creating a `g2-flat` branch — see bottom of [feature-buckets.md](feature-buckets.md).

## Strategic rethink — is the slowness structural?

User flagged: *"we may need to revisit our data model."*

Legacy (fast):
- Single unified query, all types.
- LIKE-only substring on title.
- 2000-candidate ceiling, client filter.
- Simple.

Current (slow):
- 3 parallel queries (type-scoped).
- FTS5 + LIKE hybrid with transliteration.
- No candidate limit.
- Complex, 3–5× overhead + canonical joins.

Questions worth asking before the next round of query optimization:

1. Do we really need 3 queries, or is the schema forcing it?
2. Is FTS5 overkill for this corpus vs. indexed LIKE?
3. Is source dedup via canonical helping or hurting?
4. Would a denormalized search table (one row per stream with everything inlined) beat the current structure?
5. Should we cache search results more aggressively?

No implementation yet — reconnaissance only.
