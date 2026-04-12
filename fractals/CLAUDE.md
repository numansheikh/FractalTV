# CLAUDE.md — Fractals

## What is Fractals?

A cross-platform IPTV client that treats content as the primary abstraction, not playlists or protocols. You add your IPTV sources (Xtream Codes accounts, M3U URLs) once, and the app merges everything into a single unified library — enriched with metadata from TMDB, searchable by actor, director, genre, language, similarity, or free text.

**One sentence:** "Plex-quality browsing and search for IPTV content, running locally on every platform."

## Core principles

1. **Content-first, sources invisible.** The user never thinks about which Xtream account has what. They search "Brad Pitt" and see every Brad Pitt movie available across all their sources.

2. **Search IS the UI.** The home screen is a search bar with browse content underneath. Typing progressively filters. Empty search = browse mode. No separate search page, no mode switching.

3. **Utility over flash.** Dense, information-rich, keyboard-friendly. No hero banners, no autoplay trailers, no wasted space. Think Raycast, not Netflix.

4. **Local-first, no cloud dependency.** All data (metadata, embeddings, watch history) stored in local SQLite. Works fully offline after initial sync. No user accounts, no telemetry.

5. **Multi-platform from day one.** Desktop (Electron), mobile (Capacitor), TV (Capacitor + Tizen). Same React codebase, responsive to form factor.

## Target platforms

| Platform | Mechanism | Primary input |
|---|---|---|
| macOS | Electron | Keyboard + mouse |
| Windows | Electron | Keyboard + mouse |
| Linux | Electron | Keyboard + mouse |
| Android phone/tablet | Capacitor | Touch |
| Android TV | Capacitor | D-pad remote |
| iOS / iPadOS | Capacitor | Touch |
| Samsung Tizen TV | Web build as .wgt | D-pad remote |
| Web (PWA) | Direct serve | Keyboard + mouse / touch |

## Tech stack

### Frontend
- **React 19** with TypeScript
- **Vite** for bundling and dev server
- **Zustand** for state management (minimal, no boilerplate)
- **Framer Motion** for animations (browse↔search morphing, page transitions)
- **cmdk** for the command-palette-style search interaction
- **Radix UI** primitives for accessible, unstyled base components
- **TanStack Query** for async data fetching and caching
- **Tailwind CSS** for styling

### Backend (Electron main process)
- **Electron** (latest stable)
- **better-sqlite3** for synchronous, fast local database
- **Node.js** worker threads for background tasks (sync, delete)

### Mobile / TV
- **Capacitor** for Android (phone/tablet/TV single APK) and iOS
- **Tizen Studio** packaging for Samsung TV (same web build)

## Architecture overview

```
┌──────────────────── ELECTRON MAIN PROCESS ────────────────────┐
│                                                                │
│  ┌─────────────┐  ┌─────────────┐                             │
│  │ Xtream Sync │  │  M3U Sync   │  (worker threads)           │
│  │ (N sources) │  │             │                              │
│  └──────┬──────┘  └──────┬──────┘                              │
│         └────────┬───────┘                                     │
│                  ▼                                              │
│  ┌─────────────────────────────────────────────────────────┐  │
│  │              SQLite (better-sqlite3, WAL mode)           │  │
│  │  • streams, series_sources (provider data)              │  │
│  │  • categories, stream_categories                        │  │
│  │  • stream/series/channel_user_data (favorites, etc.)    │  │
│  │  • epg (programme schedules)                            │  │
│  │  • sources, profiles, settings                          │  │
│  └─────────────────────────────────────────────────────────┘  │
│                                                                │
│  IPC handlers: search, browse, play, sync, settings           │
└───────────────────────┬────────────────────────────────────── ┘
                        │ IPC (contextBridge)
┌───────────────────────▼────────────────────────────────────── ┐
│                    RENDERER (React)                             │
│                                                                │
│  ┌─────────────────────────────────────────────────────────┐  │
│  │  Unified Search + Browse Screen                          │  │
│  │  ┌─────────────────────────────────┐                     │  │
│  │  │  Search bar (always visible)    │                     │  │
│  │  └─────────────────────────────────┘                     │  │
│  │  ┌─────────────────────────────────┐                     │  │
│  │  │  Filter chips: type, genre...   │                     │  │
│  │  └─────────────────────────────────┘                     │  │
│  │  ┌─────────────────────────────────┐                     │  │
│  │  │  Content area:                  │                     │  │
│  │  │  - Browse rows (when idle)      │                     │  │
│  │  │  - Search results (when typing) │                     │  │
│  │  │  - Seamless morph between them  │                     │  │
│  │  └─────────────────────────────────┘                     │  │
│  └─────────────────────────────────────────────────────────┘  │
│                                                                │
│  Content Detail │ Player │ Settings (rare)                     │
└────────────────────────────────────────────────────────────── ┘
```

### For non-Electron environments (Capacitor, PWA, Tizen)

The Electron backend doesn't exist. Instead:
- **CapacitorService** replaces IPC calls with direct HTTP to Xtream APIs + local storage (Capacitor Preferences or IndexedDB)
- TMDB enrichment happens client-side via fetch
- Embeddings: either skip (use keyword search only) or use a lightweight WASM build of transformers.js in the browser
- SQLite on mobile via `@capacitor-community/sqlite`

A `DataService` interface abstracts this — Electron and Capacitor implementations are swapped at runtime via a factory, same pattern as the legacy app but cleaner.

## Database schema (g1 — 12 tables, no canonical layer)

```
sources
  id, type (xtream|m3u), name, server_url, username, password, status, last_sync, item_count, disabled

streams
  id ({sourceId}:{type}:{streamId}), source_id (FK), type (live|movie|episode),
  stream_id, title, thumbnail_url, container_extension, category_id,
  tvg_id, epg_channel_id, catchup_supported, catchup_days,
  stream_url (M3U only), parent_series_id (episodes → series_sources),
  language_hint, origin_hint, quality_hint, year_hint, added_at

stream_categories
  stream_id (FK), category_id (FK)

series_sources
  id ({sourceId}:series:{seriesId}), source_id (FK), series_external_id, title,
  thumbnail_url, category_id, language_hint, origin_hint, year_hint, added_at

series_source_categories
  series_source_id (FK), category_id (FK)

categories
  id, source_id (FK), external_id, name, type (live|movie|series), sort_order

epg
  id, source_id (FK), channel_external_id, title, description, start_time, end_time

stream_user_data
  profile_id (FK), stream_id (FK → streams ON DELETE CASCADE),
  is_favorite, is_watchlisted, rating, fav_sort_order,
  watch_position, watch_duration, last_watched_at, completed

series_user_data
  profile_id (FK), series_source_id (FK → series_sources ON DELETE CASCADE),
  is_favorite, is_watchlisted, rating, fav_sort_order

channel_user_data
  profile_id (FK), stream_id (FK → streams ON DELETE CASCADE),
  is_favorite, fav_sort_order

profiles
  id, name

settings
  key, value
```

**Sync user data preservation:** Sync workers backup user data rows into temp tables before deleting streams (CASCADE would wipe them), then restore after reinserting. Favorites, watchlist, ratings, watch positions all survive resync.

## Key design decisions

### Search architecture (g1 + g2)
**g1 baseline.** LIKE search on provider titles with 250ms debounce and min 2 character threshold. Three parallel queries (live, movie, series) via IPC. Results displayed per-type with independent pagination.

**g2 FTS5 layer.** Single `content_fts` virtual table (id/source_id/type UNINDEXED, title searchable) using `unicode61 remove_diacritics 2` tokenizer. `ftsEnabled` toggle (default false in store, but forced to true after every index build). Query preprocessing folds Latin ligatures (œ→oe, æ→ae, ß→ss, ﬁ→fi, ﬂ→fl, ĳ→ij) and appends `*` for prefix match. Index build folds same ligatures via registered `fold_ligatures()` SQLite scalar in INSERT...SELECT. Build yields to the event loop between 5000-row batches so UI stays responsive. FTS runs automatically at the end of every source sync. Grid views augment FTS with LIKE when <10 results (`ftsFallback: true`). Home/Discover stays FTS-only for speed.

**Tiered search roadmap:**
- g1: LIKE on provider titles (DONE)
- g2: FTS5 on streams + series_sources (DONE)
- g3: keyless canonical layer (title normalization + iptv-org enrichment, no API keys)
- g4: embeddings / semantic (sqlite-vec in place, worker not built)
- g5: cross-language resolution (TMDB and other keyed enrichments)

### Multi-source deduplication (g3+)
Not yet implemented. Same movie from two sources appears as two items. Will resolve via canonical identity layer built on title normalization (g3) plus keyed enrichment later.

### Enrichment (g3+)
Hidden in g1/g2 UI. g3 brings iptv-org (keyless, public data) for live channel logos/country/category. Keyed providers (TMDB) follow later.

### Catchup / Timeshift
For live TV channels with catchup support:
- EPG shows past programs as clickable (dimmed but interactive)
- Click → constructs timeshift URL via Xtream API → plays in player
- Visual indicator on channels that support catchup

## Project structure

```
fractals/
├── package.json
├── vite.config.ts
├── electron/
│   ├── main.ts                    # Electron entry point
│   ├── preload.ts                 # contextBridge API
│   ├── database/
│   │   ├── connection.ts          # SQLite setup + migrations
│   │   ├── schema.ts              # Drizzle schema
│   │   └── migrations/            # SQL migration files
│   ├── services/
│   │   ├── xtream-sync.service.ts # Xtream API + sync logic
│   │   ├── m3u-sync.service.ts    # M3U import + parse
│   │   ├── tmdb.service.ts        # TMDB API enrichment
│   │   ├── search.service.ts      # FTS5 + vector search
│   │   └── epg.service.ts         # EPG fetch + parse
│   ├── workers/
│   │   ├── enrichment.worker.ts   # TMDB enrichment background job
│   │   └── embedding.worker.ts    # transformers.js embedding generation
│   └── ipc/
│       └── handlers.ts            # All IPC handler registrations
├── src/
│   ├── main.tsx                   # React entry
│   ├── App.tsx                    # Root component, routing
│   ├── stores/                    # Zustand stores
│   │   ├── search.store.ts
│   │   ├── player.store.ts
│   │   ├── sources.store.ts
│   │   └── user.store.ts
│   ├── services/
│   │   ├── data.service.ts        # Abstract interface
│   │   ├── electron.service.ts    # IPC implementation
│   │   └── capacitor.service.ts   # Direct API implementation
│   ├── components/
│   │   ├── search/                # Search bar, results, filters
│   │   ├── browse/                # Browse rows, category grids
│   │   ├── content/               # Detail page, metadata display
│   │   ├── player/                # Video player, controls, overlays
│   │   ├── settings/              # Source management, preferences
│   │   └── shared/                # Common UI primitives
│   ├── hooks/                     # React hooks
│   ├── lib/                       # Utilities, types, constants
│   └── styles/                    # Tailwind config, global styles
├── capacitor/                     # Capacitor config + native projects
├── tizen/                         # Tizen packaging config
└── tests/
```

## Development commands

```bash
# Dev mode (React + Electron)
pnpm dev              # Starts Vite dev server + Electron

# Dev mode (web only, no Electron)
pnpm dev:web          # Starts Vite dev server at localhost:5173

# Build
pnpm build            # Production build (web assets)
pnpm build:electron   # Package Electron app
pnpm build:android    # Capacitor Android build
pnpm build:ios        # Capacitor iOS build
pnpm build:tizen      # Tizen .wgt package

# Test
pnpm test             # Vitest unit tests
pnpm test:e2e         # Playwright e2e tests

# Lint
pnpm lint             # ESLint + Prettier check
```

## Coding conventions

- **TypeScript strict mode** everywhere
- **Functional components only** — no class components
- **Zustand** for global state, React hooks for local state
- **TanStack Query** for all async data (IPC calls, API fetches)
- **Named exports** only — no default exports (easier to search/refactor)
- **Barrel files** (`index.ts`) only at feature boundaries, not in every folder
- **Tailwind** for styling — no CSS modules, no styled-components
- **Path aliases**: `@/` maps to `src/`, `@electron/` maps to `electron/`
- Error boundaries at route level, not per-component
- Keep components small — if it exceeds ~150 lines, split it

## Design language

### V2 token system (current — replaces the legacy --color-* system)
Components consume `--bg-0..4`, `--text-0..3`, `--border-subtle/default/strong`, and `--accent-*` tokens.
These are defined in `:root` as dark defaults, then **bridged** via `[data-theme]` selector to the `--color-*` system in `globals.css`. Light themes also need the light-specific V2 adjustment block (inverts bg hierarchy).

**Dark theme defaults:**
```
--bg-0..4:   #08080c → #282834  (deepest to lightest)
--text-0:    #f2f0ff  (near-white)
--text-1:    #9894bc  (secondary)
--text-2:    #54526e  (tertiary)
--text-3:    #555566  (disabled)
--accent-interactive: #7c4dff (violet)
--accent-live: #e05555 · --accent-film: #4a9eff · --accent-series: #2dba85
```

### Typography
- UI text: system font stack (`-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif`)
- Monospace (metadata, timestamps): `'JetBrains Mono', 'Fira Code', monospace`
- No custom display fonts — utility aesthetic, not branding exercise

### Spacing and density
- Base unit: 4px
- Compact by default — information density over whitespace
- Cards: 8px padding, 4px gaps in grids
- TV mode: 1.5x scale on all spacing and text sizes

### Focus and navigation
- Visible focus ring: 2px solid primary color with 2px offset
- TV mode: larger focus ring (3px), subtle glow effect
- Keyboard shortcuts displayed in tooltips
- Tab order follows visual reading order (left→right, top→bottom)

## Keyboard shortcuts (desktop)

| Shortcut | Action |
|---|---|
| `/` or `Cmd+K` | Focus search bar |
| `Escape` | Clear search / close overlay / go back |
| `Enter` | Select / play |
| `Space` | Play/pause (in player) |
| `←` `→` | Seek (in player) |
| `↑` `↓` | Channel surf (live TV) / navigate list |
| `F` | Toggle fullscreen |
| `M` | Mute |
| `Cmd+,` | Settings |
| `Cmd+1-4` | Switch filter: All / Live / Movies / Series |

## What Fractals is NOT

- Not a playlist manager — sources are configured once and forgotten
- Not a Netflix clone — no hero banners, no autoplay, no algorithm-driven "feed"
- Not a social app — no sharing, no public profiles, no cloud sync (for now)
- Not a content provider — ships with zero content, user brings their own sources

## Data model — vocabulary (locked 2026-04-12)

### g1 — Provider data only (current)

Single layer. What M3U/Xtream APIs return, stored directly.

- Three content types: **Live** (channels), **Movie** (VOD), **Series** (parent only; episodes fetched on demand as streams with `parent_series_id`)
- Radio = Live variant (same structure, different category)
- Tied to subscription — goes away when source is removed/expired
- User data (favorites, watchlist, ratings, positions) keyed by stream/series_source ID
- User data survives resync via backup/restore pattern in sync workers
- No deduplication — same content from two sources = two items
- Title normalizer extracts `year_hint`, `language_hint`, `origin_hint`, `quality_hint` at sync time

### g2 — FTS5 layer (complete)

Single-table FTS5 index (`content_fts`) over streams + series_sources. Ligature folding at index and query time. Auto-built at end of every sync. Toggle exists in Sources panel for debug but flipped on after every successful index. No canonical, no enrichment yet.

### g3+ — Canonical identity layer (planned, keyless first)

Will add a second layer:
- Keyless (g3): title normalization into canonical rows, plus iptv-org enrichment (logos, country, category, NSFW) for live channels via `tvg-id` match
- Keyed (later): TMDB canonical identity (English title, year, genres, poster) for movies + series
- Bridge: multiple provider streams → one canonical identity
- Search target shifts from provider titles to canonical titles
- Deduplication across sources

## Implementation status (as of 2026-04-12)

**Phase 0–2.5 — Complete.** Core through V3 data model.
**g1 — Complete.** Pure provider-data app. 12 tables. LIKE search with debounce. User data survives resync. Type-bleeding fix (search scoped by contentType).
**g2 — Complete.** FTS5 + manual/auto indexing + toggle + diacritic/ligature folding + grid LIKE fallback. Sync auto-runs indexing and flips `ftsEnabled` on.
**g3–g5 — Not started.** g3 (keyless canonical + iptv-org), g4 (embeddings), g5 (keyed enrichment, cross-language).
**Phase 3 — Not started.** Capacitor for Android/iOS/TV, Tizen.

### g1 features (current state)

**Layout**
- Three-zone layout: NavRail (48px, left) + content area + right-side slide panels
- CommandBar (44px, top) always visible. Shows search + sort + source dots on browse views; source dots only on Home.
- `BrowseSidebar` (168px, left of grid) on live/films/series views
- NavRail sources icon pulses during sync activity

**Home screen**
- Two modes: Discover (content strips) / My Channels (drag-to-reorder favorites grid)
- Info strip shows live sync progress during sync, greeting + stats otherwise
- Inline search results (debounced, min 2 chars)

**Search (g1 baseline)**
- LIKE on provider titles, 250ms debounce, min 2 character threshold
- Three parallel queries (live, movie, series) via IPC
- `debouncedQueries` in search store — raw query for input display, debounced for IPC

**Browse**
- VirtualGrid with dynamic row heights (16:9 for live, 2:3 for posters)
- Per-view category filter persisted in store
- Category sidebar auto-scrolls active item to center
- Configurable grid page size (25/50/75/100/200)

**Live TV**
- Grid → Split View → Fullscreen navigation stack
- Split view: 300px channel list + player + EPG strip
- EPG: auto-expanded, styled description cards, now/next display
- Full Guide: bottom sheet, 200px/hr timeline, 300px channel column, detail panel
- Channel surf: `[`/`]` keys, Cmd+Up/Down, PgUp/PgDn

**Favorites / watchlist**
- `__favorites__` sentinel in BrowseSidebar
- Three user data tables: stream_user_data, series_user_data, channel_user_data
- Optimistic updates with rollback
- Drag-to-reorder My Channels (@dnd-kit)
- User data survives resync (backup/restore around CASCADE delete)

**Player**
- Position saved on pause, 10s interval, and close
- `minWatchSeconds` threshold (default 5s)
- EPG now/next overlay on fullscreen live (auto-hides with controls)
- Category pill chip navigates back to browse category

**Detail panels**
- Movies: 380px slide panel, breadcrumbs pinned top, category link
- Series: 720px double-width, season coins + episode list
- Action buttons: play/resume, favorite, watchlist, star rating, clear history
- External player + enrichment sections hidden (g2+)

**Settings**
- Appearance: theme picker, font picker
- Interface: home mode, strip width, grid page size, timezone override (system default toggle + manual picker)
- Player: engine, min watch seconds, controls mode
- Data: clear history / favorites / all data / reset

**EPG**
- `has_epg_data` computed via EXISTS subquery on epg table
- Times respect timezone override via shared `fmtTime` utility
- Full Guide: 300px channel column, 200px/hr timeline scale

## Key architecture decisions (implemented)

- **Worker threads for heavy operations** — Sync and delete run in `electron/workers/` via `worker_threads`, each opening its own better-sqlite3 connection (WAL mode allows concurrent access). Prevents main process blocking on 200k+ row operations.

- **Sync user data preservation** — Sync workers backup stream_user_data, series_user_data, channel_user_data into temp tables before deleting streams (CASCADE would wipe them), then restore rows whose IDs still exist after reinserting. Clean sync + favorites survive.

- **LIKE search with debounce (g1) + FTS5 (g2)** — g1: LIKE `%query%` on provider titles, 250ms debounce, min 2 char threshold. g2: adds FTS5 via `content_fts` virtual table with unicode61 + ligature folding, auto-built after every sync, with grid LIKE fallback when FTS returns <10 results.

- **Source-scoped content IDs** — Format `{sourceId}:{type}:{streamId}` ensures correct credentials used for playback. Same stream_id on same server returns HTTP 405 with wrong account credentials.

- **Unified ContentDetail panel** — Movies and series both use the same side panel. Series gets double-width (720px vs 380px) with a left column for season coin selector + episode list, right column for identical metadata layout. Panel stays mounted behind player so users can pick episodes without re-navigating.

- **Layered Escape handling** — All overlay Escape handlers use `addEventListener('keydown', handler, true)` (capture phase) + `e.stopImmediatePropagation()`. Player defers ContentDetail Escape via `isPlaying` prop. Prevents Escape from leaking to lower layers.

- **Source identity colors** — Each source gets a distinct hue from a palette ordered for maximum visual distance. Dots show source color (not generic green/red status). Red only for error/expired. Source color bars shown on all card types (ChannelCard, PosterCard, list rows).

- **Source ID quad fallback** — Always resolve `primarySourceId` as: `item.primarySourceId ?? item.primary_source_id ?? (item as any).source_ids ?? item.id?.split(':')[0]`. Some channels have `primary_source_id = NULL` in the DB; the content ID (`{sourceId}:{type}:{streamId}`) is the reliable last resort.

- **Shared timezone-aware time formatting** — `src/lib/time.ts` exports `fmtTime(unix)` that reads timezone from app store. Used by LiveSplitView, EpgGuide, TimeshiftBar.

## Known limitations & open work

- **No enrichment / canonical yet (g1 + g2)** — FTS5 search and diacritic/ligature folding landed in g2. Still no TMDB metadata, no iptv-org matching, no deduplication across sources. All deferred to g3+.

- **Episode stream hang** — Player shows infinite spinner when episode URL 404s. Needs timeout + error overlay.

- **Diacritic / ligature search** — FIXED in g2 via FTS5 `unicode61 remove_diacritics 2` plus `fold_ligatures()` scalar.

- **Black screen bug** — Occasional idle black screen requiring Cmd+R. Undiagnosed, needs DevTools console output. Deferred.

- **International character search** — European diacritics partially handled. Arabic, Hebrew, Cyrillic, CJK not transliterated. Cross-language is g5.

- **EPG timeshift bar** — Full Guide panel done. Timeshift bottom bar in fullscreen player pending.

- **Capacitor / mobile not yet implemented** — Phase 3.

## Data quirks to be aware of

- **Same series from two sources appears twice in Favorites** — Content rows are source-scoped (`{sourceId}:{type}:{streamId}`). No deduplication until g3 (canonical layer). Expected behavior for g1.

- **Series appearing under Films** — Some IPTV providers store mini-series with `type = 'movie'`. The app stores whatever type the provider returns.
