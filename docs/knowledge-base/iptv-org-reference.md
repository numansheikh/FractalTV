# iptv-org — external data reference

[iptv-org](https://github.com/iptv-org) maintains a structured IPTV channel metadata database used as the enrichment source for g3 canonical channels.

## Scope

~39K channels, ~194K total rows across 11 CSVs.

## Local copy

`/Users/numan/Downloads/iptv-org database master data/` (CSV snapshot).

## Key tables

| Table | Rows | Fields |
|-------|------|--------|
| `channels.csv` | ~39K | id, name, alt_names, network, owners, country, categories, is_nsfw |
| `feeds.csv` | ~42K | channel, broadcast_area, timezones, languages, format |
| `categories.csv` | 29 | standardized taxonomy (sports, news, kids, movies, etc.) |
| `countries.csv` | 250 | name, code, languages, flag emoji |
| `logos.csv` | ~40K | channel logos with dimensions |
| `blocklist.csv` | ~1.5K | NSFW + DMCA flagged channels |

## Bridge to Fractals

`tvg-id` in well-formed M3U files = `id` column in `channels.csv`.

Tested match rate: **90.6%** on ThePlaylist.m3u (8,555 of 9,439 channels). But observed density on real provider Xtream sources during g3 integration (2026-04-13) was only **~10%** because many provider streams don't carry a valid `tvg-id`. Pass 2 (title normalization) must carry the rest — see [manual-pipeline.md](manual-pipeline.md).

## Critical M3U finding — headers for 403 channels

`#EXTVLCOPT:http-referrer` and `#EXTVLCOPT:http-user-agent` directives are needed for 200+ free channels. **Currently not parsed** in Fractals — those streams return 403 on playback. Open tech-debt item.

## Logos

`logos.json` is fetched alongside channels and threaded into `canonical.logo_url` at enrichment time.
