# Fractals

A local-first IPTV client — like Plex, but for IPTV streams you already have access to.

Add your Xtream Codes accounts once. Fractals merges all sources into a single unified library, enriches everything with metadata from TMDB, and lets you search across all content by title, actor, director, genre, or free text.

**Status:** Active development on `master`. Phase 0 (core scaffold) + Phase 1 (UX refinement) + Phase 2 (V2 canonical/streams data model cutover) complete. Phase 3 (multi-platform) not yet started. See `../BACKLOG.md` for the full roadmap.

---

## Features

### Content Management
- **Multi-source merging** — add multiple Xtream accounts; browse everything in one place
- **TMDB enrichment** — posters, ratings, plots, cast, genres fetched automatically (batch + on-demand)
- **Manual TMDB matching** — search and pick the correct match when auto-enrichment fails
- **Source identity colors** — each source gets a distinct color for visual identification

### Search & Browse
- **FTS5 full-text search** — searches title, plot, cast, director across all content
- **Special character support** — brackets, parentheses, dashes work as search characters
- **Category browsing** — filter by type (Live/Movies/Series), category, source
- **Sort options** — by title, year, rating, or latest added
- **Diacritics handling** — "Borgen" finds "Borgen" via transliteration

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
- **TMDB API key** — configure your own key for enrichment
- **Source management** — add, edit, disable, sync, delete sources
- **Account info** — view source connection status and expiry

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

Active work is organized into five buckets in [`../BACKLOG.md`](../BACKLOG.md):

1. **Data & Search** *(next pick)* — canonical data model + search redesign + TMDB enrichment. Detailed scoping in `~/.claude/plans/scalable-leaping-cake.md`.
2. **Product shape** — three-tier split (M3U Player / Xtream Lite / Fractals Pro) + M3U parsing improvements. Business plan in `docs/business-plan.md`.
3. **Multi-platform reach** — Android, iOS, Android TV, Samsung Tizen via Capacitor. Full plan in `docs/multi-platform-strategy.md`.
4. **Experience polish** — Live TV nav breadcrumb, series full-page view, player fixes.
5. **Tech health** — QA cycle 2 follow-ups (type safety, security, hardening). See `docs/qa-cycle-2.md`.

The legacy Angular reference implementation lives in `../legacy/`.
