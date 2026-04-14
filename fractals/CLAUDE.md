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
│  │  • channels, movies, series, episodes (content, split)  │  │
│  │  • channel_categories, movie_categories, series_cats    │  │
│  │  • *_user_data (one per content type)                   │  │
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

## Database schema (g1c — 15 tables, per-type split)

DDL source of truth: `fractals/electron/database/schema.g1c.sql.ts`.

```
── Core (3) ────────────────────────────────────────────────
sources
  id, type (xtream|m3u), name, server_url, username, password,
  status, last_sync, item_count, disabled, ingest_state, ...

profiles
  id, name

settings
  key, value

── Channels ───────────────────────────────────────────────
channel_categories
  id, source_id (FK), external_id, name, position

channels
  id ({sourceId}:live:{streamId}), source_id (FK), category_id (FK, SET NULL),
  external_id, title, search_title, thumbnail_url,
  tvg_id, epg_channel_id, catchup_supported, catchup_days

epg
  id, source_id (FK), channel_external_id, title, description,
  start_time, end_time

── Movies ─────────────────────────────────────────────────
movie_categories
  id, source_id (FK), external_id, name, position

movies
  id ({sourceId}:movie:{streamId}), source_id (FK), category_id (FK, SET NULL),
  external_id, title, search_title, thumbnail_url,
  container_extension, md_year, md_country, md_language, md_origin, md_quality

── Series ─────────────────────────────────────────────────
series_categories
  id, source_id (FK), external_id, name, position

series
  id ({sourceId}:series:{seriesId}), source_id (FK), category_id (FK, SET NULL),
  external_id, title, search_title, thumbnail_url, md_year, …

episodes
  id, series_id (FK → series ON DELETE CASCADE), season, episode,
  title, thumbnail_url, stream_url, container_extension
  -- no search_title (found via parent series)

── User data (4) ─────────────────────────────────────────
channel_user_data  (profile_id, channel_id)      → is_favorite, fav_sort_order
movie_user_data    (profile_id, movie_id)        → is_favorite, is_watchlisted, rating, watch_position, …
series_user_data   (profile_id, series_id)       → is_favorite, is_watchlisted, rating
episode_user_data  (profile_id, episode_id)      → watch_position, completed, last_watched_at
```

**Sync / CASCADE:** Resync wipes per-source content rows and CASCADEs their user_data. Per the g1c hard cut, user data is expendable across resyncs (users re-sync from providers). This reverses the g1 backup-and-restore behaviour.

**`search_title` column** is populated inline at sync INSERT by the workers, not a separate Index step. Value is `anyAscii(title).toLowerCase()`. The same normalizer (`electron/lib/normalize.ts`) is applied to the user's query before the LIKE comparison — bidirectional diacritic / ligature match (ae↔æ, e↔é, ss↔ß, oe↔œ).

**Removed from g1:** the old `streams`, `series_sources`, `stream_categories`, `series_source_categories`, and shared `categories` tables. Also removed from the original g1c design: `channel_fts`, `movie_fts`, `series_fts` — FTS5 was tried and rejected (see Search architecture below).

## Key design decisions

### Search architecture (g1c)
Plain `LIKE '%query%'` on a persisted `search_title` column (any-ascii + lowercase). B-tree index on `search_title` + `LIMIT` short-circuits per-type at IPTV catalog scale. No FTS, no ranking.

- **Normalizer (`electron/lib/normalize.ts`)** — lowercase + any-ascii folding (diacritics + ligatures). One function, two callers: sync workers populate `search_title`; search handler normalizes the user's query before LIKE.
- **Three parallel queries on Browse** (live, movie, series) with independent pagination.
- **Home** runs them sequentially with `skipCount: true` (channels → movies → series) so each section lands on screen as soon as its own query resolves, without SQLite running concurrent COUNT scans.
- **Debounce** 250ms, min 2 char threshold in the search store.

**Why not FTS5:** Tried trigram and unicode61 tokenizers at this catalog scale (10k–100k rows per source). Posting lists were large, SQLite couldn't push `source_id` / `category` filters into FTS, and COUNT enumerated full match sets. LIKE + B-tree index + LIMIT was faster. Revisit only if catalog grows past ~1M rows or there's a concrete use case LIKE can't serve. See `PLAN.md` "g2 — future search improvements" for possibilities.

### Multi-source deduplication (not planned in g1c)
Same movie from two sources appears as two items. This is a permanent g1c tradeoff — canonical identity is not on the roadmap (it was the biggest complexity source in the discarded g2-flat branch).

### Enrichment (not in g1c)
Hidden in the UI. The enrichment IPC surface is stubbed (returns zeros) so renderer status pollers don't crash. TMDB / iptv-org / Wikidata / IMDb-suggest providers were deleted as part of the g1c simplification.

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

## Data model — vocabulary

### g1c — Provider data, per-type split (current)

Single layer. What M3U/Xtream APIs return, stored directly into per-type tables:

- **Three content types, one table each:** `channels` (Live), `movies` (VOD), `series` (Series parent). `episodes` is a sub-part of `series`, not a top-level content type — episodes are lazy-fetched via `get_series_info` on first detail open.
- **Per-type user data:** `channel_user_data`, `movie_user_data`, `series_user_data`, `episode_user_data`. Each carries only the columns it needs (movies get watch_position; channels get favorites only; episodes get only playback state).
- **Radio = Live variant** (same structure, different category).
- **Tied to subscription** — content goes away when source is removed / expired. Resync wipes user_data via CASCADE (g1c hard cut).
- **No deduplication** — same content from two sources = two items.
- **Search target** is `search_title` (persisted normalized column), not `title`. Populated inline at sync INSERT.
- **Metadata columns** use the `md_` prefix on each content table (`md_country`, `md_language`, `md_year`, `md_origin`, `md_quality`). Shape locked; enrichment population deferred.

Canonical identity / deduplication is not on the roadmap — it's a permanent g1c tradeoff.

## Implementation status (as of 2026-04-14)

**Phase 0–2.5 — Complete.** Core through V3 data model.
**g1 — Complete (2026-04-12).** Pure provider-data app on 12 tables. LIKE search with debounce. User data survived resync.
**g1c — Complete (2026-04-14).** Per-type 15-table split. LIKE on `search_title` (any-ascii + lowercase, inline at sync). Two-button pipeline (Test → Sync; EPG auto-chains inside Sync for Xtream). FTS5 tried and removed. Enrichment pipeline (iptv-org / Wikidata / IMDb-suggest / indexing worker) deleted.
**g2+ — Future.** Search improvements (see `PLAN.md`). No commitments.
**Phase 3 — Not started.** Capacitor for Android/iOS/TV, Tizen.

### g1c features (current state)

**Layout**
- Three-zone layout: NavRail (48px, left) + content area + right-side slide panels
- CommandBar (44px, top) always visible. Shows search + sort + source dots on browse views; source dots only on Home.
- `BrowseSidebar` (168px, left of grid) on live/films/series views
- NavRail sources icon pulses during sync activity

**Home screen**
- Two modes: Discover (content strips) / My Channels (drag-to-reorder favorites grid)
- Info strip shows live sync progress during sync, greeting + stats otherwise
- Inline search results (debounced, min 2 chars)

**Search (g1c)**
- LIKE on `search_title` (any-ascii + lowercase, populated inline at sync INSERT)
- Same normalizer applied to query string — bidirectional diacritic / ligature match
- 250ms debounce, min 2 character threshold
- Browse: three parallel per-type queries via IPC
- Home: sequential per-type queries with `skipCount: true` (channels → movies → series)
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
- Four user data tables: `channel_user_data`, `movie_user_data`, `series_user_data`, `episode_user_data`
- Optimistic updates with rollback
- Drag-to-reorder My Channels (@dnd-kit)
- User data is wiped on resync (CASCADE) — g1c hard cut, users re-sync from providers

**Player**
- Position saved on pause, 10s interval, and close
- `minWatchSeconds` threshold (default 5s)
- EPG now/next overlay on fullscreen live (auto-hides with controls)
- Category pill chip navigates back to browse category

**Detail panels**
- Movies: 380px slide panel, breadcrumbs pinned top, category link
- Series: 720px double-width, season coins + episode list
- Action buttons: play/resume, favorite, watchlist, star rating, clear history
- External player + enrichment sections hidden (deferred)

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

- **Resync wipes user data (g1c hard cut)** — CASCADE on source delete / resync wipes per-source user_data rows. Users re-sync from providers after the schema transition. This reverses the g1 backup-and-restore behaviour.

- **LIKE search on normalized `search_title` (g1c)** — `LIKE '%query%'` on a persisted `search_title` column, populated at sync INSERT via any-ascii folding. 250ms debounce, min 2 character threshold. FTS5 was tried at this scale and removed (posting lists too large, COUNT enumerated full match sets).

- **Ingest pipeline is 2 buttons (Test → Sync)** — `ingest_state` enum `added → tested → synced → epg_fetched`. EPG auto-chains inside the sync worker for Xtream sources; M3U stops at `synced`. The Sync button shows "done" at both `synced` and `epg_fetched` so EPG-less sources aren't stuck purple.

- **Source-scoped content IDs** — Format `{sourceId}:{type}:{streamId}` ensures correct credentials used for playback. Same stream_id on same server returns HTTP 405 with wrong account credentials.

- **Unified ContentDetail panel** — Movies and series both use the same side panel. Series gets double-width (720px vs 380px) with a left column for season coin selector + episode list, right column for identical metadata layout. Panel stays mounted behind player so users can pick episodes without re-navigating.

- **Layered Escape handling** — All overlay Escape handlers use `addEventListener('keydown', handler, true)` (capture phase) + `e.stopImmediatePropagation()`. Player defers ContentDetail Escape via `isPlaying` prop. Prevents Escape from leaking to lower layers.

- **Source identity colors** — Each source gets a distinct hue from a palette ordered for maximum visual distance. Dots show source color (not generic green/red status). Red only for error/expired. Source color bars shown on all card types (ChannelCard, PosterCard, list rows).

- **Source ID quad fallback** — Always resolve `primarySourceId` as: `item.primarySourceId ?? item.primary_source_id ?? (item as any).source_ids ?? item.id?.split(':')[0]`. Some channels have `primary_source_id = NULL` in the DB; the content ID (`{sourceId}:{type}:{streamId}`) is the reliable last resort.

- **Shared timezone-aware time formatting** — `src/lib/time.ts` exports `fmtTime(unix)` that reads timezone from app store. Used by LiveSplitView, EpgGuide, TimeshiftBar.

## Known limitations & open work

- **No FTS / enrichment / canonical (g1c)** — Search is LIKE only on `search_title`. No TMDB metadata. No deduplication across sources. FTS was tried and removed; canonical is a permanent g1c tradeoff.

- **Black screen bug** — Occasional idle black screen requiring Cmd+R. Undiagnosed, needs DevTools console output. Deferred.

- **International character search** — European diacritics + ligatures handled bidirectionally via any-ascii. Arabic, Hebrew, Cyrillic, CJK pass through any-ascii to their closest Latin form; effectiveness varies.

- **Capacitor / mobile not yet implemented** — Phase 3.

## Data quirks to be aware of

- **Same series from two sources appears twice in Favorites** — Content rows are source-scoped (`{sourceId}:{type}:{streamId}`). Deduplication is not on the g1c roadmap. Expected behavior.

- **Series appearing under Films** — Some IPTV providers store mini-series with `type = 'movie'`. The app stores whatever type the provider returns.

- **Resync wipes user data** — Per the g1c hard cut, resync CASCADEs per-source user_data. Favorites, watch positions, ratings don't survive a resync of the same source. Expected behavior.
