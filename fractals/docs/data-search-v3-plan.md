# Data & Search bucket — working plan

## Context

Bucket 1 of the Fractals backlog. The Fractal Content Data Model sketch (provider layer + canonical identity + rich meta) is the target. Phase 2 already partially realized it — V2 schema has canonical / streams / user_data split, FTS5 on canonical, TMDB enrichment worker. The remaining work is restructuring canonical into a truly source-independent identity layer, redesigning search on top of it, and making the metadata provider pluggable.

Current phase of this bucket: **scoping and design**. Implementation not started. The four original blocking decisions are being worked through one at a time; decisions are being locked as we go.

---

## Locked decisions

### L1. Light vs rich meta — the cleavage (partial: VoD done, Live TV open)

**Rule:** *Light = derivable without any external API, or available zero-friction (iptv-org for live). Rich = API-gated (TMDB, OMDB, etc.).*

This replaces "small fields vs big fields" and "free tier vs paid tier" as the framing. Light is what the app can compute from what the provider already gave, with no network call that can fail.

**VoD canonical-light fields (locked):**
- `id` — surrogate UUID
- `type` — movie | series
- `normalized_title` — derived by stripping prefixes, language tags, quality tags, brackets, year from the provider title
- `year` — regex from title or provider field
- `language_hint` — regex prefix ("EN - ")
- `content_hash` — `sha1(normalized_title + year + type)`, cross-source dedup key

**NOT on canonical (stay on stream row):**
- `poster_url`
- `plot`, `genre`, `rating`, `cast`, `director` — even when Xtream returns them
- Any provider-supplied extras

Display layer does `COALESCE(canonical.*, stream.*)` so the stream-level data fills gaps until an oracle populates canonical. Posters are picked at render time from linked streams, not cached on canonical — "best poster" changes when new sources are added.

**Live TV side of L1 is NOT YET discussed.** iptv-org integration, EPG, channel identity all still open.

---

### L2. Canonical is mutable by an "oracle"

Canonical starts with whatever Xtream gives us at sync time, is upgraded later when an oracle (TMDB initially, other providers later) resolves the entry. Canonical fields are **authoritative over time, not frozen at first-sight**.

This means L1's "canonical light fields" are populated eagerly at sync, then overwritten as oracle data arrives. No empty-until-TMDB state.

**Merge policy on oracle overwrite is still open** (the old blocker #3). Parked pending decision: full overwrite, field-by-field, preserve certain fields, vote between multiple Xtream sources, etc.

---

### L3. Three-layer storage: streams → association → canonical

**Layers:**
- **Streams (raw):** unchanged provider inventory
- **Association (bridge):** 1:1 with provider catalog entries. Structured columns for common dimensions (`language`, `category_name`, `quality`, `stream_url`) plus a `provider_metadata` JSON bag for everything else the provider returned. `canonical_id` FK, nullable until matched.
- **Canonical (identity + light meta):** the L1 fields above

**Key rules:**
- Association row = the provider's catalog entry verbatim. If Xtream has Matrix under "Sci-Fi" and "1999 Movies" in the same source, that's **two association rows**, both pointing at one canonical. The association table mirrors the provider's catalog without lying about it.
- **No URL dedup inside a source** — preserve the provider's catalog shape; display/play layer handles URL collisions.
- Possibly merge streams and association into one table (rename). Open implementation detail.

This replaces the "canonical with everything bolted on" model. Rebuilds are cheap: wipe associations, re-run matching, regenerate.

---

### L4. Search has two modes, encoded in the query string itself

**Basic mode:** fast path, canonical-only FTS5.
- No prefix
- Hits `canonical_fts` only
- Tiny result set, one JOIN to fetch streams for display
- Sub-100ms
- Shows *only matched content* (rows with non-null canonical_id)
- Unmatched streams are invisible here — this is intentional, it's the "your library looks better after enrichment" story

**Advanced mode:** string-directive, triggered by `@` prefix.
- `@` as the first character flips advanced mode. The advanced button in the UI *just prepends `@`*. No React state to sync — the string IS the query mode.
- The `@` is colored differently in the input to signal directive mode.
- Position-invariant parser: scans all tokens, matches against vocabularies, non-matching tokens become free text.
- No colons, no `key:value` — pure shorthand.
- Shorthand vocabularies: ISO 639 language codes, quality (`hd`, `4k`, `sd`), year (4-digit), type (`movie`, `series`, `live`), source aliases, category shorthand.
- Includes streams-side filters (language, category, etc.) because those live on association, not canonical.
- Includes unmatched streams via `streams.source_title LIKE` fallback.
- User expects slower.

**Examples parse like:**
- `@fr matrix` → lang=fr, title="matrix"
- `@matrix fr` → lang=fr, title="matrix"
- `@fr hd matrix` → lang=fr, quality=hd, title="matrix"

---

### L5. Year is a soft filter (rank boost, not exclusion)

`@matrix fr 1999` and `@matrix fr 2000` should resolve to the same movie. Year in advanced mode boosts matching/near years, doesn't exclude others. Strict year isn't the right default for IPTV search because provider data often gets years wrong or misses them entirely.

---

### L6. Dual-interpretation for numeric tokens

Numbers in advanced queries are ambiguous: `@2001 odyssey`, `@300`, `@1984` break the "number = year filter" rule because the number is part of the title.

**Rule:** parser doesn't commit. Runs BOTH interpretations, merges, ranks by match quality.
- Interp A: number as year filter
- Interp B: number as title token
- Merge, prefer exact canonical title matches.

Result:
- `@2001 odyssey` → "2001: A Space Odyssey" wins top slot
- `@300` → the movie wins (year=300 interpretation empty)
- `@1984` → the movie "1984" ranks first, other 1984 movies fill below

**Cheap optimization:** at parse time, quick index lookup — does any canonical title contain the numeric string? If yes, keep both interpretations. If no, skip interp B.

This bonus also handles shorthand collisions (`@en` = language vs title; `@hd` = quality vs title).

---

### L7. Fuzzy/matching stack for the light layer (1-2GB Android budget)

Target: runs on a 1–2GB RAM Android device with the app itself already resident (~200-400MB). Embedding budget ~20-50MB max on 1GB.

**The stack that fits 1GB easily, locked:**
1. **FTS5** — order-invariance, bag-of-words, stemming (already in SQLite, free)
2. **Trigram sidecar** — typo tolerance (`matrx` → `matrix`), ~2–5 MB for 100K rows
3. **Dual-interpretation parser** (L6) — numeric-title edge case
4. **Soft year filter** (L5) — year as rank boost
5. **Query normalization** — parse + sort + hash to produce canonical query form; equivalent queries collide in a result cache

**No embeddings in the light layer.** Decision point: level 5+ (fastText, MiniLM) are too heavy for 1GB budget, and don't uniquely solve any of the patterns L1–L6 cover.

Embeddings (if ever) are a rich-meta / pro-tier concern, for different capabilities (semantic similarity like "keanu action movie" finding Matrix). Out of scope for the light layer.

---

## Open decisions

### O1. Live TV side of the light/rich split — **RESOLVED by L10**

iptv-org plays the oracle role for Live. Bulk lookup, on-demand fetch at first sync, low-priority background refresh. See L10.

### O2. Canonical identity scheme — **RESOLVED as L11**

See L11 below. Auto-increment integer PK chosen over UUID for local-first SQLite efficiency. `content_hash` is a unique-indexed lookup key, not the PK. `imdb_id`/`tmdb_id`/`wikidata_qid` are nullable oracle-populated columns.

### O3. Merge policy when oracle overwrites — **RESOLVED by L12**

See L12 below.

### O4. Canonical name source at sync time — **RESOLVED by L14**

See L14 below. Two-output parse (normalized_title + metadata bag), strip-and-capture rules, NFKC + European diacritic fold only, non-Latin scripts preserved as-is and resolved by oracle via Wikidata multilingual labels.

---

## Discussion log (informative alternatives we considered)

This section exists so we don't re-debate settled questions and so the rationale survives the session.

### D1. Canonical PK scheme

Discussed four options:
- tmdb_id directly — rejected, see O2
- content hash — rejected, see O2
- surrogate UUID + nullable tmdb_id — leaning toward this (O2)
- hash-then-promote — rejected, PK migration pain

### D2. Canonical as frozen vs mutable

Two directions considered:
- **Frozen (my first proposal):** canonical is lean universal fields only; everything else lives in a rich-meta sidecar that gets populated by TMDB. Display does COALESCE.
- **Mutable oracle-driven (user's direction, locked as L2):** canonical populated eagerly from Xtream at sync, oracle upgrades fields over time. Association table is the explicit source→canonical bridge with language as first-class.

Mutable won because:
- No empty-until-TMDB state
- Day-one UX has real data
- Rebuild is cheap (wipe associations, not canonical)
- Language becomes a queryable dimension, not a field on a stream

Trade-off: merge policy becomes an open question (O3). Frozen model didn't have this problem because oracle never "overwrites" anything.

### D3. Association row granularity

Two shapes:
- `(source, title, language)` — dedup within source
- `(source, source_stream_id)` — 1:1 with provider catalog (locked as L3)

Locked the 1:1 shape because it preserves the provider's catalog faithfully and lets canonical absorb duplication at the identity layer instead.

### D4. Structured columns vs JSON bag

Association row uses *both*: structured columns for common queryable dimensions (`language`, `category_name`, `quality`), JSON bag (`provider_metadata`) for everything else the provider returned. Rejected pure JSON (slow queries) and pure structured columns (schema churn for provider-specific fields).

### D5. Search mode detection — three candidates

- Explicit toggle button (hidden filter panel)
- Always-visible filter bar (mode implicit in filter state)
- **String-encoded directive via `@` prefix** (locked as L4)

Locked string-encoded because it makes the string the single source of truth, the button is pure sugar, queries are bookmarkable/shareable, and the `@` gives visual feedback via colored rendering.

### D6. Shorthand vs key:value in advanced

- `@lang:fr matrix` — structured, unambiguous, more to learn
- `@fr matrix` — shorthand, natural, needs vocabulary matching (locked as L4)

Locked shorthand. Position-sensitive was considered and rejected (L4 final is position-invariant) so that `@matrix fr`, `@fr matrix`, `@matrix fr 1999` all parse identically.

### D7. Unmatched content in basic mode

- Hide in basic, show in advanced (locked)
- Show in basic with streams.source_title LIKE fallback (rejected — makes basic slow)

Locked hide-in-basic because it keeps the fast path genuinely fast and creates a real "library quality improves with enrichment" story.

### D8. Embeddings in the light layer

Considered six levels:
1. Stemming (Porter) — free, in FTS5 already
2. Trigrams — ~bytes/row, typo tolerance (locked as L7 step 2)
3. SimHash / MinHash — 8-32 bytes/row
4. Feature hashing — ~25MB for 100K rows, borderline on 1GB
5. fastText compressed — ~50MB total, borderline on 1GB
6. MiniLM ONNX — ~275MB, does not fit 1GB

Locked stack: levels 1-2 (plus the parser tricks L5, L6). Levels 3-6 rejected for the light layer. Embeddings reconsidered only as a pro-tier / rich-meta capability for queries the parser can't handle ("keanu action movie").

---

### L8. Keyless light-oracle pipeline (VoD)

**Rule:** at sync time, after first-write canonical is populated from Xtream, a background oracle upgrades canonical fields using free, keyless sources. No user API key required.

**Pipeline (option C from discussion):**
1. **IMDb suggest** (`sg.media-imdb.com/suggests/{first-char}/{query}.json`) — unofficial JSONP endpoint, title-domain, returns `id` (tconst), `l` (title), `y` (year), `q`/`qid` (type), `i` (poster URL + dims), `s` (cast stars string). One call, ~200-400ms, English-biased.
2. **Wikidata by tconst** (`wbgetentities` after `haswbstatement:P345={tconst}` search) — official, stable. Returns multilingual labels and claims (P4947 tmdb_id, P31 type, P577 year, P1476 original title).
3. **Fallback** on IMDb miss: `wbsearchentities` on original title → filter by P31=film and P577≈year.

**Canonical-light fields gained via oracle (beyond L1):**
- `imdb_id` (tconst)
- `tmdb_id` (from WD P4947 when present)
- `wikidata_qid` (bookkeeping)
- `multilingual_labels` (10+ languages, from WD)
- `poster_url`, `thumbnail_url`, `poster_w/h` (from IMDb `i` + Amazon URL transform — no extra call)

**Promoted to light from original L1 "dropped" list:**
- `poster_url` and `thumbnail_url` — free from IMDb suggest, no extra call. Promotion rationale: "light = acquired in the same calls we already make for identity" (sharper version of L1 rule).

**NOT promoted (stay rich):**
- Director, genre, country, production companies — WD returns Q-IDs requiring N extra calls to resolve names. Unbounded cost.
- Plot, keywords — not available keyless.
- Full cast — WD P161 is Q-IDs (50+ calls typical). IMDb `s` string (2-3 names) is a mini exception, candidate for promotion if UX cares.

**Cost (per canonical row):**
- Network: ~700ms-1.5s per item, ~15-35 KB ingress
- Storage: ~1 KB per canonical row (with labels + poster URLs)
- 30k movies, 10 concurrent → ~50 min background pass
- Subsequent syncs: 0 oracle cost (canonical already resolved)
- Cross-source dedup: 0 oracle cost (content_hash match)

**Rate limits:**
- IMDb: undocumented, safe at ~10-20 rps sustained
- Wikidata REST: safe at 10 concurrent, risky at 20+
- SPARQL avoided for per-item path (stricter timeouts)

**Determinism:**
- Per-call output fully deterministic
- IMDb endpoint availability not guaranteed (unofficial); Wikidata is reliable
- Degradation path: IMDb broken → Wikidata-only (option B), slower for English titles but functional

**Configurability (default behavior):**
- In-app rate limiter with circuit breaker (10 consecutive failures → pause provider 5 min)
- Backoff on 429/5xx: exponential 1s→60s, 3 retries
- Tier picker at install time: **Basic** (oracle off) or **Enhanced** (oracle on, background, wifi-only on mobile)
- Changeable from settings later
- Max concurrency, daily quota, "enrich on cellular" are all settings

---

### L9. Onboarding flow (follow-up, not blocking)

**Scope:** first-run UX that combines experience-tier picker with Xtream source add dialog. Shape TBD during implementation phase.

**Sketch (option C from discussion):**
1. Welcome screen — what Fractals is, "let's add a source"
2. Source dialog — credentials + "Auto-enrich from free metadata sources (recommended)" checkbox (default on for desktop/TV/wifi, off for cellular)
3. Sync starts on save
4. Post-sync: oracle runs background with visible progress indicator

Tier choice collapses to a single checkbox (only 2 tiers today: Basic, Enhanced). Rich tier (paid, TMDB key) becomes a separate gate later, out of onboarding.

**Parked for later discussion.** Added here so it doesn't get lost.

---

### L10. Live TV light-oracle (iptv-org, bulk lookup)

**Rule:** Live TV's light oracle is iptv-org. Bulk dataset fetched on-demand at first sync, cached locally, refreshed weekly as a low-priority background task.

**Source:** `iptv-org.github.io/api/channels.json` (and related files: categories, languages, countries). ~10k curated channels, a few MB uncompressed, under 1MB on the wire. Free, keyless, no rate limit, community-maintained.

**Fetch model:** on-demand (not bundled). User is already online at first sync (they're hitting Xtream); no offline-first story to protect. Bundling stale data at release adds size for no real benefit.

**Background priority:** fetch + refresh runs as a low-priority thread. Never competes with foreground work (sync, playback, UI). If network flakes, keep the old cached copy.

**Matching path:**
1. Provider gives `tvg-id` / `epg_channel_id` → direct lookup in iptv-org channels (same namespace)
2. No tvg-id → fuzzy match on normalized name + country hint against iptv-org `name` + `alt_names`
3. No match → canonical stays at first-write provider data; retry on next refresh

**Live canonical-light fields (mirrors VoD L1 shape):**
- `id` — surrogate UUID
- `type` — `live`
- `iptv_org_id` — tvg-id namespace ID (e.g. `BBCOne.uk`) when matched
- `canonical_name` — iptv-org clean name
- `country` — ISO code
- `languages` — ISO codes
- `categories` — iptv-org taxonomy
- `network` / `owners` — grouping dimension
- `logo_url` — iptv-org curated (better than provider logos)
- `is_nsfw` — parental controls
- `broadcast_area` — geo
- `content_hash` — sha1(iptv_org_id) or sha1(name+country+network) as fallback

**Key difference from VoD oracle:**
- Bulk dataset vs per-item API calls
- ~microseconds per lookup vs ~1s per VoD item
- Single provider (iptv-org) vs two (IMDb + Wikidata)
- Refresh is scheduled, not triggered per sync

**Coverage:** strong for mainstream channels (~70-90%), weak for premium/PPV/regional. Long tail stays at first-write provider data.

**Refresh cadence:** weekly default, user-configurable (off / weekly / monthly). Low-priority background thread.

---

### L11. Canonical PK = auto-increment integer

**Decision:** canonical table PK is an auto-increment integer. Not UUID, not content_hash, not tmdb_id/imdb_id.

**Rationale:**
- Fractals is local-first; no cross-device sync on the roadmap. Integer PKs don't need global uniqueness.
- 8 bytes vs 16 (UUID) — faster joins across streams/association/canonical, which is the hottest search path.
- Stable: never recomputed, survives any oracle overwrite.
- Simpler migrations and FK integrity than hash-based PKs.

**Lookup vs PK separation:**
- `content_hash` = sha1(normalized_title + year + type) lives as a **unique index**, not PK. Used at sync time to answer "do we already have a canonical for this (title, year, type)?" before inserting.
- If oracle corrects the year later, content_hash may be recomputed (policy TBD in O3) — but PK stays put, FKs unaffected.

**Oracle identifiers (nullable columns, not PK):**
- `imdb_id` (tconst)
- `tmdb_id`
- `wikidata_qid`

**Migration path if cross-device sync ever becomes a goal:** add a `uuid` column, backfill with UUID v7, flip FKs. Not a hard migration; deferred until there's an actual sync story.

---

### L12. Merge policy (simplified)

**Rule:** Oracle writes through. Two per-stream user actions. Empty canonicals auto-deleted.

**Policy:**
1. Oracle overwrites canonical light fields by default when it resolves a match or refresh.
2. Two per-stream actions in the detail panel:
   - **"Wrong match"** — splits the stream into a new canonical containing its first-write data. No oracle re-run.
   - **"Re-fetch metadata"** — re-runs the oracle on this stream. Result may associate with an existing canonical (merge), create a new canonical, or return multiple candidates for manual picking.
3. **Manual match path** — user searches IMDb/Wikidata directly and picks from the candidate list. Bypasses the automatic matcher entirely. Replaces the existing TMDB manual-match UX.
4. Oracles can return multiple candidates (IMDb suggest ≤8, Wikidata search ≤20). Auto-matcher picks top by fuzzy + year; manual-match path surfaces the full list.
5. Empty canonicals (no streams pointing at them) are deleted automatically during oracle runs or a periodic sweep.

**Deferred:**
- Field-level locks — nice-to-have but adds complexity. Revisit if users actually ask for surgical overrides.
- Xtream-vs-Xtream consensus voting — not needed; oracle overwrites temporary first-write data anyway.
- Oracle-vs-oracle arbitration (IMDb 1999 vs Wikidata 2000) — extremely rare, fall back to primary source in the pipeline (IMDb first).

**Merge case (two canonicals revealed to be one):**
When oracle resolves two canonicals to the same external identifier (`imdb_id` / `tmdb_id`):
1. Keep the canonical with more streams attached (tiebreak: lower PK).
2. Move all association rows from the loser to the winner.
3. Delete the loser canonical row.
4. Recompute `content_hash` on the winner if it was recomputed by oracle.

---

### L13. Canonical scope: search + cross-reference, not display driver

**Rule:** Canonical is a search identity and cross-reference layer. It does not reorganize browse or drive card display.

**What canonical IS used for:**
1. **Search identity** — basic FTS5 mode hits canonical, advanced mode pulls across canonical + streams. Cross-language search works via canonical's multilingual labels.
2. **Cross-reference** — "this stream has N sibling versions from other sources" — surfaced via canonical → association lookups.
3. **Merge/dedup detection** — oracle resolves two canonicals to the same external ID → merge them (L12).
4. **Detail panel enrichment** — canonical section (clean title, multilingual labels, poster, oracle-corrected year) appears above a stream section in the detail panel. Layout is a later UI decision.

**What canonical is NOT used for:**
1. **Browse grids.** Grids stay provider-organized (by category / type / source). Cards show stream data (title, provider poster). Grids don't dedup by canonical.
2. **Display in cards.** Card shows the stream's own data — provider title, provider poster (or canonical poster as a later UI option). Not the canonical title by default.
3. **User data keys.** Favorites, watchlist, continue-watching, ratings stay keyed **per stream**, not per canonical. Same movie on two sources = two favorite entries. Simpler, preserves user intent tied to specific sources.
4. **Search result collapsing.** Search returns **one result per stream** (not one per canonical). Three streams of Matrix = three result cards. Canonical only affects which streams are considered matching the query.

**UX consequence of this scoping:**
- A wrong oracle match degrades **search quality only** — it never poisons the browse grid or swaps a card's display unexpectedly.
- Blast radius of oracle errors is small and recoverable.
- Grids remain faithful to what the provider gave; the app never "reorganizes" a user's library behind their back.
- User mental model: **browse = my sources as-is, search = my whole library**.

**Deferred to UI phase:**
- How the "N sibling versions" affordance appears on a card (badge, chip row, expandable).
- Cross-language match hints ("matched via Russian label") on search results.
- Detail panel layout specifics (canonical section above, stream section below, separator style).

---

### L14. Title normalization rules

**Rule:** Parse the raw provider title into two outputs — a `normalized_title` string for hashing/oracle, and an extracted-metadata bag (language, origin, quality, year) written to structured columns.

**Strip-and-capture rules (strip from title, keep the value):**
1. **Leading language prefixes** — `EN - `, `FR - `, `AR-IN - `, `|UK|`, `[FR]`, etc. → `language_hint`
2. **Trailing country/origin tags** — `(DE)`, `[US]` → `origin_hint`
3. **Quality tags** — `[4K]`, `(1080p)`, `(HEVC)`, `(HD)`, `[MULTI]` → `quality_hint`
4. **Year pattern** — `(YYYY)` or trailing `YYYY` in range 1900-2099 → `year`

**Do NOT strip:**
- Numbers embedded in the title body — `1984`, `300`, `2001: A Space Odyssey` stay intact. L6 (dual-interpretation) handles these at search time.

**Clean the remainder:**
1. Unicode NFKC normalization (width, ligatures)
2. Lowercase
3. Diacritic fold via `any-ascii` — **European scripts only**
4. Non-European scripts (Arabic, Cyrillic, CJK, Hebrew, etc.) pass through **unchanged**
5. Collapse whitespace

**Non-Latin script strategy:**
- Never transliterate non-European scripts at ingestion. The oracle does the cross-script identity work via Wikidata multilingual labels.
- `content_hash` is script-specific. Two sources with the same film in different scripts initially get different canonicals; oracle merges them later via Q-ID / imdb_id / tmdb_id match (L12 merge case).
- Hybrid titles (`The Matrix المصفوفة`) keep both scripts in `normalized_title`.

**Oracle routing hint:**
- `language_hint = en` or absent + Latin script → **IMDb suggest first**, Wikidata by tconst second.
- `language_hint = ar/fa/he/ru/ja/zh/hi/...` or title is non-Latin → **Wikidata `wbsearchentities` first** in that language, IMDb as fallback.

**Where outputs land:**
- `normalized_title`, `year` → canonical (identity fields, drive `content_hash`)
- `language_hint`, `origin_hint`, `quality_hint` → association row structured columns
- Raw provider title → stream row, untouched

**Accepted limitation:**
- Fully transliterated provider titles (`Al Masfoofa` instead of `المصفوفة` or `The Matrix`) may not match any Wikidata alias. Those stay at first-write provider data with `oracle_status = no_match`. User can manually match via the L12 manual-match path.

**Design principle:**
Normalization is intentionally minimal — good enough to collapse obvious duplicates into the same `content_hash`. Fuzzy matching (L7) and cross-script identity (oracle) handle the rest.

---

## Status / next steps

**Progress:** 14 decisions locked (L1–L14), 0 open. **All original blockers (O1–O4) resolved.**

**Design phase complete.** Implementation plan below.

---

# Implementation plan

## Context

14 design decisions (L1–L14) define a V3 data model: streams → association → canonical, with light canonical identity populated at sync and upgraded by a keyless enrichment pipeline (IMDb suggest + Wikidata for VoD, iptv-org bulk lookup for Live). Canonical is scoped to search + cross-reference, not display.

The current codebase is on V2 (Phase 2 complete) — canonical + streams split exists, TMDB enrichment worker exists, FTS5 search on canonical exists. V3 rebuilds on that foundation: adds the association layer, replaces the TMDB-centric enrichment worker with a pluggable `MetadataProvider` interface, adds IMDb + Wikidata + iptv-org providers, and rewrites the title normalizer.

Work is phased to keep the app shippable between phases.

## Phased approach

### Phase A — Schema migration (V2 → V3)

**Goal:** introduce the association layer without breaking V2 reads.

- Add `associations` table: `id` (PK int), `stream_id` (FK), `canonical_id` (FK), `language_hint`, `origin_hint`, `quality_hint`, `provider_metadata` (JSON).
- Adjust `canonical` table: add nullable `imdb_id`, `tmdb_id`, `wikidata_qid`, `multilingual_labels` (JSON), `poster_url`, `thumbnail_url`, `oracle_status`, `oracle_version`, `oracle_attempted_at`. `content_hash` remains a unique index.
- Migration script: for every existing V2 stream row, create a matching association row pointing at its existing canonical.
- Drizzle schema updated in `electron/database/schema.ts`.
- SQL migration added to `electron/database/migrations/`.

**Verification:** V2 reads still work (handlers route through association). Row counts match: streams == associations after migration.

### Phase B — Title normalizer (shared utility)

**Goal:** a single normalization function used by sync and enrichment per L14.

- New module `electron/services/title-normalizer.ts` exporting `normalize(raw: string) → { normalizedTitle, year?, languageHint?, originHint?, qualityHint? }`.
- Implements L14 strip-and-capture rules, NFKC, European diacritic fold, whitespace collapse, non-Latin passthrough.
- Unit tests covering: English, French, Arabic, hybrid, `1984`/`300`/`2001` edge cases, `EN - Title (2020) [4K]` full stack.

**Verification:** Unit test suite passes. Run normalizer against a real Xtream sync snapshot and spot-check 20 random titles.

### Phase C — MetadataProvider interface + providers

**Goal:** pluggable enrichment per L8 (VoD) and L10 (Live).

- Define `MetadataProvider` interface in `electron/services/enrichment/provider.ts`:
  - `lookupByTitle(query, hints) → Candidate[]`
  - `lookupByExternalId(type, id) → Candidate`
  - `name`, `priority`, `supports(languageHint, script)`
- Implementations:
  - `electron/services/enrichment/providers/imdb-suggest.provider.ts` — unofficial JSONP endpoint, English-biased, returns tconst + year + type + poster.
  - `electron/services/enrichment/providers/wikidata.provider.ts` — `wbsearchentities` + `wbgetentities`, multilingual labels, P345/P4947 cross-refs.
  - `electron/services/enrichment/providers/iptv-org.provider.ts` — bulk `channels.json` fetch, local lookup by tvg-id, fuzzy fallback on name + country.
  - Existing `tmdb.service.ts` refactored into a provider (rich-tier, deferred but interface-compatible).
- Rate limiter + circuit breaker in `electron/services/enrichment/rate-limiter.ts` per L8 config (10 concurrent IMDb, 5 Wikidata, exponential backoff).

**Verification:** Each provider has a small integration test fixture. Provider chain resolves "The Matrix" to `tt0133093` via IMDb → Q83495 via Wikidata → full canonical light set.

### Phase D — Sync worker rewrite

**Goal:** sync writes V3 shape; enrichment runs as a separate queue.

- `electron/workers/sync.worker.ts` updates:
  - For each Xtream stream: run title normalizer, compute `content_hash`, find-or-create canonical by hash, create association row.
  - Do NOT call enrichment inline. Just mark canonical `oracle_status = pending`.
- New `electron/workers/enrichment.worker.ts` (replaces the existing TMDB enrichment worker):
  - Pulls `oracle_status = pending` canonicals in batches.
  - Routes per L14 hint: Latin script → IMDb first, non-Latin → Wikidata first.
  - Writes back to canonical, honors L12 merge logic (merge two canonicals when external ID matches).
  - Low-priority background thread, respects rate limiter.

**Verification:** Full sync of a test Xtream source produces expected counts of stream/canonical/association rows. Enrichment worker processes pending canonicals and ends at `oracle_status = resolved` or `no_match`.

### Phase E — iptv-org integration (Live)

**Goal:** Live channels get canonical identity from iptv-org per L10.

- Fetcher: downloads `channels.json` on-demand at first sync of any Live source, caches to `electron/database/iptv-org-cache/`, refreshes weekly via low-priority background task.
- Matcher: for each Live stream, try direct lookup by provider tvg-id → iptv-org id, fallback to fuzzy (name + country) match against `name` + `alt_names`.
- Writes iptv-org fields to canonical (`canonical_name`, `country`, `languages`, `categories`, `network`, `logo_url`, `is_nsfw`, `broadcast_area`).

**Verification:** Add a test Xtream source with Live channels, observe iptv-org match rate. Expect ~70-90% on mainstream channels.

### Phase F — Search IPC updates

**Goal:** implement L4 two-mode search with `@` prefix directive and L6 dual-interpretation.

- Parser: `electron/services/search/query-parser.ts` — detects `@` prefix, tokenizes, matches against vocabularies (ISO 639, quality, year, type, source aliases), handles L6 dual-interpretation for numeric tokens.
- Basic mode handler: FTS5 on canonical, single JOIN to streams for display. Fast path.
- Advanced mode handler: canonical FTS + streams `source_title LIKE` fallback + structured filters (language, quality, origin) from association columns.
- Existing `search.service.ts` gets a new router by query mode.

**Verification:** Queries `matrix`, `@fr matrix`, `@matrix fr 1999`, `@2001 odyssey`, `@300`, `матрица` all return expected results.

### Phase G — UI updates

**Goal:** reflect L12 (wrong-match / re-fetch) and L13 (canonical scope in detail panel) in renderer.

- Detail panel: canonical section on top (clean title, year, multilingual chips, poster), separator, stream section below (provider title, provider data, source dot). See L13.
- "Wrong match" and "Re-fetch metadata" buttons in detail panel (L12). Manual match candidate list when enrichment returns multiple candidates or user re-fetches.
- Browse grids unchanged (L13 — provider-organized, stream-data cards).
- Search result cards show one per stream, grouped visually when N > 1 streams map to the same canonical (UI specifics deferred per L13).
- Onboarding flow from L9 — welcome + source dialog with "Auto-enrich from free sources" checkbox. Defaults from platform detection.

**Verification:** Manual UX test of the flows: sync a source, see enrichment progress, open a detail panel, click "Wrong match" and confirm split, click "Re-fetch" and confirm new match.

## Critical files

**Confirmed from session context (CLAUDE.md):**
- `electron/database/schema.ts` — Drizzle schema (add association table, canonical columns)
- `electron/database/migrations/` — add V3 migration SQL
- `electron/workers/sync.worker.ts` — rewrite for V3 write shape
- `electron/workers/enrichment.worker.ts` — replaces the TMDB-only enrichment worker
- `electron/services/tmdb.service.ts` — refactor into `MetadataProvider` implementation
- `electron/services/search.service.ts` — add mode router, new advanced-mode handler
- `electron/ipc/handlers.ts` — new handlers for wrong-match, re-fetch, manual-match-list
- `src/stores/search.store.ts` — support `@` prefix directive, advanced-mode state

**To be confirmed during Phase A** (content/series detail panel files were deleted in recent commits; new location needs verification):
- Wherever the current detail panel lives (previously `src/components/content/ContentDetail.tsx`, now removed)
- `src/components/search/` — advanced mode visual indicator, result grouping

## Existing utilities to reuse

- `any-ascii` — already in use for European diacritic fold
- `better-sqlite3` + Drizzle — existing DB layer, no new ORM
- FTS5 — existing canonical FTS setup; extend, don't replace
- Worker threads infrastructure — sync worker pattern already exists
- Rate limiter — check if one exists in `electron/services/` before building

## Phasing rules

- Each phase must leave the app in a runnable state. No multi-phase uncommittable changes.
- Phase A is the only schema migration; everything after is code-only.
- Phases B, C, E can run in parallel on side branches if we want.
- Phases D, F, G are sequential (D depends on B+C, F depends on D, G depends on F).

## Open implementation-time questions

1. Existing TMDB enrichment worker behavior during migration — how do we disable it without losing its TMDB matches already on V2 canonical? (Carry them forward into V3 as the tmdb_id column.)
2. FTS5 index rebuild strategy during the migration — rebuild incrementally or all-at-once?
3. Where does the detail panel live now? Identified file needs lookup in Phase A.
4. Do we keep the existing "manual TMDB search" UI and re-point it at the new manual-match path, or build fresh?

These are scoped to implementation execution and don't block starting Phase A.

## Parallel unblocked work

`MetadataProvider` interface refactor (Phase C work) can begin independently on a side branch — does not depend on schema migration. TMDB refactors into a provider; IMDb and Wikidata providers added. Merges cleanly into main Phase C work later.
