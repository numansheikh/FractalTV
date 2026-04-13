# Vocabulary & Taxonomy

Locked UI/UX/code terminology. US English throughout — "Favorites" not "Favourites", "Color" not "Colour". British spelling in older code/comments will be cleaned up in a polish sprint.

## Content type & titles

- **Content type** — Live, Movie, Series. DB: `type IN ('live', 'movie', 'series')`. Radio = Live variant.
- **Title** — a single item in user-facing UI ("3,200 titles", "No titles found"). TypeScript type stays `ContentItem` in code.
- **Category** — Xtream provider categories only (e.g. "Action", "Sports"). Never used for content type.

Content type colors (locked 2026-04-09):

| Type | Dark bg | Light bg | Notes |
|------|---------|----------|-------|
| Live | `#ff3355` | `#ee0033` | Also newer `#f43f5e` (rose-500) in contrast-revised set |
| Film / Movie | `#3399ff` | `#0066ff` | Newer `#60a5fa` (blue-400) |
| Series | `#00dd77` | `#00cc66` | Newer `#34d399` (emerald-400) |
| Interactive / brand | `#7733ff` | `#7733ff` | Newer `#8b5cf6` (violet-500) — NOT blue |

CSS vars: `--accent-live`, `--accent-film`, `--accent-series`, `--accent-interactive`.

## App shell

| Term | Code | Name |
|------|------|------|
| Left icon strip | `NavRail` | **Left Sidebar** |
| Main destination icons | `activeView` values | **Pages** |
| Utility icons (Sources, Settings) | — | **Tools** |
| Top bar with search/sort/filters | `CommandBar` | **CommandBar** |

## Pages

| Code | Name |
|------|------|
| `home` | Home |
| `live` | Channels |
| `films` | Films |
| `series` | Series |
| `library` | Library |

## Home

| Thing | Name |
|-------|------|
| Content strips mode | **Discover** |
| Favorites channels grid mode | **TV** (also "TV mode" / "TV view") |
| Search results | Renders in Discover layout — not a separate mode. Just "Search". |
| Typing from TV mode | Switches to Discover layout; results appear as Discover-style cards |

## Commons (shared across Channel / Movie / Series Browsers)

| Term | Code | Name |
|------|------|------|
| Shared browsing screen pattern | `BrowseView` | **Browser** |
| Left category list | `BrowseSidebar` | **Category List** |
| Slide-in metadata panel | `MovieDetail` / `SeriesDetail` | **Detail Panel** |
| Fullscreen video | `PlayerOverlay` fullscreen | **Player** |
| Minimised video | `PlayerOverlay` mini | **Mini Player** |
| Player controls | inside `PlayerOverlay` | **Controls** |
| Category chip in player | inside `PlayerOverlay` | **Category Chip** — appears for all three types |
| Provider-supplied groupings | `categories` / M3U groups | **Category** (unified) |

## Channel Browser

| Term | Code | Name |
|------|------|------|
| Channel browsing screen | `BrowseView` type=live | **Channel Browser** |
| Layout mode 1 — default | `ChannelGroupView` | **Group View** (hidden as of 2026-04-14) |
| Layout mode 2 | `ChannelGrid` | **Grid View** |
| Layout mode 3 | `BrowseViewH` | **List View** |
| Grid + List | — | Flat Channel Cards only, no canonical grouping |
| A row in Group View | `ChannelGroup` | **Channel Group** |
| Left info section in a Channel Group | `InfoPanel` | **Channel Canonical Info** |
| Playable stream card | `StreamCard` / `ChannelCard` | **Channel Card** |
| Channel + player side by side | `LiveSplitView` | **Live View** |
| Channel list within Live View | — | **Channel List** |
| EPG strip at bottom of Live View | inline in `LiveSplitView` | **EPG Panel** |
| Full EPG popout | `EpgGuide` | **EPG Guide** |
| Live catchup scrubber | `TimeshiftBar` | **Timeshift Bar** |
| Now/Next overlay in Player | inside `PlayerOverlay` | **Now/Next** (auto-hides with Controls) |
| Channel detail slide-in | (not built) | **Channel Detail Panel** |

## Movie / Series Browsers

| Term | Code | Name |
|------|------|------|
| Movie browsing screen | `BrowseView` type=movie | **Movie Browser** |
| Series browsing screen | `BrowseView` type=series | **Series Browser** |
| Layout mode | `PosterGrid` | **Grid View** |
| Movie detail slide-in | `MovieDetail` | **Detail Panel** |
| Series detail slide-in | `SeriesDetail` | **Detail Panel** |
| Season coin selector | inside `SeriesDetail` | **Season Selector** (fluid/wrap, not scrolling) |
| Episode rows | `EpisodeRow` list | **Episode List** |

## Library

| Term | Code | Name |
|------|------|------|
| Library page | `LibraryView` | **Library** |
| Saved content | `is_favorite` | **Favorites** |
| Watch later | `is_watchlisted` | **Watchlist** |
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

Settings sections: **Appearance**, **Data**, **Player**.

## Data concepts

| Term | Layer | Name |
|------|-------|------|
| DB table | `streams` | Keep as `streams` — internal, never user-facing |
| TS type | `ContentItem` | `ContentItem` in code |
| User-facing single item | — | **Title** |
| Real-world channel identity | `canonical_channels` | Internal only — users see **Channel** |
| Playable live entry | `Stream` type=live | **Channel Card** in UI; `stream` in DB/code |
| Provider groupings | `categories` / M3U groups | **Category** (unified) |

## Project name

- Project is **"Fractals"** or **"FractalTV"**. Never "FractalTV-M".
