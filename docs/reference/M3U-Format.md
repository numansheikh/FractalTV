# M3U Playlist Format — Reference

M3U is a plain-text playlist format. No API, no authentication — just a file (local or remote URL) listing streams with metadata in `#EXTINF` directives.

---

## 1. File Structure

```
#EXTM3U [header-attributes]
#EXTINF:duration [attributes],Title
stream-url
#EXTINF:duration [attributes],Title
stream-url
...
```

- File starts with `#EXTM3U` (optional header attributes on the same line)
- Each entry is two lines: `#EXTINF` metadata + stream URL
- Lines starting with `#` (other than `#EXTINF` / `#EXTM3U`) are directives or comments
- Encoding: UTF-8 (no BOM)

---

## 2. Header Line (`#EXTM3U`)

The first line can carry playlist-level attributes:

| Attribute | Purpose | Example |
|-----------|---------|---------|
| `url-tvg` | EPG (XMLTV) guide URL | `url-tvg="https://epg.example.com/guide.xml"` |
| `x-tvg-url` | Alternative EPG URL key (same purpose) | `x-tvg-url="https://epg.example.com/guide.xml"` |

Multiple EPG URLs can be comma-separated in the value.

**Example:**
```
#EXTM3U x-tvg-url="https://xmltv.example.net/guide.xml"
```

---

## 3. Entry Format (`#EXTINF`)

```
#EXTINF:duration attr1="val1" attr2="val2" ...,Title
http://example.com/stream.m3u8
```

### Duration field
- First token after `#EXTINF:` is duration in seconds
- `-1` = live stream / unknown duration
- `0` = unknown (common in movie playlists)
- Positive integer = content duration in seconds

### Standard attributes

| Attribute | Type | Purpose | Example |
|-----------|------|---------|---------|
| `tvg-id` | string | EPG channel identifier — matches `<channel id="...">` in XMLTV | `tvg-id="BBC1.uk"` |
| `tvg-name` | string | Display name (may differ from title after comma) | `tvg-name="BBC One HD"` |
| `tvg-logo` | URL | Channel/content artwork | `tvg-logo="https://i.imgur.com/abc.png"` |
| `group-title` | string | Category / folder name | `group-title="News"` |
| `tvg-language` | string | Language (ISO 639 code or English name) | `tvg-language="eng"` |
| `tvg-country` | string | Country code (ISO 3166-1) | `tvg-country="uk"` |
| `tvg-chno` | number | Channel number for sorting | `tvg-chno="101"` |

### Attribute parsing
- All attributes are `key="value"` pairs (double quotes required)
- Keys are case-insensitive by convention
- Unknown attributes should be preserved but are non-standard

---

## 4. Content Type Detection

M3U has no explicit content type field. Type must be inferred:

### From URL patterns
| Pattern | Type |
|---------|------|
| `/live/` in path | Live channel |
| `/movie/` in path | Movie / VOD |
| `/series/` in path | Series episode |
| `.mp4`, `.mkv`, `.avi`, `.mov` extension | Movie / VOD |
| `.m3u8` or no extension | Live channel (usually) |

### From title patterns (series detection)
| Pattern | Example | Meaning |
|---------|---------|---------|
| `S01 E08` or `S01E08` | `Breaking Bad (2008) S01 E01` | Season 1, Episode 1 |
| `Season 1 Episode 8` | `The Office Season 3 Episode 15` | Verbose form |
| `1x08` | `Friends 1x01` | Compact season×episode |

### From EXTINF duration
| Value | Likely type |
|-------|-------------|
| `-1` | Live channel |
| `0` | Unknown (could be either) |
| `> 0` | Movie / episode (duration in seconds) |

---

## 5. VLC Options (`#EXTVLCOPT`)

Optional directive lines between `#EXTINF` and the URL. VLC-specific but widely supported:

```
#EXTINF:-1 tvg-id="Channel1" group-title="News",Channel One
#EXTVLCOPT:http-user-agent=Mozilla/5.0 (Windows NT 10.0; Win64; x64)
#EXTVLCOPT:http-referrer=https://example.com
http://stream.example.com/live/channel1.m3u8
```

| Option | Purpose |
|--------|---------|
| `http-user-agent` | Custom User-Agent header for stream requests |
| `http-referrer` | Custom Referer header (geo-blocking workaround) |

---

## 6. Stream URL Formats

| Protocol | Usage | Example |
|----------|-------|---------|
| `http://` / `https://` | Most common — HLS, direct file | `https://cdn.example.com/live.m3u8` |
| `rtmp://` / `rtmps://` | Legacy live streaming (declining) | `rtmp://stream.example.com/live/key` |
| `rtp://` | Multicast (European cable) | `rtp://239.1.1.1:1234` |
| `udp://` | UDP multicast | `udp://239.0.0.1:5500` |
| `file://` | Local file reference | `file:///path/to/video.mp4` |

### File extensions in URLs

| Extension | Container | Typical use |
|-----------|-----------|-------------|
| `.m3u8` | HLS playlist | Live streams, adaptive bitrate |
| `.ts` | MPEG-2 Transport Stream | Live, multicast |
| `.mp4` | MP4 (H.264/H.265) | Movies, episodes |
| `.mkv` | Matroska | Movies (multiple audio/subtitle tracks) |
| `.avi` | AVI | Legacy movies |
| `.mov` | QuickTime | Rare |
| `.flv` | Flash Video | Legacy |

---

## 7. Category / Group Patterns

The `group-title` attribute is the only organizational mechanism. Common conventions:

### Flat categories (most common)
```
group-title="News"
group-title="Sports"
group-title="Movies"
group-title="Kids"
```

### Regional grouping
```
group-title="UK"
group-title="France"
group-title="Pakistan"
```

### Hierarchical (semicolon-separated — less common)
```
group-title="Mystery;2025"
group-title="Business;News"
```

### Genre-based (movie/series playlists)
```
group-title="Action"
group-title="Comedy"
group-title="Drama"
group-title="Thriller"
```

---

## 8. Series in M3U

M3U has no native series hierarchy. Series are represented as flat episode entries with season/episode info encoded in the title:

```
#EXTINF:-1 tvg-id="72" tvg-logo="https://image.tmdb.org/t/p/w342/poster.jpg" group-title="Comedy",Only Fools and Horses (1981) S07 E06
http://example.com/series/user/pass/12345.mp4
#EXTINF:-1 tvg-id="73" tvg-logo="https://image.tmdb.org/t/p/w342/poster.jpg" group-title="Comedy",Only Fools and Horses (1981) S07 E07
http://example.com/series/user/pass/12346.mp4
```

**To reconstruct hierarchy:**
1. Parse season/episode from title (S##E## pattern)
2. Extract base title (everything before S##E##, minus year)
3. Group episodes by normalized base title + year
4. Create parent series entry, child episode entries

**Signals that an entry is a series episode:**
- Title contains `S##E##` or `S## E##` pattern
- URL contains `/series/` path segment
- Multiple entries share the same base title with incrementing S/E numbers

---

## 9. Comparison with Xtream Codes

| Feature | Xtream | M3U |
|---------|--------|-----|
| Auth | username/password per request | None (direct URLs) |
| Categories | API endpoint returns structured list | `group-title` attribute only |
| Content types | Separate API endpoints per type | Must infer from URL/title |
| Series hierarchy | `get_series_info` returns seasons/episodes | Flat — parse from title |
| EPG | Built-in `/xmltv.php` endpoint | External URL in header (if any) |
| Stream URL | Built at play time from credentials | Stored directly in playlist |
| Metadata | `get_vod_info` returns plot/cast/rating | Title only — must parse year/quality/language |
| Catchup/timeshift | `tv_archive` flag + duration | Not standard |
| Refresh | Re-call same API | Re-download same URL/file |

---

## 10. Real-World Quirks

1. **Inconsistent typing** — Same content may appear as "live" on one provider and "movie" on another
2. **Broken logos** — `tvg-logo` URLs frequently go dead (imgur, wikimedia)
3. **Duplicate entries** — Same channel/movie listed multiple times with different URLs (mirrors)
4. **Geo-blocked streams** — Some entries marked with `[Geo-blocked]` in title text
5. **Quality indicators in titles** — `[HD]`, `[4K]`, `[SD]`, `FHD`, `UHD` appended to names
6. **NSFW content** — No standard flag. Identified by category names ("Adult", "XXX") or title keywords
7. **Emoji status markers** — Some playlists use emoji in titles to indicate stream status (🟥 = down, Ⓢ = slow)
8. **Large file sizes** — Playlists can exceed 30MB with 100K+ entries
9. **Mixed protocols** — Same playlist may contain HTTP, HTTPS, RTMP, and UDP streams
10. **Xtream-style M3U** — Many "M3U" files are actually Xtream exports (`/live/user/pass/id.ts` URLs) with full EXTINF metadata
