# Fractals

A local-first IPTV client — like Plex, but for IPTV streams you already have access to.

Add your Xtream Codes accounts once. Fractals merges all sources into a single unified library, enriches everything with metadata from TMDB, and lets you search across all content by title, actor, director, genre, or free text.

**Status:** Active development. Core browsing, search, and playback work. Enrichment and advanced features are in progress.

---

## What it does

- **Multi-source merging** — add multiple Xtream accounts; browse everything in one place
- **TMDB enrichment** — posters, ratings, plots, cast, genres fetched automatically
- **FTS5 full-text search** — searches title, plot, cast, and director across all content
- **Three player options** — built-in ArtPlayer, MPV, or VLC
- **Live TV** — direct stream playback; catchup/timeshift support planned
- **Local-first** — all data in a local SQLite database, works offline after sync

## Tech stack

- **Electron** (main process) + **React 19** + **Vite** (renderer)
- **better-sqlite3** + **Drizzle ORM** for the local database
- **Zustand** for state, **TanStack Query** for async data
- **Tailwind CSS** + **Framer Motion** for UI

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
electron/          Main process: IPC handlers, DB, sync services
src/               Renderer: React components, stores, styles
docs/TODO.md       Prioritized backlog
CLAUDE.md          Full architecture, design language, conventions
```

## Roadmap highlights

See `docs/TODO.md` for the full backlog. Near-term priorities:

- Resume playback from saved position
- On-demand TMDB enrichment (not just batch)
- M3U playlist support
- "Continue Watching" and Favorites rows
- Virtual scrolling for large libraries

The legacy Angular reference implementation lives in `../legacy/`.
