# Fractals

A local-first IPTV client — like Plex, but for IPTV streams you already have access to.

Add your Xtream Codes accounts once. Fractals merges all sources into a single unified library, enriches everything with metadata from TMDB, and lets you search across all content by title, actor, director, genre, or free text.

**Status:** Active development. g1 (pure provider-data app, LIKE search) and g2 (FTS5 + diacritic/ligature folding, auto-indexed on sync) complete. g3 (keyless canonical layer + iptv-org enrichment) next. Phase 3 (multi-platform) not yet started. See `../PLAN.md` for the full roadmap.

---

## Features

### Content Management
- **Multi-source merging** — add multiple Xtream / M3U sources; browse everything in one place
- **Source identity colors** — each source gets a distinct color for visual identification
- **User data survives resync** — favorites, watchlist, ratings, watch positions preserved across syncs
- *(TMDB / iptv-org enrichment — deferred to g3+)*

### Search & Browse
- **g1 LIKE search** — fast substring match on provider titles, 250ms debounce
- **g2 FTS5 full-text search** — ranked prefix matching via `unicode61 remove_diacritics 2`
- **Diacritic + ligature folding** — "forg" finds "Förgöraren", "coeur" finds "cœur" (œ→oe, æ→ae, ß→ss, ﬁ→fi, ﬂ→fl, ĳ→ij)
- **Auto-indexed after every sync** — no manual step needed
- **Grid LIKE fallback** — if FTS returns <10 results, grid views augment with LIKE
- **Category browsing** — filter by type (Live/Movies/Series), category, source
- **Sort options** — by title, year, rating, or latest added

### Player
- **Three player options** — built-in ArtPlayer (HLS.js), MPV, or VLC
- **Keyboard controls** — Space (play/pause), F (fullscreen), M (mute), arrows (seek/volume)
- **Multi-press seek** — 1 press = 5s, 2 = 10s, 3+ = 25s
- **Resume playback** — saves position, prompts to resume on reopen
- **Completion detection** — marks watched at 92% or on end

### User Data
- **Favorites & Watchlist** — toggle from cards (hover) or detail panel
- **Star ratings** — 1-5 star rating in detail panel
- **Watch history** — tracks last watched time
- **Personalized rows** — Continue Watching, Favorite Channels, Recently Watched on browse home
- **Card indicators** — favorite heart, progress bar, completed checkmark on poster cards

### UI
- **Unified detail panel** — movies get a side panel; series get double-width with season/episode browser
- **Season coins** — compact circular season selector for series
- **Clickable breadcrumbs** — Source > Type > Category > Title navigation
- **Dark theme** — information-dense, keyboard-friendly design

### Settings
- **Appearance** — theme and font options
- **Player preferences** — choose ArtPlayer, MPV, or VLC with custom paths
- **Timezone override** — system default toggle + manual picker for EPG display
- **Source management** — add, edit, disable, sync, reindex, delete sources
- **Account info** — view source connection status and expiry
- **FTS toggle** — debug control for switching between LIKE and FTS5 search paths

## Tech stack

- **Electron** (main process) + **React 19** + **Vite** (renderer)
- **better-sqlite3** + **Drizzle ORM** for the local database
- **Zustand** for state, **TanStack Query** for async data
- **Tailwind CSS 4** + **Framer Motion** for UI
- **ArtPlayer** + **HLS.js** for video playback
- **Worker threads** for background sync and delete operations

## Running locally

```bash
# Install dependencies
pnpm install

# Start in development mode (Vite + Electron)
pnpm dev

# Web-only preview (no Electron, no IPC)
pnpm dev:web

# Production build
pnpm build:electron
```

Node 20+ and pnpm 9+ required.

## Project layout

```
electron/          Main process: IPC handlers, DB, sync services, workers
src/               Renderer: React components, stores, hooks, styles
CLAUDE.md          Full architecture, design language, conventions
```

## Keyboard shortcuts

| Shortcut | Action |
|----------|--------|
| `/` or `Cmd+K` | Focus search bar |
| `Escape` | Close overlay / clear search |
| `Cmd+,` | Open settings |
| `Cmd+R` | Reload renderer |
| `Space` | Play/pause (in player) |
| `F` | Toggle fullscreen (in player) |
| `M` | Mute/unmute (in player) |
| `Arrow Left/Right` | Seek (in player) |
| `Arrow Up/Down` | Volume (in player) |
| `D` | Debug panel (in player) |

## Roadmap

Detailed phase state in [`../PLAN.md`](../PLAN.md). Tiered search progression:

- **g1** (done) — provider-data app, LIKE search
- **g2** (done) — FTS5 + diacritic/ligature folding, auto-indexed
- **g3** (next) — keyless canonical layer + iptv-org enrichment (live channels)
- **g4** — embeddings / semantic search
- **g5** — keyed enrichment (TMDB) + cross-language resolution

Five parallel buckets (see `docs/` for scoping):

1. **Data & Search** *(active — g3 next)*
2. **Product shape** — three-tier split (M3U Player / Xtream Lite / Fractals Pro). See `docs/business-plan.md`.
3. **Multi-platform reach** — Android, iOS, Android TV, Samsung Tizen via Capacitor. See `docs/multi-platform-strategy.md`.
4. **Experience polish** — series full-page view, player fixes.
5. **Tech health** — type safety, security, hardening.

The legacy Angular reference implementation lives in `../legacy/`.
