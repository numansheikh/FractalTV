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
- **sqlite-vec** extension for vector similarity search
- **Drizzle ORM** for typed database queries
- **@xenova/transformers** (transformers.js) for local embedding generation
- **Node.js** worker threads for background tasks (sync, enrichment, embedding)

### Mobile / TV
- **Capacitor** for Android (phone/tablet/TV single APK) and iOS
- **Tizen Studio** packaging for Samsung TV (same web build)

## Architecture overview

```
┌──────────────────── ELECTRON MAIN PROCESS ────────────────────┐
│                                                                │
│  ┌─────────────┐  ┌─────────────┐  ┌───────────────────────┐ │
│  │ Xtream Sync │  │  M3U Sync   │  │  TMDB Enrichment      │ │
│  │ (N sources) │  │             │  │  (background worker)   │ │
│  └──────┬──────┘  └──────┬──────┘  └───────────┬───────────┘ │
│         └────────┬───────┘                      │             │
│                  ▼                               │             │
│  ┌─────────────────────────────────────────────────────────┐  │
│  │              SQLite + sqlite-vec                         │  │
│  │  • content (movies, series, episodes, channels)         │  │
│  │  • sources (xtream accounts, m3u urls)                  │  │
│  │  • embeddings (384-dim vectors per content item)        │  │
│  │  • epg (program schedules)                              │  │
│  │  • user_data (favorites, watch history, resume points)  │  │
│  └─────────────────────────────────────────────────────────┘  │
│                  │                               │             │
│                  │              ┌────────────────┘             │
│                  ▼              ▼                              │
│  ┌──────────────────────────────────────────┐                 │
│  │  transformers.js (embedding worker)       │                 │
│  │  Model: all-MiniLM-L6-v2 (~30MB)         │                 │
│  │  Generates embeddings from enriched text  │                 │
│  └──────────────────────────────────────────┘                 │
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

## Database schema (conceptual)

```
sources
  id, type (xtream|m3u), name, server_url, username, password, status, last_sync

content
  id, source_id (FK), external_id (xtream stream_id), tmdb_id,
  type (live|movie|series|episode),
  title, original_title, year, plot, poster_url, backdrop_url,
  rating_imdb, rating_tmdb, genres, languages, country,
  director, cast (JSON array),
  parent_id (FK, for episodes → series),
  season_number, episode_number,
  stream_url, container_extension,
  catchup_supported (bool), catchup_days (int),
  created_at, updated_at

content_sources  (for deduplication — same content from multiple sources)
  content_id (FK), source_id (FK), stream_url, quality, priority

embeddings
  content_id (FK), vector (BLOB, 384 floats)

epg
  id, channel_external_id, title, description,
  start_time, end_time, source_id (FK)

categories
  id, source_id (FK), name, type (live|movie|series), parent_id

user_data
  content_id (FK), favorite (bool), watchlist (bool),
  last_position (seconds), completed (bool),
  last_watched_at

profiles
  id, name, pin (nullable), is_child (bool)

profile_user_data
  profile_id (FK), content_id (FK), ... (same fields as user_data)
```

## Key design decisions

### Multi-source deduplication
When the same movie exists on multiple Xtream sources:
1. Match by TMDB ID (fetched during enrichment based on title + year)
2. Store as one `content` row, multiple `content_sources` rows
3. UI shows one entry with "Available on 3 sources" — auto-picks best quality, user can override

### Search architecture
Three layers, results merged and ranked:
1. **SQLite FTS5** — full-text search on title, plot, cast, director, genres
2. **sqlite-vec** — cosine similarity on embeddings for semantic search
3. **Facet filters** — SQL WHERE clauses on structured fields (year, genre, type, language, rating)

A single search query runs all three in parallel, results are merged with FTS matches weighted highest, semantic matches filling in gaps.

### Enrichment pipeline
Background process on source sync:
1. Xtream API returns raw content list (title, stream_id, category)
2. For each item: query TMDB search API (title + year) → get tmdb_id
3. Fetch TMDB details (plot, cast, director, genres, keywords, similar)
4. Generate embedding from concatenated text: "{title}. {plot}. Genres: {genres}. Starring: {cast}. Directed by: {director}. Keywords: {keywords}"
5. Store everything in SQLite

Rate limiting: TMDB allows 40 requests/second. Enrichment is progressive — UI works immediately with raw Xtream data, enrichment fills in metadata over minutes/hours.

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

## Implementation status (as of 2026-04-06) — v0.2.0

**Complete:** Phases 1–6 (scaffold, DB + Xtream sync, TMDB enrichment, FTS5 search, browse/search UI, video player). Phase 12 user data (favorites, watchlist, ratings, history, continue watching — fully wired).
**Partial:** Phase 10 settings (appearance, player, enrichment done; profiles + EPG config pending).
**Not started:** Phase 7 (EPG/catchup), Phase 8 (semantic search), Phase 9 (M3U), Phase 11 (Capacitor/mobile).

### v0.2.0 — completed features

**Layout**
- Three-zone layout: NavRail (48px, left) + content area + right-side slide panels
- `AppShell.tsx` orchestrates the shell; `NavRail.tsx` for icon-only navigation
- CommandBar (44px, top) with search + sort + source dots — hidden on Home when no query
- `BrowseSidebar.tsx` (168px, left of grid) shown on live/films/series views; bg-1 to contrast with bg-2 cards

**Home screen — two modes**
- `HomeView.tsx` — search bar pinned to the bottom, source dots at bottom-right (flex-wrap, 2 per row)
- **Discover mode** — "Favorite Channels" + "Continue Watching" (movies, series) + "Watch Later" (watchlist) horizontal rows; hidden when empty
- **My Channels mode** — drag-to-reorder grid of favorite channels only
- Mode persisted in `app.store` (`homeMode`). Toggled via Settings → Appearance
- First-favorite prompt: shown once when user adds their first channel favorite while in Discover mode
- Empty channels mode: dedicated empty state with "Browse channels" + "Switch to Discover" actions

**Favorites / watchlist system**
- `__favorites__` sentinel value for `categoryFilter` — default when entering any browse view
- Favorites chip never shown in FilterBar (it's the default state, not a filter)
- `BrowseSidebar` pinned section: "Favorites" (heart icon, default) + "All" above scrolling category list
- ContentArea empty state is context-aware: no sources / no favorites / empty category / no search results
- Search query guards against sending `__favorites__` as categoryName to the DB

**Drag-to-reorder My Channels**
- `@dnd-kit/core` + `@dnd-kit/sortable` — PointerSensor (6px activation), KeyboardSensor
- `fav_sort_order INTEGER` column in `user_data` (SQLite migration, safe try/catch)
- `user:favorites` IPC orders by `COALESCE(fav_sort_order, 999999) ASC, last_watched_at DESC`
- `user:reorder-favorites` IPC persists new order in a transaction
- Local `orderedIds` state for optimistic UI; rollback on API error

**User data (Phase 12 — complete)**
- Favorites, watchlist, ratings, history, positions, continue watching — all IPC-wired
- Optimistic updates with rollback on all mutations
- Library view: Favorites / Watchlist / History / Continue Watching tabs
- Settings → Data tab: clear history / favorites / all data / reset preferences
- `user_data.fav_sort_order` for manual channel ordering
- Heart toggle in VirtualGrid list-view rows

**Episode persistence (critical fix)**
- Episodes were never written to `content` table → `user_data` FK constraint caused silent position-save failure
- `series:get-info` handler now upserts all episodes into `content` + `content_sources` on series open
- Episode IDs use `{sourceId}:episode:{streamId}` format matching DB rows
- `loadBulk` called for visible episodes so progress bars render immediately

**Player**
- Position saved on pause, on 10s interval, and on close (unmount)
- Fixed race condition: position IPC now resolves before query cache is invalidated
- Both `['home-continue']` and `['library','continue-watching']` invalidated on player close
- `minWatchSeconds` threshold (default 5s) prevents accidental history entries

**Theming**
- Two themes: `dark` (default) and `fractals-day` (light)
- V2 token system (`--bg-0..4`, `--text-0..3`, `--border-*`, `--accent-*`) used everywhere
- Sidebar uses `--bg-1` (panel level), cards use `--bg-2` — maintains visual separation

## Key architecture decisions (implemented)

- **Worker threads for heavy operations** — Sync and delete run in `electron/workers/` via `worker_threads`, each opening its own better-sqlite3 connection (WAL mode allows concurrent access). Prevents main process blocking on 200k+ row operations.

- **Hybrid FTS5 + LIKE search** — FTS5 for fast ranked prefix matches, LIKE for substring matches ("dar" finds "undark"). Results merged with deduplication. Space-aware tokenization: trailing space = exact word, no trailing space = prefix.

- **Source-scoped content IDs** — Format `{sourceId}:{type}:{streamId}` ensures correct credentials used for playback. Same stream_id on same server returns HTTP 405 with wrong account credentials.

- **On-demand TMDB enrichment** — ContentDetail panel auto-triggers enrichment when opened for unenriched movie/series. Multi-candidate title cleaning: strips language prefixes ("EN - "), extracts embedded years ("(2015)"), tries with/without subtitles after ":" or " - ". Manual search fallback with choosable results list when auto fails. "Wrong match?" link for re-matching already-enriched content.

- **Unified ContentDetail panel** — Movies and series both use the same side panel. Series gets double-width (720px vs 380px) with a left column for season coin selector + episode list, right column for identical metadata layout. Panel stays mounted behind player so users can pick episodes without re-navigating. SeriesView.tsx is deprecated (unused).

- **Special character search** — Queries containing `[`, `]`, `(`, `)`, `-`, `_` flip search priority to LIKE-first (preserves special chars) with FTS5 filling remaining slots. Normal queries use FTS5-first.

- **Layered Escape handling** — All overlay Escape handlers use `addEventListener('keydown', handler, true)` (capture phase) + `e.stopImmediatePropagation()`. Player defers ContentDetail Escape via `isPlaying` prop. Prevents Escape from leaking to lower layers (e.g., clearing SearchBar query).

- **Source identity colors** — Each source gets a distinct hue from a palette ordered for maximum visual distance. Dots show source color (not generic green/red status). Red only for error/expired.

## Known limitations & open work

- **International character search (partial)** — European diacritics handled via `any-ascii`. Arabic, Hebrew, Cyrillic, CJK not yet transliterated.

- **M3U/M3U8 playlist support not yet implemented** — Only Xtream Codes accounts. Phase 9.

- **Semantic / embedding search not yet wired** — Schema and extension in place; worker not built. Phase 8.

- **EPG / program guide not yet implemented** — Schema exists; no XMLTV parser, no catchup. Phase 7.

- **Episodes not indexed in FTS5** — `series:get-info` upserts episodes into `content` but not `content_fts`. Episode titles not searchable by keyword. Low priority (users search series not episodes).

- **Continue Watching not browsable in live/films/series views** — Works on Home and Library only.

- **Capacitor / mobile not yet implemented** — Phase 11.

## Known UI bugs (open — not yet fixed)

- **Home search bar coexists with CommandBar** — Home has its own bottom search bar; CommandBar appears at top when typing. Two inputs share `useSearchStore.query`, no functional conflict but visually redundant.

- **Left source bar on PosterCard may conflict with hover border** — `borderLeft: 3px` + `border: 1px` shorthand resets border-left width. Relies on V8 insertion order. Consider a pseudo-element stripe instead.

- **`--color-nav-bg` / `--color-nav-text` defined in themes but never consumed** — NavRail uses `--bg-1`. Dead CSS.

- **`addRecentSearch` / `removeRecentSearch` actions dead** — Recent searches UI was removed. Store actions and persisted array remain unused.

## Data quirks to be aware of

- **Same series from two sources appears twice in Favorites** — Content rows are source-scoped (`{sourceId}:{type}:{streamId}`). Until two sources' series are merged via TMDB ID match during enrichment, they are separate items. Both get favorited separately and appear as two rows. Expected behavior; will self-resolve once enrichment runs.

- **Series appearing under Films Favorites** — Some IPTV providers store limited series / mini-series with `type = 'movie'` in their Xtream API. The app stores whatever type the provider returns. A series like "The Queen's Gambit" may appear under Films not Series.
