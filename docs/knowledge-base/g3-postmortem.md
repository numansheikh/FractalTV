# g3 integration bug postmortem (2026-04-13 / 14)

First g3 integration session surfaced three breakages. Common thread: the pipeline assumed iptv-org would match most channels. It didn't — tvg_id coverage was **10%** on the test source (1,460 of 14,503 live streams), and Pass 2 exact-title normalization couldn't strip provider prefixes (`IT:`, `PK |`, `USA ➾`). Result: **99.8% of canonicals ended up synthetic**, carrying provider noise into the layer that was supposed to be canonical.

## Lessons to keep for phase 2 and beyond

### 1. Don't assume density of external enrichment

Design canonical flows to still look sane when 99%+ of rows are synthetic. Any feature that relies on iptv-org-only fields (country flag, iptv-org categories, logos) must degrade gracefully for synthetic canonicals. Don't build UX that falls apart without the enrichment density you wished for.

### 2. Namespace discipline

Channel categories have **two namespaces**:
- **Provider categories** (e.g. "USA ➾ News") in the `categories` table.
- **iptv-org tags** (e.g. "news", "entertainment") in `canonical_channels.categories` JSON.

The sidebar counts and filter selections come from the provider side.

**Never filter canonical queries by `cc.categories` when the user-visible filter was built from provider categories.** Always JOIN through `stream_categories` → `categories.name`. Mixing namespaces → silently empty grids.

### 3. Don't pass SQL sentinel strings

`hydrateCanonicalLive` crashed because `'rank-order'` got interpolated into `ORDER BY rank-order` (reserved word, minus op). Use a flag + branch, not a magic string in a SQL position.

### 4. FTS needs LIKE fallback

Empty FTS result ≠ "show nothing". Channels search returned 0 silently on `"hum"` because `canonical_fts` had no hit and there was no fallback. Always check fallback coverage before declaring search done.

### 5. Provider prefix stripping is needed before Pass 2 can match

10% tvg_id coverage + prefix-blind Pass 2 = near-100% synthetic. Pass 2 redesign (substring match with word boundaries + country tiebreaker) is the planned fix — see [manual-pipeline.md](manual-pipeline.md).

### 6. Per-row EXISTS subqueries will tank browse

`has_epg_data` in the live browse payload used an `EXISTS` that joined streams × epg **for every canonical row**. Browse hit 30+ seconds. Fixed it to `0` in the browse payload; detail view can fetch on demand. General rule: **any per-row subquery on a paged grid query is suspect.** Paging ids first, aggregates second, is the pattern.

### 7. Auto-chain hides which step actually failed

Add-source auto-chained Sync → FTS → Canonical → Canonical FTS + background EPG. If a later step broke, the UX showed a generic "sync failed" and it took reading logs to find out which. Moving to a 7-step manual pipeline (see [manual-pipeline.md](manual-pipeline.md)) means every step has its own button, its own terminal log line, its own last-run timestamp. Diagnosis speed went up roughly an order of magnitude.
