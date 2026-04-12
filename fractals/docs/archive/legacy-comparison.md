Now I have a comprehensive picture. Here is the feature comparison:

---

# Legacy vs Fractals Feature Comparison

## Source Management

| Feature | Legacy | Fractals | Notes |
|---|---|---|---|
| Xtream Codes API sources | Yes | Yes | Both support username/password/server URL |
| M3U file upload (local) | Yes | No | Legacy has drag-drop file upload; Fractals Phase 9 |
| M3U URL import | Yes | No | Legacy has URL import dialog; Fractals Phase 9 |
| M3U text paste | Yes | No | Legacy has text-import component; Fractals Phase 9 |
| Stalker portal (MAC-based) | Yes | No | Legacy has full Stalker module with store/routes/favorites; not planned in Fractals |
| Source disable toggle | No | Yes | Fractals allows disabling a source without deleting it |
| Source filtering (browse by source) | No | Yes | Fractals has colored source tabs to filter content by source |
| Multi-source merging | No | Yes (designed) | Fractals merges content across sources via `content_sources` table; legacy treats each playlist as isolated |
| Source identity colors | No | Yes | Fractals assigns distinct hues to each source for visual identification |
| Source expiration display | Basic | Yes | Fractals shows expiry date and max connections from Xtream account info |
| Auto-refresh playlists | Yes | No | Legacy has `autoRefresh` flag on playlists |
| Custom User-Agent/Origin/Referrer per source | Yes | No | Legacy stores `userAgent`, `origin`, `referrer` per playlist |
| Account info display | Yes | No | Legacy has dedicated account-info component showing Xtream account details |

## Content Browsing

| Feature | Legacy | Fractals | Notes |
|---|---|---|---|
| Category browsing | Yes | Yes | Both support browsing by category |
| Category hide/show management | Yes | No | Legacy has category-management-dialog to hide categories |
| Type filtering (All/Live/Movies/Series) | Yes | Yes | Both have type tabs |
| Pagination | Basic | Yes | Fractals has configurable page sizes with sort options |
| Sorting (title, year, rating, latest) | No | Yes | Fractals supports multiple sort modes |
| Virtual scroll for large lists (90k+) | Yes | No | Legacy uses CDK virtual scroll; Fractals uses pagination |
| Infinite scroll (groups tab) | Yes | No | Legacy uses IntersectionObserver for lazy loading |
| Recently added content section | Yes | No | Legacy has recently-added component |
| Recently viewed section | Yes | Yes (partial) | Legacy has dedicated component; Fractals has "Continue Watching" row in PersonalizedRows |
| Sidebar navigation | Yes | No | Legacy has sidebar with category tree; Fractals uses flat category chips + tabs |
| Breadcrumb navigation | No | Yes | Fractals supports breadcrumb-style navigation from content detail to filtered browse |

## Search

| Feature | Legacy | Fractals | Notes |
|---|---|---|---|
| Basic text search | Yes | Yes | Both support text search |
| FTS5 full-text search | No | Yes | Fractals uses SQLite FTS5 with ranked results |
| Hybrid FTS5 + LIKE search | No | Yes | Fractals combines prefix matching with substring fallback |
| Special character search (`[`, `]`, etc.) | No | Yes | Fractals handles special chars by switching to LIKE-first |
| Diacritic-insensitive search | No | Yes (partial) | Fractals uses `any-ascii` for Latin diacritics; CJK/Arabic not yet handled |
| Semantic/embedding search | No | No | Fractals schema supports it (sqlite-vec), but Phase 8 not started |
| Global cross-source search | Yes (dialog) | Yes (native) | Legacy opens a global search overlay; Fractals search is always cross-source by default |
| Search-as-you-type | Yes | Yes | Both support incremental search |

## Player

| Feature | Legacy | Fractals | Notes |
|---|---|---|---|
| Built-in HTML5 player (HLS.js) | Yes | Yes | Both use HLS.js for stream playback |
| ArtPlayer integration | Yes | Yes | Both use ArtPlayer as primary player |
| Video.js support | Yes | No | Legacy supports Video.js as alternative; Fractals dropped it |
| External player: MPV | Yes | Yes | Both support launching MPV |
| External player: VLC | Yes | Yes | Both support launching VLC |
| MPV path configuration | Yes | Yes | Both allow custom MPV binary path |
| VLC path configuration | Yes | Yes | Both allow custom VLC binary path |
| MPV instance reuse | Yes | No | Legacy can reuse a single MPV process; Fractals spawns new |
| Resume playback prompt | Yes | Yes | Both save position and prompt to resume |
| Playback position saving | Yes | Yes | Both save position to DB periodically |
| Channel surfing (up/down) | Yes | No | Legacy supports channel up/down keys in live TV |
| Stream format selection (HLS/MPEG-TS) | Yes | No | Legacy has stream format dropdown in settings |
| Audio-only detection | No | Yes | Fractals detects audio-only streams and shows appropriate UI |
| OSD for seek/volume | No | Yes | Fractals shows on-screen display for keyboard shortcuts |
| Captions/subtitles toggle | Yes | No | Legacy has "Show Captions" setting |

## EPG (Electronic Program Guide)

| Feature | Legacy | Fractals | Notes |
|---|---|---|---|
| XMLTV EPG parsing | Yes | No | Legacy has full EPG parser in worker thread; Fractals Phase 7 |
| EPG URL configuration | Yes | No | Legacy settings allow multiple EPG source URLs |
| EPG display in player sidebar | Yes | No | Legacy shows EPG data in right drawer during playback |
| Per-channel EPG enrichment | Yes | No | Legacy attaches EPG data to channels (EnrichedChannel pattern) |
| EPG refresh | Yes | No | Legacy has manual EPG refresh button |
| Catchup/timeshift playback | No | No | Neither has implemented catchup yet; Fractals has schema fields for it |

## Content Detail & Metadata

| Feature | Legacy | Fractals | Notes |
|---|---|---|---|
| Content detail panel | Basic | Rich | Legacy shows basic poster + info; Fractals shows TMDB-enriched metadata (plot, cast, director, ratings, genres) |
| TMDB enrichment | Basic (poster preference) | Full | Legacy has "prefer TMDB poster" toggle; Fractals does full TMDB metadata enrichment with title cleaning, multi-candidate matching, and manual search fallback |
| Series season/episode browser | Yes | Yes | Both support series with season/episode navigation |
| On-demand TMDB enrichment | No | Yes | Fractals auto-triggers TMDB enrichment when opening unenriched content |
| "Wrong match?" re-enrichment | No | Yes | Fractals allows re-matching TMDB results for incorrectly matched content |
| Enrichment progress monitoring | No | Yes | Fractals has enrichment tab in settings with progress tracking |

## User Data

| Feature | Legacy | Fractals | Notes |
|---|---|---|---|
| Favorites | Yes | Yes | Both support favorites; legacy has dedicated view, Fractals shows favorite rows in browse |
| Favorites dedicated view | Yes | No | Legacy has a favorites page; Fractals shows favorites as a PersonalizedRows section |
| Favorite channels row | No | Yes | Fractals shows favorite live channels as a scrollable row |
| Watchlist | No | Yes | Fractals has watchlist toggle (separate from favorites) |
| Watch history (recently viewed) | Yes | Yes | Both track watch history |
| Continue Watching row | No | Yes | Fractals shows resumable content in PersonalizedRows |
| User rating | No | Yes (schema) | Fractals has rating field in user_data; UI likely minimal |
| CDK drag-drop favorite reordering | Yes | No | Legacy allows drag-reordering favorites |
| Import/export user data | Yes | No | Legacy has import/export buttons in settings |

## Downloads

| Feature | Legacy | Fractals | Notes |
|---|---|---|---|
| VOD/episode downloading | Yes | No | Legacy has downloads table, download manager component |
| Download queue management | Yes | No | Legacy supports queued/downloading/completed/failed/canceled states |
| Download progress tracking | Yes | No | Legacy tracks bytes downloaded vs total |

## Settings & Customization

| Feature | Legacy | Fractals | Notes |
|---|---|---|---|
| Theme selection | Yes (multiple) | Yes (12 themes) | Legacy has theme enum; Fractals has 12 named themes with dark/light variants |
| Color scheme selection | Yes | No | Legacy has separate color scheme picker |
| Font selection | No | Yes | Fractals offers 7 font choices |
| Language / i18n | Yes (18 languages) | No | Legacy has full i18n with 18 language files; Fractals is English-only |
| Video player selection | Yes | Yes | Both allow choosing between built-in/MPV/VLC |
| Stream format selection | Yes | No | Legacy has HLS/MPEG-TS format option |
| Remote control (phone-as-remote) | Yes | No | Legacy has HTTP server + QR code for remote control from phone |
| Data import/export | Yes | No | Legacy supports importing/exporting all playlists and settings |
| Remove all data | Yes | No | Legacy has "remove all" button |
| App version display | Yes | Yes | Both show version info |

## Platform Support

| Feature | Legacy | Fractals | Notes |
|---|---|---|---|
| macOS (Electron) | Yes | Yes | Both working |
| Windows (Electron) | Yes | Yes | Both working |
| Linux (Electron) | Yes | Yes (build config present) | Legacy has AppImage; Fractals has AppImage config |
| Web/PWA | Yes | No | Legacy has full PWA mode with IndexedDB; Fractals is Electron-only for now |
| Android (Capacitor) | Scaffolded | Not started | Legacy has Capacitor project; Fractals Phase 11 |
| iOS (Capacitor) | Scaffolded | Not started | Legacy has Capacitor project; Fractals Phase 11 |
| TV form factor detection | Yes | Not started | Legacy has FormFactorService with isTV()/isPhone()/isTablet() signals |
| Auto-update | Yes | No | Legacy has Squirrel-based auto-update; Fractals has none |

## Architecture & Code Quality

| Feature | Legacy | Fractals | Notes |
|---|---|---|---|
| Framework | Angular 21 + NgRx | React 19 + Zustand | |
| Build system | Nx monorepo | electron-vite | Fractals is simpler; legacy is full Nx workspace |
| Database ORM | Drizzle + libSQL | Drizzle + better-sqlite3 | Similar approach, Fractals uses synchronous better-sqlite3 |
| Worker threads for heavy ops | Yes (EPG parsing) | Yes (sync + delete) | Both offload work to workers |
| Error boundaries | No | Yes | Fractals has ErrorBoundary component |
| Testing | Jest + Playwright | None (configured for Vitest) | Legacy has tests; Fractals has no tests yet |
| E2E tests | Playwright | None | |

## Features New to Fractals (Not in Legacy)

| Feature | Description |
|---|---|
| Content-first architecture | Sources are invisible; content merges across all sources |
| Multi-source deduplication | Same content from multiple sources stored once with `content_sources` mapping |
| FTS5 + LIKE hybrid search | SQLite full-text search with ranked results and substring fallback |
| TMDB deep enrichment | Full metadata: plot, cast, director, genres, keywords, ratings, runtime |
| On-demand enrichment with manual TMDB search | Auto-enriches when viewing; user can manually search TMDB if auto-match fails |
| Semantic search architecture | Schema and sqlite-vec ready for embedding-based similarity search |
| Source identity colors | Visual color coding per source throughout the UI |
| Source disable toggle | Temporarily hide a source without deleting it |
| Watchlist (separate from favorites) | Bookmark-style "want to watch" list distinct from favorites |
| Continue Watching row | Resume row in browse view based on saved positions |
| Favorite channels row | Quick-access row for favorite live channels |
| 12 color themes + font picker | Extensive theming with named themes and 7 font options |
| Profiles schema | Database schema ready for multi-profile support (kids mode, PINs) |
| Breadcrumb navigation from detail panel | Click genre/type/source in detail panel to jump to filtered browse |
| Layered Escape key handling | Capture-phase Escape that only closes the topmost overlay |

## Priority Missing Features (Legacy Has, Fractals Needs)

These are features that existed in the legacy app and should be considered for implementation in Fractals, roughly ordered by user impact:

1. **M3U/M3U8 playlist support** (Phase 9) -- Many users rely on M3U URLs/files, not just Xtream
2. **EPG / program guide** (Phase 7) -- Critical for live TV users; shows what's on now/next
3. **Internationalization** -- 18 languages in legacy; Fractals is English-only
4. **PWA / web mode** -- Legacy runs in any browser without Electron; Fractals is desktop-only
5. **Content downloads** -- Offline VOD/episode downloading with queue management
6. **Auto-update** -- Users expect silent updates; legacy had Squirrel-based updater
7. **Data import/export** -- Migration path from legacy and backup/restore capability
8. **Remote control** -- Phone-as-remote via HTTP server with QR code pairing
9. **Stream format selection** -- HLS vs MPEG-TS preference matters for some providers
10. **Category hide/show management** -- Declutter by hiding unwanted categories
11. **Stalker portal support** -- Some users have MAC-address-based portals (lower priority if niche)
12. **Channel surfing keys** -- Up/down arrow channel switching during live TV playback
13. **Captions/subtitles toggle** -- Accessibility feature present in legacy settings
14. **Custom User-Agent/Referrer per source** -- Some providers require specific headers
15. **Virtual scroll for massive lists** -- Legacy handled 90k+ channels; Fractals uses pagination instead
