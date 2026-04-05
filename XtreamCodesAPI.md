# Xtream Codes API — Complete Reference

Every call is a simple HTTP GET. All endpoints require `username` and `password` as query parameters.

**Base URL format:**
```
http(s)://SERVER:PORT/
```

---

## 1. Authentication & Account Info

| What | URL |
|------|-----|
| User info + server info | `/player_api.php?username=USER&password=PASS` |

Returns JSON with `user_info` (auth status, expiry, max connections, trial status, created date) and `server_info` (URL, port, protocol, timezone, timestamp).

---

## 2. Full Playlist Export

| What | URL |
|------|-----|
| M3U playlist | `/get.php?username=USER&password=PASS&type=m3u_plus&output=ts` |

Returns a full `.m3u` file with all channels/VOD/series. `output` can be `ts` or `m3u8`.

---

## 3. Live TV

| Action | URL |
|--------|-----|
| All categories | `/player_api.php?username=USER&password=PASS&action=get_live_categories` |
| All live streams | `/player_api.php?username=USER&password=PASS&action=get_live_streams` |
| Streams by category | `/player_api.php?username=USER&password=PASS&action=get_live_streams&category_id=ID` |

**Playback URL:**
```
http(s)://SERVER:PORT/live/USER/PASS/STREAM_ID.ts
http(s)://SERVER:PORT/live/USER/PASS/STREAM_ID.m3u8
```

---

## 4. VOD (Movies)

| Action | URL |
|--------|-----|
| All categories | `/player_api.php?username=USER&password=PASS&action=get_vod_categories` |
| All VOD streams | `/player_api.php?username=USER&password=PASS&action=get_vod_streams` |
| VOD by category | `/player_api.php?username=USER&password=PASS&action=get_vod_streams&category_id=ID` |
| VOD details | `/player_api.php?username=USER&password=PASS&action=get_vod_info&vod_id=ID` |

**Playback URL:**
```
http(s)://SERVER:PORT/movie/USER/PASS/STREAM_ID.mkv
http(s)://SERVER:PORT/movie/USER/PASS/STREAM_ID.mp4
```
(extension depends on the `container_extension` field in the API response)

---

## 5. Series (TV Shows)

| Action | URL |
|--------|-----|
| All categories | `/player_api.php?username=USER&password=PASS&action=get_series_categories` |
| All series | `/player_api.php?username=USER&password=PASS&action=get_series` |
| Series by category | `/player_api.php?username=USER&password=PASS&action=get_series&category_id=ID` |
| Series info (seasons/episodes) | `/player_api.php?username=USER&password=PASS&action=get_series_info&series_id=ID` |

**Playback URL:**
```
http(s)://SERVER:PORT/series/USER/PASS/STREAM_ID.mkv
http(s)://SERVER:PORT/series/USER/PASS/STREAM_ID.mp4
```

---

## 6. EPG (Electronic Program Guide)

| Action | URL |
|--------|-----|
| Full XML EPG (all channels) | `/xmltv.php?username=USER&password=PASS` |
| Short EPG for a stream | `/player_api.php?username=USER&password=PASS&action=get_short_epg&stream_id=ID` |
| Short EPG with limit | `/player_api.php?username=USER&password=PASS&action=get_short_epg&stream_id=ID&limit=N` |
| Full EPG for a stream | `/player_api.php?username=USER&password=PASS&action=get_simple_data_table&stream_id=ID` |

---

## Quick Summary — All 10 Actions

| # | Action | Optional Params |
|---|--------|-----------------|
| 1 | `get_live_categories` | — |
| 2 | `get_live_streams` | `category_id` |
| 3 | `get_vod_categories` | — |
| 4 | `get_vod_streams` | `category_id` |
| 5 | `get_vod_info` | `vod_id` (required) |
| 6 | `get_series_categories` | — |
| 7 | `get_series` | `category_id` |
| 8 | `get_series_info` | `series_id` (required) |
| 9 | `get_short_epg` | `stream_id` (required), `limit` |
| 10 | `get_simple_data_table` | `stream_id` (required) |

---

## Playback URL Cheat Sheet

| Type | Pattern |
|------|---------|
| Live (TS) | `SERVER:PORT/live/USER/PASS/STREAM_ID.ts` |
| Live (HLS) | `SERVER:PORT/live/USER/PASS/STREAM_ID.m3u8` |
| Movie | `SERVER:PORT/movie/USER/PASS/STREAM_ID.EXT` |
| Series | `SERVER:PORT/series/USER/PASS/STREAM_ID.EXT` |

---

## Notes

- All API responses return JSON (except `/xmltv.php` which returns XML and `/get.php` which returns M3U)
- No auth tokens — credentials are passed in every request as query params
- `STREAM_ID` comes from the `stream_id` field in the JSON responses
- File extension for VOD/series comes from the `container_extension` field in the response
- Some providers add `&output=ts` or `&output=m3u8` to the playlist export for format control
