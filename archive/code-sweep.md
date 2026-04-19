# Code Sweep Plan

## Scope

Full codebase hygiene pass across `fractals/electron/` and `fractals/src/`. No features, no refactors — only cleanup, type safety, and dead code removal.

## Priority 1 — Dead Code & Stale Artifacts

### 1.1 Deprecated IPC stubs
- **File:** `electron/ipc/handlers.ts` (~line 1600)
- `enrichment:enrich-single`, `enrichment:enrich-manual`, `enrichment:search-tmdb`, `enrichment:enrich-by-id`, `enrichment:start`, `enrichment:set-api-key`, `enrichment:status`
- These are g1 leftovers returning hardcoded error/no-op responses
- **Action:** Remove handlers. Grep renderer for any callers and remove those too.

### 1.2 Orphaned store fields
- **File:** `src/stores/sources.store.ts`
- `metadataProgress`, `metadataResult`, `setMetadataProgress`, `setMetadataResult`
- These were written by the manual "Populate metadata" button (now removed)
- **Action:** Verify no remaining readers in `App.tsx` or `NavRail.tsx` event listeners. Remove fields, remove any orphaned `metadata:progress` event listener in `App.tsx`.

### 1.3 Orphaned preload API methods
- **File:** `electron/preload.ts`
- Check if `populateMetadata`, `matchSource`, or deprecated enrichment methods are still exposed but never called
- **Action:** Remove any that have no renderer callers.

### 1.4 Stale g1/g1c comments
- ~30 references to "g1", "g1c", "deprecated" across 5 files
- Schema history comments in `connection.ts` and `schema.g1c.sql.ts` are intentional documentation — keep
- **Action:** Remove stale inline comments only (e.g. "no enrichment in g1c tier"). Keep schema docs.

## Priority 2 — `as any` Elimination (~200 casts across 32 files)

### 2.1 IPC type bridge (biggest win)
- **Root cause:** No shared type definitions between main process handlers and renderer API calls
- `src/lib/api.ts` alone has **51** `as any` casts — every IPC call goes through `(window.api as any)`
- **Action:**
  1. Create `shared/ipc-types.ts` with typed interfaces for each IPC channel's request/response
  2. Type `electron/preload.ts` `contextBridge` API object against these interfaces
  3. Declare `window.api` in `src/types/window.d.ts` using the same interfaces
  4. Remove `as any` from `api.ts` — the typed `window.api` makes them unnecessary

### 2.2 Handler return types
- **File:** `electron/ipc/handlers.ts` — 23 casts
- Search handlers return `{ items: unknown[]; total: number }`
- Browse/category handlers return untyped arrays
- **Action:** Add explicit return type annotations to each handler. Use the interfaces from 2.1.

### 2.3 Player overlay
- **File:** `src/components/player/PlayerOverlay.tsx` — 23 casts
- Mostly HLS.js / ArtPlayer API interactions, external library types
- **Action:** Create local type declarations for HLS.js and ArtPlayer APIs used. Replace `as any` with narrow types where possible; add `// eslint-disable` with explanation for genuinely untyped third-party APIs.

### 2.4 Component-level casts (scattered, 1–7 per file)
- Detail panels, browse components, source cards
- Mostly `(item as any).fieldName` for fields not on `ContentItem` type
- **Action:** Extend `ContentItem` interface in `src/lib/types.ts` with the missing optional fields. Remove casts.

## Priority 3 — Silent Error Swallowing (14 instances)

### 3.1 Inventory

| File | Count | Pattern |
|---|---|---|
| `src/components/player/DetailMiniPlayer.tsx` | 4 | `.catch(() => {})`, `catch {}` |
| `src/components/player/PlayerOverlay.tsx` | 6 | `.catch(() => {})`, `catch {}` |
| `electron/ipc/handlers.ts` | 2 | `.catch(() => {})`, `catch {}` |
| `src/components/layout/ContentArea.tsx` | 1 | `catch {}` |
| `src/components/detail/MovieDetail.tsx` | 1 | `catch {}` |
| `src/components/detail/SeriesDetail.tsx` | 1 | `catch {}` |

### 3.2 Action
- **Keep silent:** JSON.parse guards, localStorage reads, playback pause/destroy calls — these are intentionally silent because failures are harmless
- **Add `console.warn`:** IPC calls that silently swallow network/DB errors (handlers.ts, detail panels)
- **Annotate kept ones:** Add `// Intentional: <reason>` comment to each silent catch that stays

## Priority 4 — Misc Cleanup

### 4.1 Unused imports
- Run `npx eslint --rule 'no-unused-vars: error' --ext .ts,.tsx src/ electron/` or equivalent
- **Action:** Remove all flagged unused imports

### 4.2 Console.log statements
- Grep for `console.log` in non-debug code
- **Action:** Remove or convert to `console.debug` (dev-only)

### 4.3 Duplicate utility code
- Check for duplicated patterns across detail panels (MovieDetail, SeriesDetail, ChannelDetail)
- **Action:** Extract only if three or more panels share identical logic blocks (don't over-abstract)

## Execution Order

1. P1 (dead code) — safest, no behavior changes, shrinks codebase
2. P4.1 (unused imports) — mechanical, zero risk
3. P2.1 + P2.2 (IPC types) — highest value, eliminates ~74 casts
4. P2.4 (ContentItem extension) — eliminates scattered component casts
5. P2.3 (player types) — isolated to player files
6. P3 (error handling) — low risk, case-by-case judgment
7. P4.2–P4.3 (misc) — last, lowest priority

## Verification

- `pnpm build` succeeds with no new TypeScript errors after each step
- Run the app, sync a source, open detail panels, play content — golden path still works
- No behavioral changes — only types, dead code removal, and error logging
