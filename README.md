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

Active branch: **`g3`**. g0–g2 shipped (15-table per-type schema, LIKE search on `search_title`, unified detail panels, mini player, M3U parity, VoD enrichment, ADV search). g3 in progress (TMDB enrichment shipped; design revamp + code sweep remaining). Multi-platform (Capacitor/Tizen) is g4.

- **Strategy + shipped history:** [`PLAN.md`](PLAN.md)
- **Actionable work (bugs, gaps, debt):** [`BACKLOG.md`](BACKLOG.md)
- **Reference (API / format docs, strategy papers):** [`docs/reference/`](docs/reference/)

## Disclaimer

Fractals does not provide any playlists or other digital content. Users bring their own IPTV sources.
