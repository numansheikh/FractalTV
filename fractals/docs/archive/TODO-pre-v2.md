# Fractals — TODO

Priority key: 🔴 High · 🟡 Medium · 🟢 Low · 💡 Idea
Size key: XS (<1h) · S (half-day) · M (1-2 days) · L (3-5 days) · XL (week+)

---

## 1. Known Bugs

| Priority | Size | Item |
|---|---|---|
| 🔴 | S | **FTS fallback covers only `title`** — when the FTS5 MATCH throws (e.g. reserved word query), the LIKE fallback omits plot/cast columns, making cast search silently fail. |
| 🔴 | XS | **`content:get-stream-url` builds series URLs as `movie/`** — series stream type should route through the series episode endpoint, not the VOD endpoint. |
| 🔴 | S | **No ON DELETE CASCADE on content table** — `sources:remove` manually cascades in a transaction, but `content_sources` rows whose `content_id` references a removed source are not cleaned up if the FK isn't present. Needs explicit FK or a migration to add it. |
| 🟡 | XS | **`enriched` flag never reset on re-sync** — if Xtream changes a title, the old TMDB data stays stale because `INSERT OR IGNORE` skips re-enrichment. |
| ~~🟡~~ | ~~S~~ | ~~**No error UI for failed stream URL fetch**~~ — DONE: Player shows error overlay with message. |
| 🟡 | XS | **Source color assignment not stable** — `sourceColors.ts` assigns colors positionally; removing a source shifts all other colors. Should be persisted per source ID. |
| 🟢 | XS | **`findMpv` / `findVlc` always returns the fallback string** — if none of the hardcoded paths exist, the spawn call will throw with a cryptic ENOENT. Should surface a "not found" message. |
| 🟢 | XS | **SettingsDialog player path stored in `localStorage`** — should be stored in the DB via `settings:set` for consistency (and so it survives profile clears). |

---

## 2. Search & Discovery

| Priority | Size | Item |
|---|---|---|
| 🔴 | S | **Prefix search quality** — single-word queries use `"word"* OR word*` which can surface false positives. Tune FTS5 rank weighting and test with real data. |
| 🔴 | M | **TMDB English-title indexing** — after enrichment, index the English `original_title` into `content_fts` so searches for the English name of a foreign-language film find it. |
| 🟡 | S | **Ligature / transliteration stripping** — normalize `ß→ss`, `æ→ae`, `œ→oe` before FTS indexing so European titles match both spellings. (See `todo_search_enrichment.md`.) |
| 🟡 | M | **any-ascii transliteration** — use the `any-ascii` npm package to convert Latin-script approximations of non-Latin scripts (e.g. `"Shahid"` → finds Arabic titles). Index both native and transliterated forms. |
| 🟡 | M | **Genre/cast/director facet filters in UI** — the DB schema supports structured fields; expose them as filter chips below the search bar. |
| 🟡 | S | **Year range filter** — add decade or exact-year filter chip (data already in DB). |
| 🟡 | S | **Rating filter** — filter by minimum TMDB/IMDB rating, shown as a slider or preset chips (7+, 8+, etc.). |
| 🟢 | L | **Semantic / vector search** — `embeddings` table and `sqlite-vec` are already in the schema. Build the `embedding.worker.ts` and wire it into `search:query` as a third-layer fallback. |
| 🟢 | L | **Arabic / Hebrew search** — right-to-left scripts require transliteration or dedicated FTS tokenizer. Marked as future; research `icu` tokenizer for SQLite. |
| 🟢 | L | **Cyrillic / Devanagari search** — same problem as Arabic. Both need either transliteration tables or a Unicode-aware tokenizer. |
| 💡 | M | **Search history + suggestions** — store recent queries, surface them as type-ahead completions before the FTS results appear. |
| 💡 | M | **"Did you mean?" fuzzy suggestion** — when FTS returns zero results, run a Levenshtein check against known titles and suggest the closest match. |

---

## 3. Enrichment

| Priority | Size | Item |
|---|---|---|
| ~~🔴~~ | ~~M~~ | ~~**On-demand enrichment for detail panel**~~ — DONE: Auto-triggers on panel open + manual search with choosable results + re-match for wrong matches. |
| 🔴 | M | **Batch enrichment on browse scroll** — when unenriched items are visible in the grid, enrich them in a background micro-batch (5-10 items) with no user action required. |
| 🟡 | S | **Backfill `enriched = 1` for items that already have `tmdb_id`** — a one-time migration to mark any row with a `tmdb_id` as enriched so the status counter is accurate. |
| 🟡 | M | **Background auto-enrichment after sync** — after a successful source sync, quietly start enriching unenriched items without requiring the user to open Settings. Show ambient progress (small pill in header). |
| 🟡 | S | **Enrichment rate-limit display** — TMDB allows 40 req/s. Show current throughput in the Enrichment settings tab so users can see it isn't stuck. |
| 🟡 | M | **Episode enrichment** — currently only movies and series shells are enriched. Fetch episode-level metadata (title, description, still image, air date) from TMDB `tv/seasons` endpoint. |
| 🟢 | M | **IMDB rating sync** — TMDB detail responses include `imdb_id`; use it to populate `rating_imdb`. No extra API key needed. |
| 🟢 | L | **Embedding generation worker** — `embedding.worker.ts` is planned but not built. Use `@xenova/transformers` in a Node worker thread to generate 384-dim vectors from enriched text and store in `embeddings`. |
| 💡 | S | **Per-item enrichment retry** — mark failed enrichments with a `enrich_error` column so they can be retried selectively without re-running the whole batch. |

---

## 4. Player

| Priority | Size | Item |
|---|---|---|
| ~~🔴~~ | ~~M~~ | ~~**Save/resume position**~~ — DONE: Saves every 10s + on pause + on unmount. |
| ~~🔴~~ | ~~M~~ | ~~**Resume from saved position**~~ — DONE: "Resume from X:XX?" prompt with auto-resume after 5s. |
| 🟡 | L | **EPG overlay for live TV** — fetch EPG for the current channel; show a slim banner at the bottom of the player with current program title, time remaining, and next program. |
| 🟡 | M | **Channel surfing (↑ / ↓)** — while a live channel is playing, pressing ↑/↓ should switch to the previous/next channel in the current category, with a brief on-screen indicator. |
| 🟡 | M | **Catchup / timeshift** — `buildCatchupUrl` is already implemented in the service. Build the EPG past-program UI and wire it to the timeshift URL for channels where `catchup_supported = 1`. |
| ~~🟡~~ | ~~S~~ | ~~**Keyboard controls in ArtPlayer**~~ — DONE: Space, F, M, arrows, multi-press seek, D for debug. |
| 🟢 | M | **Picture-in-picture** — use the browser `requestPictureInPicture()` API in ArtPlayer for Electron; allows browsing while watching. |
| 🟢 | S | **Volume memory** — persist last volume level to `localStorage` so it survives app restarts. |
| 🟢 | M | **Subtitle support** — for VoD streams, check if the Xtream API returns subtitle URLs and pass them to ArtPlayer's track list. |
| 💡 | M | **In-app MPV/VLC process monitoring** — detect when the external player process exits and optionally save the last known position (via MPV's `--save-position-on-quit`). |

---

## 5. Browse & UI

| Priority | Size | Item |
|---|---|---|
| ~~🔴~~ | ~~M~~ | ~~**"Continue Watching" row**~~ — DONE: PersonalizedRows component at top of browse view. |
| ~~🟡~~ | ~~M~~ | ~~**Favorites row / page**~~ — DONE: Favorite Channels row + card hover toggle. |
| ~~🟡~~ | ~~M~~ | ~~**Watchlist row / page**~~ — DONE: Watchlist toggle on cards + detail panel. Library tab pending. |
| 🟡 | M | **Recently Added row** — ORDER BY `created_at DESC` for each type; shows new content after a sync. |
| 🟡 | S | **Poster aspect ratio standardization** — mixed portrait/landscape poster URLs from Xtream look broken in a uniform grid. Detect and letterbox non-standard ratios. |
| 🟡 | S | **Empty-state illustrations** — when a category is empty or no sources are added, show a helpful empty state with a CTA instead of a blank area. |
| 🟢 | M | **Category pinning** — let users pin frequently visited categories to the top of the nav sidebar. |
| 🟢 | M | **List view toggle** — offer a dense list view (title + metadata row) as an alternative to the poster grid for users who prefer scanning text. |
| 🟢 | S | **Batch select + play queue** — select multiple items to add to a sequential play queue. |
| 💡 | M | **Smooth search↔browse morphing** — Framer Motion layout animations to make the transition between browse rows and search results feel fluid. |

---

## 6. Sources & Sync

| Priority | Size | Item |
|---|---|---|
| 🔴 | L | **M3U support** — parse `.m3u` / `.m3u8` playlist files (local or URL). Map `#EXTINF` tags to the content schema. No authentication model, just URL + refresh interval. |
| 🔴 | S | **Sync progress indicator in header** — the `sync:progress` events are tracked in the store but there's no persistent ambient progress bar in the header; it only shows in the source list. |
| 🟡 | S | **Per-source health badge** — show last-sync time + item count next to each source in the sidebar, not just in Settings. |
| 🟡 | M | **Scheduled / background sync** — auto-re-sync sources on a user-configured interval (e.g., every 6h). Use Electron's `setInterval` or a persistent background job. |
| 🟡 | M | **Incremental sync** — instead of full re-fetch, use Xtream's `added` timestamp field to only pull streams modified since last sync. Dramatically reduces sync time for large providers. |
| 🟡 | S | **Sync conflict resolution** — when a stream_id disappears from the provider (content removed), mark it as `unavailable` rather than hard-deleting, so watch history is preserved. |
| 🟢 | M | **Multi-account same provider** — support adding multiple accounts on the same Xtream server, deduplicating content while tracking which account has access to which stream. |
| 💡 | M | **Source import/export** — export source list (minus passwords) to a JSON file for backup or sharing between devices. |

---

## 7. Settings

| Priority | Size | Item |
|---|---|---|
| 🟡 | S | **Player path persistence** — move MPV/VLC custom paths from `localStorage` to DB settings (via `settings:set` / `settings:get`) so they survive browser storage clears. |
| 🟡 | S | **Auto-enrich toggle** — let users opt in/out of automatic background enrichment after sync (default: on, but require TMDB key). |
| 🟡 | M | **Enrichment batch size / speed control** — expose a slider for TMDB request rate (1–40 req/s) in case the user wants to avoid rate-limit errors. |
| 🟡 | M | **Profile management UI** — the `profiles` table is in the schema; build a settings tab to create/switch/delete profiles with optional PINs. |
| 🟢 | S | **Keyboard shortcut reference** — add a "Shortcuts" info section in Settings listing all keyboard shortcuts. |
| 🟢 | M | **Import/export settings** — allow exporting all settings (TMDB key, player pref, themes) as a JSON blob for easy migration. |
| 🟢 | S | **DB location disclosure** — the Info tab already shows the path; add a "Reveal in Finder" / "Open in Explorer" button. |

---

## 8. Performance

| Priority | Size | Item |
|---|---|---|
| 🔴 | L | **Virtual scrolling for large grids** — with 10,000+ content items, DOM rendering becomes slow. Implement windowed rendering (e.g., `@tanstack/react-virtual`) for the poster grid and category list. |
| 🟡 | M | **Image lazy loading with intersection observer** — poster images should only load when they enter the viewport. The native `loading="lazy"` attribute alone is insufficient for scroll containers. |
| 🟡 | M | **DB index audit** — profile slow queries with `EXPLAIN QUERY PLAN`. Add missing indexes on `content(type, updated_at)`, `content(category_id, primary_source_id)`, etc. |
| 🟡 | S | **Count query optimization** — `content:browse` runs a separate COUNT(*) query for pagination. Consider using SQLite's `SELECT … OVER ()` window function or caching total counts. |
| 🟢 | M | **Poster image caching** — cache resized poster thumbnails to disk (Electron `userData`) so they don't re-download on every launch. |
| 🟢 | M | **Query result memoization** — TanStack Query is in place; audit `staleTime` values to avoid redundant IPC calls on tab switches. |
| 💡 | L | **Background DB compaction** — run `VACUUM` and `ANALYZE` on the SQLite file periodically (e.g., after a sync) to reclaim space and refresh statistics. |

---

## 9. Platform

| Priority | Size | Item |
|---|---|---|
| 🟡 | XL | **Capacitor Android build** — scaffold Capacitor project, swap Electron IPC for `CapacitorService` implementation, test on Android phone/tablet/TV. |
| 🟡 | L | **Android TV D-pad navigation** — full keyboard navigation with focus rings, no hover states, channel-surfing via remote. |
| 🟢 | XL | **iOS / iPadOS Capacitor build** — same as Android but through Xcode. Touch-optimized tap targets. |
| 🟢 | XL | **Tizen packaging** — wrap the web build as a `.wgt` app for Samsung Smart TV. Test with Tizen Emulator. |
| 🟢 | M | **TV mode scale** — the CLAUDE.md spec calls for 1.5× spacing + text in TV mode. Implement a `tv-mode` CSS class triggered by UA detection or explicit user setting. |
| 🟢 | M | **PWA manifest + service worker** — ship a `manifest.webmanifest` and a Workbox service worker so the web build is installable and works partially offline. |
| 💡 | L | **Windows / Linux Electron packaging** — CI builds for Windows (NSIS installer) and Linux (AppImage/deb) via `electron-builder`. macOS DMG already configured. |

---

## 10. Wild Imagination

_Blue-sky ideas — no commitment, just capturing the vision._

| Priority | Size | Item |
|---|---|---|
| 💡 | XL | **AI-powered "Watch This Next" recommendations** — use the embeddings to find content similar to what the user has watched most, surface as a personalized row. No cloud required. |
| 💡 | XL | **Smart playlists** — user-defined rules like "Movies I haven't seen, rated 8+, genre Thriller, year > 2010". Auto-updates as new content is synced. |
| 💡 | L | **Episode / series progress tracking** — track which episodes are watched per series, show a progress bar on the series card, resume from the next unwatched episode. |
| 💡 | L | **Trakt.tv integration** — two-way sync of watch history and ratings with Trakt. Import watched history from Trakt to pre-populate `user_data`. |
| 💡 | L | **Letterboxd integration** — import watchlist + ratings from Letterboxd to seed favorites and watchlist. |
| 💡 | L | **Voice search** — use the Web Speech API (available in Electron Chromium) to transcribe voice input into the search bar. |
| 💡 | L | **Automatic subtitle fetching** — for enriched VoD items, query OpenSubtitles API by IMDB ID and auto-download SRT files to a local cache. |
| 💡 | M | **Stream quality auto-switching** — if buffering is detected in ArtPlayer, automatically switch to a lower-bitrate source from `content_sources`. |
| 💡 | L | **"Watch with friends" sync** — lightweight relay server (or WebRTC) to synchronize playback position between two instances. Minimal — just position sync + emoji reactions. |
| 💡 | M | **Parental controls with PIN** — profiles marked `is_child = 1` hide content above a configurable rating threshold. PIN-protect the profile switch. |
| 💡 | L | **Custom metadata overrides** — let users manually correct a TMDB match (e.g., a misidentified foreign film) and pin the correct TMDB ID to that content item. |
| 💡 | M | **Playback statistics dashboard** — total hours watched, most-watched genres, watch streaks, etc. All computed from local `user_data` — no cloud. |
