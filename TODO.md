# Fractals — TODO

## Remaining g2

- [ ] **Full code sweep** — TypeScript `any` elimination (~143 casts, worst in `lib/api.ts` / `PlayerOverlay` / `ipc/handlers.ts`), dead code, logic issues, stale comments, accumulated g2 debt.
- [ ] **Daisy-chain sync worker** — auto-run Populate Metadata after sync completes (like EPG auto-chains). Pipeline becomes: Test → Sync → (auto: Populate Metadata + EPG).

## g3

- [ ] TMDB/OMDb enrichment (optional API key, supplements keyless pipeline)
- [ ] Design system overhaul (borders + lavender)
- [ ] Settings live-apply (no page refresh)
- [ ] Mark all episodes watched
- [ ] Content type correction (7.3% non-film in movies table)

## g4

- [ ] Capacitor: Android phone → Android TV → iOS → Tizen → PWA
- [ ] Three-tier product split (M3U Player / Xtream Lite / Fractals Pro)
