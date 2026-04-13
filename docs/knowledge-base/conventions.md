# Conventions — cross-cutting rules

Small rules that touch many files. Worth knowing before any non-trivial change.

## Navigation stack — depth-1 `previousView`

App store has `previousView: ActiveView | null`. `setView()` always saves `previousView = currentView` before switching. `goBack()` restores `previousView` (or `home` if null) and clears it.

**Escape chain (App.tsx, bubble phase — overlays handle their own via capture phase):**
1. Clear search query if active.
2. `goBack()` if not on home.

**How to apply:** When wiring any new NavRail link or programmatic navigation (`More →` in strips, breadcrumb chips, category clicks), always use `setView()` so `previousView` is tracked automatically. Do **not** set `activeView` directly in the store or via `set()`. `goBack()` is only called from the Escape handler.

## Escape key layering — overlays use capture + stopImmediatePropagation

When a panel (ContentDetail, Settings, etc.) is open, Escape must **only close that panel** — it must not also clear the search bar.

**Why:** User reported that closing the detail panel with Escape also wiped their search query, forcing re-search.

**How to apply:** Overlay components that handle Escape use `addEventListener('keydown', handler, true)` (**capture phase**) and call `e.stopImmediatePropagation()`. The SearchBar's window-level handler runs in bubble phase, so capture-phase handlers intercept first.

## Source ID — quad fallback

When reading `primarySourceId` from a `ContentItem`, always use the quad fallback:

```ts
item.primarySourceId
  ?? item.primary_source_id
  ?? (item as any).source_ids
  ?? item.id?.split(':')[0]
```

**Why:**
- Raw SQL returns snake_case (`primary_source_id`).
- Drizzle returns camelCase (`primarySourceId`).
- Some queries alias `c.primary_source_id as source_ids`.
- Some channels have `primary_source_id = NULL` in DB — all three resolve to null. Content ID is always `{sourceId}:{type}:{streamId}`, so `id.split(':')[0]` is a reliable last resort.

**Who uses it:** ChannelCard (cards/ + browse/), PosterCard (cards/ + browse/), `VirtualGrid.ChannelListRow`, LiveSplitView (`ChannelRow` + top bar), ChannelSurfer, ContentCard, ContentDetail, MovieDetail, SeriesDetail, PlayerOverlay, HomeView, ContentArea. Any new component reading source color or source name must use all four.

## Export / import schema migration rule

When data moves between schemas (v1 → v2 → v3 → g3 canonical), update export/import in `handlers.ts` (`sources:export`, `sources:import`) to include the new tables.

**Why:** Backup file must always capture full current state. If a table moves and export only covers the old schema, data is silently lost on import.

**How to apply:** After any data model migration, grep `sources:export` in `handlers.ts` and verify all active user-data tables are included.

## Data refresh safety — validate before wiping

Any replace-all refresh against local storage (iptv-org, future TMDB, enrichment catalogs):

1. Download + parse the payload.
2. Sanity-check shape: array (or expected type), non-empty, sampled rows have required fields with expected types.
3. Only then open a transaction: `DELETE` existing rows, `INSERT` new rows.
4. On check failure, abort and surface the error.

**Why (user's rule):** *"if we download new data and the JSON schema does not satisfy the db version, then do not wipe data from DB... otherwise we would lose whatever we had."* Stale data is better than empty data.

## Sanity check before declaring done

Before finishing any implementation:
- Grep for any identifiers that were removed/moved to confirm nothing still references them.
- Grep for any identifiers that were added to confirm they are imported where used.
- Read the final state of heavily-edited files to catch obvious issues.

**Why:** Removed `buildColorMapFromSources` import from `HomeView.tsx` but `ChannelsMode` (in the same file) still used it → runtime crash that was easily catchable with a grep.

## Main-process vs renderer logging

`console.log` in React components goes to **DevTools console**. The terminal where `pnpm dev` runs only shows **main-process** logs.

When adding pipeline / IPC instrumentation that the user wants to watch from the shell, put the logs in the IPC handler inside `electron/ipc/handlers.ts`, not in the renderer. Pattern: `[ipc] Step N: <channel> invoked for <sourceId>`.

## Git / branch hygiene

- `master` is g1 locked — do not commit there without deliberate plan.
- Generation branches build on each other: `search-rebuild-g1-g2-g3-manual-pipeline` is the current working branch.
- User sometimes wants speculative work carved off as a new branch (e.g. `g2-flat`) rather than piled on the current branch.

## No speculative features or fallbacks

Don't add error handling, fallbacks, or validation for scenarios that can't happen. Trust internal code + framework guarantees. Validate only at system boundaries (user input, external APIs). No feature flags or backwards-compat shims when the code can just change.

Three similar lines is better than a premature abstraction. No half-finished implementations.
