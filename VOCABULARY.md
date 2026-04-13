# Fractals — Vocabulary & Taxonomy

Locked naming conventions for UI, code, and data concepts.
US English throughout ("Favorites" not "Favourites").

---

## App Shell

| Name | Code | Description |
|------|------|-------------|
| **Left Sidebar** | `NavRail` | Left vertical icon strip |
| **Pages** | `activeView` values | Main destination icons on the Left Sidebar |
| **Tools** | — | Utility icons on the Left Sidebar (Sources, Settings) |
| **CommandBar** | `CommandBar` | Top bar with search, sort, filters |

## Pages

| Name | Code |
|------|------|
| **Home** | `home` |
| **Channels** | `live` |
| **Films** | `films` |
| **Series** | `series` |
| **Library** | `library` |

## Home

| Name | Description |
|------|-------------|
| **Discover** | Home mode showing content strips |
| **TV** | Home mode showing favorites channels grid (drag-to-reorder). Also: "TV mode" / "TV view" |
| **Search** | Not a separate mode — renders in Discover layout. Typing from TV mode switches to Discover. |

## Commons (shared across Channel / Movie / Series Browsers)

| Name | Code | Description |
|------|------|-------------|
| **Browser** | `BrowseView` | Shared browsing screen pattern (Channel Browser / Movie Browser / Series Browser) |
| **Category List** | `BrowseSidebar` | Left category list within a Browser |
| **Detail Panel** | `MovieDetail` / `SeriesDetail` | Slide-in metadata panel |
| **Player** | `PlayerOverlay` fullscreen | Fullscreen video player |
| **Mini Player** | `PlayerOverlay` mini | Minimised persistent video |
| **Controls** | inside `PlayerOverlay` | Play/pause/seek/volume controls overlay |
| **Category Chip** | inside `PlayerOverlay` | Navigates back to category — present for all three content types |
| **Category** | `categories` / M3U groups | Provider-supplied groupings — unified term regardless of source type |

## Channel Browser

| Name | Code | Description |
|------|------|-------------|
| **Channel Browser** | `BrowseView` type=live | Channel browsing screen |
| **Group View** | `ChannelGroupView` | Default layout — channels grouped by canonical identity |
| **Grid View** | `ChannelGrid` | Flat channel card grid |
| **List View** | `BrowseViewH` | Compact channel card list |
| **Channel Group** | `ChannelGroup` | A single row in Group View representing one real-world channel |
| **Channel Canonical Info** | `InfoPanel` | Left info section within a Channel Group (title, flag, network) |
| **Channel Card** | `StreamCard` / `ChannelCard` | Individual playable stream entry — used in all three layout modes |
| **Live View** | `LiveSplitView` | Channel list + player side by side |
| **Channel List** | — | Channel list within Live View |
| **EPG Panel** | inline in `LiveSplitView` | EPG strip at bottom of Live View |
| **EPG Guide** | `EpgGuide` | Full EPG popout |
| **Timeshift Bar** | `TimeshiftBar` | Live catchup scrubber |
| **Now/Next** | inside `PlayerOverlay` | Now/next programme overlay in Player (live only) — auto-hides with Controls |
| **Channel Detail Panel** | not built | Slide-in channel detail panel (planned) |

> Grid View and List View show flat Channel Cards only — no canonical grouping.

## Movie Browser

| Name | Code | Description |
|------|------|-------------|
| **Movie Browser** | `BrowseView` type=movie | Movie browsing screen |
| **Grid View** | `PosterGrid` | Poster grid layout |
| **Detail Panel** | `MovieDetail` | Slide-in movie metadata |

## Series Browser

| Name | Code | Description |
|------|------|-------------|
| **Series Browser** | `BrowseView` type=series | Series browsing screen |
| **Grid View** | `PosterGrid` | Poster grid layout |
| **Detail Panel** | `SeriesDetail` | Slide-in series metadata |
| **Season Selector** | inside `SeriesDetail` | Season picker — fluid wrap, not scrolling |
| **Episode List** | `EpisodeRow` list | Episode rows within Detail Panel |

## Library

| Name | Code | Description |
|------|------|-------------|
| **Library** | `LibraryView` | Personal collection page |
| **Favorites** | `is_favorite` | Saved content |
| **Watchlist** | `is_watchlisted` | Watch later list |
| **Watch History** | history query | Viewing log |
| **Continue Watching** | `continue_watching` | Resume list |
| **Star Rating** | `rating` in DB | User star rating |

## Sources & Settings

| Name | Code | Description |
|------|------|-------------|
| **Sources** | `SourcesPanel` | Sources tool panel |
| **Source Card** | `SourceCard` | Individual source entry |
| **Add Source** | `AddSourceForm` | Add source flow |
| **Sync Progress** | inline | Sync progress indicator |
| **Settings** | `SettingsPanel` | Settings tool panel |
| **Appearance** | — | Appearance settings section |
| **Data** | — | Data settings section |
| **Player** | — | Player settings section |

## Data Concepts

| Name | Layer | Description |
|------|-------|-------------|
| `streams` | DB table | Keep as-is — internal, never user-facing |
| `ContentItem` | TS type | Code-layer type for all content entries |
| **Title** | User-facing | A single item of content (any type) |
| **Channel** | User-facing | A real-world channel identity (canonical layer — internal term: `canonical_channel`) |
| **Channel Card** | UI | A single playable live stream entry |
| **Source** | All layers | An Xtream account or M3U URL added by the user |
</content>
