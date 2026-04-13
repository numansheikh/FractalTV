# g3 Canonical Layer — locked design decisions

Locked 2026-04-13 for Phase 1 (live channels). Phase 2 (VoD) pending.

## Why

Keyless enrichment — no API keys. iptv-org is public (~39K channels, CC0 data) so every live stream can get a canonical row either by iptv-org match or by title normalization. Runtime reads stay single-table.

## Schema

### `canonical_channels` — denormalized
- `id` UUID PK
- `title`
- `country`
- `network`
- `owners` JSON
- `categories` JSON
- `is_nsfw`
- `launched`, `closed`, `replaced_by`
- `website`
- `logo_url`
- `iptv_org_id` TEXT nullable, indexed
- `alt_names`
- `created_at`, `updated_at`

Denormalized on purpose: synthetic canonicals (unmatched streams) need their own data; runtime reads stay single-table.

### `streams` additions
- `canonical_channel_id` FK
- `user_flagged INTEGER DEFAULT 0` — column added now, logic deferred.

### `channel_user_data`
Dropped and rebuilt keyed by `canonical_channel_id`. Pre-release, favorites were expendable.

### `canonical_fts`
FTS5 virtual table over `canonical_channels(title, alt_names)`. Live channels only. VoD FTS (movies / series) unchanged in `content_fts` — deferred to Phase 2 / g5.

## Canonical ID format

**Local UUID (Option B).**

- `iptv_org_id` is a separate nullable column.
- Join to iptv-org only fires at batch match time — never at runtime browse / search.

## Match strategy (sync-time)

1. **Exact tvg_id** — `stream.tvg_id == iptv_channels.id` → link + copy iptv-org fields into canonical.
2. **Normalized title + alt_names** — exact today; substring redesign pending (see [manual-pipeline.md](manual-pipeline.md)).
3. **Synthetic** — unmatched streams get a synthetic canonical from the stream title.

## Search / query path

FTS hit on `canonical_fts` → canonical_id → streams for variants. Keeps the canonical-first UX (results grouped by real-world channel) without paying for joins at query time.

## UI

- **Channel card** — canonical title; badges:
  - country flag
  - variant count (how many streams on this canonical)
  - multi-source dots
  Badges configurable: Settings → Data → checkbox list per badge (fixed order).
- **Channel detail panel** — new overlay mirroring Movie/Series detail. Enrichment fields + variant picker (which provider stream to play).
- **NSFW filtering** — deferred.

## Auto vs manual pipeline

Original design auto-chained: Sync → FTS → Canonical → Canonical FTS + background EPG.
Decision 2026-04-14 flipped this to manual (see [manual-pipeline.md](manual-pipeline.md)) because the auto-chain hid failure modes (10% tvg_id coverage, namespace crossing bugs, sentinel strings in SQL).

## Current implementation status (2026-04-14)

- ✅ Schema applied (canonical_channels, FTS5 table, FK on streams)
- ✅ Two-pass match (exact tvg_id → normalized title → synthetic)
- ✅ iptv-org `logos.json` fetched and threaded into `canonical.logo_url`
- ✅ Manual iptv-org refresh button re-runs `buildCanonicalLayer` across all sources + rebuilds `canonical_fts`
- ✅ Search + browse perf refactored (EXISTS + two-pass id→hydrate)
- ✅ Ghost categories fixed — count by actual stream type
- ✅ 7-step manual pipeline wired on SourceCard (button, step badge, terminal log)
- ⏳ Browse perf still problematic after full pipeline (~30s for movies/channels grids)
- ⏳ Pass 2 redesign pending (substring match)
- 🅿️ Parked: splash on first launch, TTL gate on add-source, TTL gate on manual sync, Hybrid C routing
- 🅿️ Group View hidden until Pass 2 density improves
