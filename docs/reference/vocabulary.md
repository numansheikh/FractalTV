# Vocabulary & Taxonomy

_Locked and open UI/UX/code terminology for Fractals. Gold standard for copy audits (see BACKLOG §3 #7)._

## App Shell

| Term | Code | Name |
|------|------|------|
| Left icon strip | `NavRail` | **Left Sidebar** |
| Main destination icons | `activeView` values | **Pages** |
| Utility icons (Sources, Settings) | — | **Tools** |
| Top bar with search/sort/filters | `CommandBar` | **CommandBar** |

## Pages

| Code | Name |
|------|------|
| `home` | **Home** |
| `live` | **Channels** |
| `films` | **Films** |
| `series` | **Series** |
| `library` | **Library** |

## Home

| Thing | Name |
|-------|------|
| Content strips mode | **Discover** |
| Favorites channels grid mode | **TV** (also: "TV mode" / "TV view" depending on context) |
| Search results | Renders in Discover layout — not a separate mode. Just **Search**. |
| Typing from TV mode | Switches to Discover layout, results appear as Discover-style cards |

## Commons (shared across Channel / Movie / Series Browsers)

| Term | Code | Name |
|------|------|------|
| Shared browsing screen pattern | `BrowseView` | **Browser** |
| Left category list | `BrowseSidebar` | **Category List** |
| Slide-in metadata panel | `MovieDetail` / `SeriesDetail` | **Detail Panel** |
| Fullscreen video | `PlayerOverlay` fullscreen | **Player** |
| Minimised video | `PlayerOverlay` mini | **Mini Player** |
| Player controls (play/pause/seek) | inside `PlayerOverlay` | **Controls** |
| Category chip in player | inside `PlayerOverlay` | **Category Chip** — must appear for all three content types |
| Provider-supplied groupings | `categories` / M3U groups | **Category** (unified, regardless of source type) |

## Channel Browser

| Term | Code | Name |
|------|------|------|
| Channel browsing screen | `BrowseView` type=live | **Channel Browser** |
| Layout mode 1 — default | `ChannelGroupView` | **Group View** — **deprecation candidate (2026-04-14)**; no canonical layer in g1c, nothing to group by |
| Layout mode 2 | `ChannelGrid` | **Grid View** |
| Layout mode 3 | `BrowseViewH` | **List View** |
| Group View and Grid/List View | — | Grid + List show flat Channel Cards only, no canonical grouping |
| A row in Group View | `ChannelGroup` | **Channel Group** (tied to Group View — deprecates with it) |
| Left info section in a Channel Group | `InfoPanel` | **Channel Canonical Info** (tied to Group View — deprecates with it) |
| Individual playable stream card (Channel Browser grid) | `ChannelCard` | **Channel Card** |
| Row in Channel Browser List View | `ChannelListCard` (in `VirtualGrid.tsx`) | **Channel List Card** |
| Channel + player side by side | `LiveView` | **Live View** |
| Row in Live View left-column channel list | `LiveChannelListCard` (in `LiveView.tsx`) | **Live Channel List Card** |
| EPG strip at bottom of Live View | inline in `LiveView` | **EPG Panel** |
| Full EPG popout | `EpgGuide` | **EPG Guide** |
| Inline program detail inside EPG Guide | inside `EpgGuide` | **Program Detail** (distinct from the slide-in **Detail Panel**) |
| Live catchup scrubber | `TimeshiftBar` | **Timeshift Bar** |
| Now/Next info overlay in Player | inside `PlayerOverlay` | **Now/Next** — auto-hides with Controls |
| Channel detail slide-in | `ChannelDetail` | **Channel Detail Panel** — logo/title, ActionButtons, **Schedule** section (EPG: 3 past dimmed + on-now highlighted with progress + 10 upcoming, gated on `epg_channel_id`), EPG identity rows |

## Movie Browser

| Term | Code | Name |
|------|------|------|
| Movie browsing screen | `BrowseView` type=movie | **Movie Browser** |
| Layout mode | `PosterGrid` | **Grid View** |
| Movie detail slide-in | `MovieDetail` | **Detail Panel** |

## Series Browser

| Term | Code | Name |
|------|------|------|
| Series browsing screen | `BrowseView` type=series | **Series Browser** |
| Layout mode | `PosterGrid` | **Grid View** |
| Series detail slide-in | `SeriesDetail` | **Detail Panel** |
| Season coin selector | inside `SeriesDetail` | **Season Selector** — fluid/wrap, not scrolling |
| Episode rows | `EpisodeRow` list | **Episode List** |
| Episode nav in fullscreen player | `PlayerOverlay` pills | **Episode Surf** — Prev/Next pills, bounded (no wrap), PgUp/PgDn + Cmd+↑/↓ |
| Embedded video in detail panel | `PlayerOverlay` embedded mode | **Embedded Player** — overlays anchor div in detail panel, episode click loads here (not fullscreen) |

## Library

| Term | Code | Name |
|------|------|------|
| Library page | `LibraryView` | **Library** |
| Saved content | `is_favorite` | **Favorites** (US spelling throughout) |
| Watch later list | `is_watchlisted` | **Watchlist** |
| Viewing log | history query | **Watch History** |
| Resume list | `continue_watching` | **Continue Watching** |
| Star rating | `rating` in DB | **Star Rating** |

## Sources & Settings

| Term | Code | Name |
|------|------|------|
| Sources tool panel | `SourcesPanel` | **Sources** |
| Individual source entry | `SourceCard` | **Source Card** |
| Add source flow | `AddSourceForm` | **Add Source** |
| Sync progress indicator | inline | **Sync Progress** |
| Settings tool panel | `SettingsPanel` | **Settings** |
| Appearance section | — | **Appearance** |
| Data section | — | **Data** |
| Player section | — | **Player** |

## Data Concepts (g1c — per-type split)

Provider data lives in per-type tables; there is no canonical/dedup layer in g1c.

| Term | Layer | Name |
|------|-------|------|
| Live content table | `channels` | **Channel** (user-facing), `channels` (DB) |
| VOD content table | `movies` | **Movie** / **Film** (user-facing), `movies` (DB) |
| Series parent table | `series` | **Series** |
| Series child table | `episodes` | **Episode** — sub-part of a series, lazy-fetched from provider on first detail open |
| Per-type user data | `channel_user_data`, `movie_user_data`, `series_user_data`, `episode_user_data` | **User Data** (per content type) |
| Provider groupings | `channel_categories`, `movie_categories`, `series_categories` | **Category** (unified term across types) |
| TS type for any playable item | `ContentItem` | **ContentItem** in code |
| User-facing single item | — | **Title** |
| Source-scoped content ID | `{sourceId}:{type}:{streamId}` | — |
| Normalized search column | `search_title` | populated inline at sync INSERT; any-ascii + lowercase |
| Xtream upstream stream ID | `stream_id` (DB) / `streamId` (TS) / `_streamId` (runtime) | **Keep as-is** — legitimate Xtream API vocabulary, do not rename to "content_id" |

### Prefix-drop convention (DB → store)

User-data booleans carry an `is_` prefix in the DB but drop it in the Zustand store for ergonomics:

| DB column | Store field |
|-----------|-------------|
| `is_favorite` | `favorite` |
| `is_watchlisted` | `watchlist` |
| `is_completed` | `completed` |

The prefix is only stripped when crossing the IPC boundary into the renderer store. Backend code, SQL, and IPC payloads use the `is_` form. Keep this mapping consistent when adding new boolean user-data columns.

### Removed / superseded (historical)

- `streams` table — replaced by per-type `channels` / `movies` / `series` in g1c. Any lingering mention in docs/comments is stale.
- `canonical_channels` table — never built on g1c. No canonical identity layer.
- `*_fts` virtual tables — FTS5 was tried at IPTV catalog scale and rejected; LIKE on `search_title` wins.

## Spelling
- **US English** throughout — "Favorites" not "Favourites", "Color" not "Colour" etc.
- British spelling may exist in older code/comments — fix in a polish sprint
