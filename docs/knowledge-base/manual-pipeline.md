# g3 Manual per-source pipeline

**Decision 2026-04-14:** Add-source auto-chained Sync → FTS → Canonical → Canonical FTS + background EPG. This hid failure modes. Replace with **7 explicit manual buttons**.

## Why

- Auto-chain hid where pipeline broke (10% tvg_id coverage + namespace bugs + sentinel strings were all invisible to the user; only the final "sync failed" showed).
- Manual steps = visible state = faster diagnosis.
- Each step gets its own IPC handler + its own card button + its own progress + its own last-run timestamp.

## How to apply

When working on g3 UI or source lifecycle, **don't collapse these back into one button**. Each step must run independently.

## The 7 steps

### In the Add Source dialog
1. **Test** — validate creds. When Add is disabled (before test passes), Test takes primary styling; once test succeeds and Add becomes enabled, Add takes primary.
2. **Add** — insert source row only. No auto-sync. Dialog closes.

### On the source card (sequential, gate downstream until upstream ran)
3. **Sync** — Xtream pull → `streams` / `series_sources` / `categories` / joins.
4. **Fetch EPG** — EPG per source. Previously auto-kicked in background; now explicit. (EPG progress-bar wiring still pending.)
5. **Index VoD FTS** — `buildFtsForSource` → `content_fts` for movies + series with ligature + diacritic folding (g2).
6. **Build Canonical** — `buildCanonicalLayer` (Pass 1 tvg_id → Pass 2 substring match → synthetic) (g3 Phase 1).
7. **Canonical FTS** — `buildCanonicalFts` → `canonical_fts` over canonical rows.

### Global (Settings + source-card shortcut)
- **Fetch iptv-org data** — populates `iptv_channels`. Prerequisite for Step 6 Pass 1 to find anything. TTL-gated. **Does not auto-chain** into Build Canonical or Canonical FTS (this was the 2026-04-14 fix after the freeze). User runs steps 6 and 7 separately afterwards.

## UI details

- `ActionButton` accepts a `step?: number` prop. When present, renders a small circular step badge (14×14, violet, mono font, weight 700) left of the icon.
- Each step's IPC handler logs `[ipc] Step N: <channel> invoked for <sourceId>` to the main-process stdout (terminal, not DevTools) so user can watch pipeline in the shell where `pnpm dev` runs.
- Deprecated buttons removed: `buildLiveFts` / `handleBuildLiveFts` (folded into Step 6 + Step 7).

## Pass 2 redesign (pending implementation)

Current Pass 2 is exact-normalized-title equality. 99.8% of canonicals end up synthetic because Pass 2 can't strip provider prefixes.

Proposed replacement:

1. Extract country code from stream title if present (`IT:`, `UK:`, `PK ➾`, etc.).
2. Normalize (lowercase + fold diacritics + collapse whitespace).
3. Find the **longest iptv-org name** (min 4 chars) that appears as a **word-boundary substring** of the normalized stream title.
4. Tiebreak by country match when multiple iptv-org names tie on length.

Replaces exact match. Exact match is a subset of substring match.

## Group View — parked

Group View toggle is **hidden from UI** (as of 2026-04-14). Reason: with 10% tvg_id coverage and prefix-blind Pass 2, 99%+ of canonicals are synthetic, so grouping shows provider-prefixed junk instead of real-world channel names.

The `ChannelGroupView` component and `content:browse-live-grouped` handler **still exist and are wired** — just unreachable from the toolbar. Revisit when Pass 2 redesign lands and match rate improves (ballpark: >50% non-synthetic).
