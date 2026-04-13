# iptv-org ingestion plan

Plan for pulling and refreshing iptv-org channel metadata into `iptv_channels`. Locked 2026-04-13.

## Why

iptv-org powers canonical identity + enrichment (~39K channels). Need predictable freshness without blocking users unnecessarily, and safe replace-all semantics.

## Locked decisions

1. **First launch** — If `iptv_channels` is empty, block UI behind a splash screen while pulling. Retry once on failure, then surface error.
2. **Add-source flow** — Check TTL:
   - Empty DB → block (splash-style).
   - Populated DB → fire refresh in parallel (Hybrid C). User isn't blocked; stale data mid-refresh is acceptable.
3. **Manual sync flow** — Same Hybrid C behavior as add-source.
4. **Schema validation before overwrite** — `validateIptvOrgPayload` must pass (non-empty, min row count, sample shape check) before any `DELETE`. Already implemented.
5. **Retry policy** — Initial pull retries once. Already implemented as `fetchOnce` called up to twice.
6. **Manual refresh button (Settings)** — Pulls latest iptv-org JSON, then re-runs full enrichment (`buildCanonicalLayer` + `buildCanonicalFts`) across **all** enabled sources. Full rerun — correctness over speed.
7. **TTL default** — 15 days.

## Current implementation status (2026-04-14)

- ✅ `refreshIptvOrgChannels` — schema validation + retry-once + replace-all semantics
- ✅ `buildCanonicalLayer` — can be invoked per source from Step 6 button
- ✅ Settings UI — manual refresh button + TTL setting
- ✅ Manual refresh button re-runs `buildCanonicalLayer` + `buildCanonicalFts` across all enabled sources after pull succeeds (handler emits `enriching` phase progress, terminal `done` only after enrichment; `refreshIptvOrgChannels` emits `pulled` not `done` — terminal event is owned by the handler)
- 🅿️ Parked bundle (TTL / splash / Hybrid C routing): splash screen on first launch, TTL gate on add-source, TTL gate on manual sync, Hybrid C parallel refresh. These are UX polish, not correctness blockers.
- ⚠️ **2026-04-14 fix:** `iptv-org:refresh` IPC handler **no longer auto-chains** `buildCanonicalLayer` across every source. That chain caused the "Fetch iptv-org" button to freeze for minutes. User re-runs Build Canonical [6] and Canonical FTS [7] manually afterwards.
