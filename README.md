# Fractals

A cross-platform, local-first IPTV client that treats content as the primary abstraction, not playlists or provider accounts. Add your IPTV sources once, and everything merges into a unified library enriched with TMDB metadata — searchable by actor, director, genre, or free text.

**"Plex-quality browsing and search for IPTV content, running locally on every platform."**

---

## Repository layout

| Folder | Description |
|---|---|
| `fractals/` | Active app — React 19 + Vite + Electron + SQLite (better-sqlite3 + Drizzle). All current development happens here. |
| `legacy/` | Frozen Angular + Electron + Capacitor reference (IPTVNator-based). Fully working but no longer maintained. |

For everything below — architecture, running locally, keyboard shortcuts, conventions — see **[`fractals/README.md`](fractals/README.md)** and **[`fractals/CLAUDE.md`](fractals/CLAUDE.md)**.

## Current state

Active branch: **`g1c`**. The g1c schema redesign is **design-locked but not yet implemented** — it sits on top of tag `g1-baseline` at commit `3cfac99c`. The redesign moves the database to a 15-table surface (split per-type content / categories / user-data, FTS5 baked in, no canonical layer) and introduces a `search_title` normalization stage. Full design and implementation task list live in [`PLAN.md`](PLAN.md).

## Roadmap

High-level work is tracked in **[`BACKLOG.md`](BACKLOG.md)**. Five active buckets:

1. **Data & Search** *(next pick)* — canonical data model + search redesign + TMDB enrichment
2. **Product shape** — three-tier split (M3U Player / Xtream Lite / Fractals Pro) and M3U format work
3. **Multi-platform reach** — Android, iOS, Android TV, Samsung Tizen via Capacitor
4. **Experience polish** — Live TV nav, series full-page view, player fixes
5. **Tech health** — QA cycle 2 follow-ups (type safety, security, hardening)

## Disclaimer

Fractals does not provide any playlists or other digital content. Users bring their own IPTV sources.
