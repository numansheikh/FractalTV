# Fractals

A cross-platform, local-first IPTV client that treats content as the primary abstraction, not playlists or provider accounts. Add your IPTV sources once, and everything merges into a unified library — searchable by title.

**"Plex-quality browsing and search for IPTV content, running locally on every platform."**

---

## Repository layout

| Folder | Description |
|---|---|
| `fractals/` | Active app — React 19 + Vite + Electron + SQLite (better-sqlite3 + Drizzle). All current development happens here. |
| `legacy/` | Frozen Angular + Electron + Capacitor reference (IPTVNator-based). Fully working but no longer maintained. |

For everything below — architecture, running locally, keyboard shortcuts, conventions — see **[`fractals/README.md`](fractals/README.md)** and **[`fractals/CLAUDE.md`](fractals/CLAUDE.md)**.

## Current state

Active branch: **`g1c`** (shipped; being promoted to `master`). 15-table per-type schema (channels / movies / series / episodes + per-type categories + per-type user_data + sources / profiles / settings + epg). Search is plain LIKE on a persisted `search_title` column (any-ascii + lowercase), populated inline at sync. No canonical identity layer, no FTS, no TMDB enrichment. Pipeline: Test → Sync (EPG auto-chains for Xtream sources). Full phase map + future buckets in [`PLAN.md`](PLAN.md).

## Roadmap

Tracked in **[`PLAN.md`](PLAN.md)**:

1. **g2 — Search improvements** (future, no commitments) — denormalized corpus, trigram on CJK / Arabic, ranking signals, embeddings
2. **Multi-platform reach** (Phase 3) — Android, iOS, Android TV, Samsung Tizen via Capacitor
3. **Tech health** — remaining `as any` cast triage
4. **Product shape** (discussion only) — three-tier split (M3U Player / Xtream Lite / Fractals Pro)

## Disclaimer

Fractals does not provide any playlists or other digital content. Users bring their own IPTV sources.
