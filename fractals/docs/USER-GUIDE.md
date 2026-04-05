# Fractals User Guide

## Getting Started

### Adding Your First Source

1. Launch Fractals. On first run you'll see an empty browse view with an "Add Source" button.
2. Click **Add Source** or open **Settings** (gear icon / `Cmd+,`) > Sources.
3. Enter your Xtream Codes credentials:
   - **Name** — a label for this source (e.g. "My IPTV")
   - **Server URL** — the Xtream server URL (e.g. `http://example.com:8080`)
   - **Username** and **Password**
4. Click **Test Connection** to verify credentials before saving.
5. Click **Add** — the app will sync all content (live channels, movies, series) in the background.
6. Sync progress appears next to the source name in the sidebar. You can browse while syncing.

### Adding Multiple Sources

Add as many Xtream accounts as you want. Content from all sources appears in one unified library. Each source gets a distinct color dot on cards for identification.

### TMDB Enrichment

To get posters, ratings, plots, and cast information:

1. Open **Settings** > **Enrichment** tab.
2. Enter your TMDB API key (get one free at themoviedb.org).
3. Click **Start Enrichment** — metadata is fetched in the background.
4. Content also enriches on-demand when you open a detail panel.

---

## Browsing Content

### Type Tabs

Use the tabs at the top to filter by content type:
- **All** — everything
- **Live TV** — live channels
- **Movies** — VOD movies
- **Series** — TV series

### Categories

The left sidebar shows categories from your sources. Click a category to filter. Use the search box above categories to find specific ones.

### Source Filtering

The source bar below the type tabs shows colored dots for each source. Click a dot to filter content to that source only.

### Sorting

Use the sort dropdown (top-right of content area) to sort by:
- Latest added
- Title A-Z / Z-A
- Year (newest/oldest)
- Top rated

### Personalized Rows

When browsing without a category filter, you'll see rows at the top:
- **Continue Watching** — movies you started but didn't finish (with progress bars)
- **Favorite Channels** — live channels you've hearted
- **Recently Watched** — your last 20 watched items

---

## Searching

### Basic Search

Click the search bar or press `/` or `Cmd+K` to focus it. Start typing to search across all content — titles, plots, cast, directors, and genres.

Results are grouped by type (Live / Movies / Series) with "Load More" buttons for each section.

### Search Tips

- **Prefix matching** — typing "dark" finds "The Dark Knight", "Darkest Hour", etc.
- **Substring matching** — partial words work too ("dar" finds "undark")
- **Special characters** — brackets `[]`, parentheses `()`, dashes `-`, underscores `_` are supported as search characters
- **Diacritics** — accented characters are transliterated (searching "Borgen" finds "Borgen")
- **Trailing space** — adding a space after a word forces an exact word match

### Clearing Search

Press `Escape` or clear the search bar to return to browse mode.

---

## Content Details

### Movies

Click a movie card to open the detail panel (slides in from the right). You'll see:
- Hero image (backdrop or poster)
- Title, year, runtime, rating
- Breadcrumbs (Source > Type > Category)
- Play button
- Favorite (heart) and Watchlist (bookmark) toggles
- Genre tags
- Plot overview
- Director and cast
- Your star rating (1-5 stars)
- "Wrong match? Search TMDB manually" link (if enriched)

### Series

Click a series card to open a double-width panel:
- **Right column** — same metadata layout as movies
- **Left column** — season selector (numbered coins) + episode list
- Click an episode to play it. The panel stays open behind the player so you can pick the next episode.

### Live Channels

Clicking a live channel starts playback immediately (no detail panel).

### Quick Actions (Card Hover)

Hover over any card to see action buttons:
- **Heart** — toggle favorite
- **Bookmark** — toggle watchlist (movies/series only)

These update instantly and persist across sessions.

---

## Video Player

### Controls

- **Space** — play/pause
- **F** — toggle fullscreen
- **M** — mute/unmute
- **Left/Right arrows** — seek (5s / 10s / 25s with repeated presses)
- **Up/Down arrows** — volume
- **Escape** — close player
- **D** — toggle debug panel

### Resume Playback

When you reopen a movie you previously watched, a prompt appears:
> "Resume from X:XX?"

- Click **Resume** to continue from where you left off
- Click **Start Over** to restart
- If you don't interact, it auto-resumes after 5 seconds

### Completion

When you reach 92% of a movie (or it ends), it's automatically marked as completed. The progress bar disappears from the card, and a green checkmark appears.

### External Players

In Settings > Player, you can choose MPV or VLC instead of the built-in player. Set custom paths if needed.

---

## Settings

Open with the gear icon or `Cmd+,`.

### Sources Tab
- View all connected sources with sync status
- **Sync** — re-fetch content from source
- **Disable** — temporarily hide a source's content without deleting
- **Delete** — remove source and all its unique content
- **Edit** — modify credentials or name

### Appearance Tab
- Theme selection
- Font preferences

### Player Tab
- Choose between ArtPlayer (built-in), MPV, or VLC
- Set custom paths for external players

### Enrichment Tab
- Enter/update TMDB API key
- View enrichment status (total / enriched / pending)
- Start batch enrichment

### Info Tab
- App version and system information
- DevTools toggle

---

## Tips & Tricks

1. **Breadcrumb navigation** — click any segment in the breadcrumb trail (Source name, Type, Category) to jump directly to that filtered view.

2. **Layout toggle** — use the layout button in the header to switch between horizontal and vertical browse layouts.

3. **Source colors** — each source has a unique color. The small dot on card corners tells you which source provides that content.

4. **On-demand enrichment** — if a movie/series has no metadata, opening its detail panel automatically triggers a TMDB lookup. If it picks the wrong match, use "Wrong match? Search TMDB manually" to fix it.

5. **Star ratings** — click a star to rate, click the same star again to clear your rating.

6. **Series episodes** — the panel stays open when you play an episode, so you can easily pick the next one when the player closes.
