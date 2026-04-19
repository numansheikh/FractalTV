# Fractals

A local-first IPTV client — like Plex, but for IPTV streams you already have access to.

Add your Xtream Codes or M3U sources once. Fractals merges everything into a single unified library and lets you search across all content by title.

**Status:** Active branch is **`g3`**. g0–g2 shipped: 15-table per-type schema, LIKE search on `search_title`, unified detail panels, mini player, M3U parity, VoD enrichment (keyless + TVmaze), ADV search, NSFW filtering, iptv-org channel DB. g3 shipped so far: TMDB enrichment (key-gated), 3-level enrichment picker, post-sync auto-chain. g3 remaining: design revamp, code sweep. See [`../PLAN.md`](../PLAN.md) for phase history and [`../BACKLOG.md`](../BACKLOG.md) for actionable work.

---

## Features

### Content Management
- **Multi-source merging** — add multiple Xtream or M3U sources; browse everything in one place
- **Source identity colors** — each source gets a distinct accent color for visual identification
- **Per-type split** — Channels / Movies / Series / Episodes each live in their own table with their own user data

### Search & Browse
- **LIKE on `search_title`** — any-ascii + lowercase normalized column, populated inline at sync
- **Bidirectional diacritics / ligatures** — ae↔æ, e↔é, ss↔ß, oe↔œ match both directions
- **Category browsing** — filter by type (Channels / Films / Series), category, source
- **Sort options** — by title, year, rating, or latest added
- **250 ms debounce, 2-char threshold**

### Player
- **Three player options** — built-in ArtPlayer (HLS.js), MPV, or VLC
- **Keyboard controls** — Space (play/pause), F (fullscreen), M (mute), arrows (seek/volume)
- **Multi-press seek** — 1 press = 5 s, 2 = 10 s, 3+ = 25 s
- **Resume playback** — saves position, prompts to resume on reopen
- **Completion detection** — marks watched at 92 % or on end

### User Data
- **Favorites & Watchlist** — toggle from cards (hover) or detail panel
- **Star ratings** — 1–5 star rating in detail panel
- **Watch history** — tracks last watched time
- **Personalized rows** — Continue Watching, Favorites, Recently Watched on Home
- **Card indicators** — favorite heart, progress bar, completed checkmark on poster cards
- **Drag-to-reorder TV mode** — reorder favorite channels on Home

### UI
- **Unified detail panel** — Movies and Channels get a side panel; Series gets double-width with season / episode browser
- **Season coins** — compact circular season selector for Series
- **Clickable breadcrumbs** — Source > Type > Category > Title navigation
- **Dark theme** — information-dense, keyboard-friendly design

### Settings
- **Appearance** — theme and font options
- **Interface** — Home mode, strip width, grid page size, timezone override
- **Player preferences** — choose ArtPlayer, MPV, or VLC with custom paths
- **Source management** — add, edit, disable, sync, delete sources
- **Account info** — view source connection status and expiry

## Tech stack

- **Electron** (main, sandbox-enabled) + **React 19** + **Vite** (renderer)
- **better-sqlite3** + **Drizzle ORM** for the local database
- **Zustand** for state, **TanStack Query** for async data
- **Framer Motion** for UI motion
- **ArtPlayer** + **HLS.js** for video playback
- **Worker threads** for background sync and delete operations

## Running locally

```bash
pnpm install

# Dev (Vite + Electron)
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
| `Escape` | Close overlay / clear search / go back |
| `Cmd+,` | Open settings |
| `Cmd+1-5` | Switch page (Home / Channels / Films / Series / Library) |
| `Cmd+R` | Reload renderer |
| `Space` | Play/pause (in player) |
| `F` | Toggle fullscreen (in player) |
| `M` | Mute/unmute (in player) |
| `Arrow Left/Right` | Seek (in player) |
| `Arrow Up/Down` | Volume (in player) |
| `[` / `]` | Channel surf (live) |

## Roadmap

- [`../PLAN.md`](../PLAN.md) — phase map, shipped history
- [`../BACKLOG.md`](../BACKLOG.md) — actionable bugs, gaps, debt, planned work

The legacy Angular reference implementation lives in `../legacy/`.
