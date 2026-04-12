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

## Roadmap

Detailed phase status in **[`PLAN.md`](PLAN.md)**. Tiered search roadmap (current focus):

- **g1** — provider-data app, LIKE search (complete)
- **g2** — FTS5 + diacritic/ligature folding, auto-indexed on sync (complete)
- **g3** *(next)* — keyless canonical layer: title normalization + iptv-org enrichment for live channels
- **g4** — embeddings / semantic search
- **g5** — keyed enrichment (TMDB) + cross-language resolution

Five parallel buckets:

1. **Data & Search** *(active — g3 next)*
2. **Product shape** — three-tier split (M3U Player / Xtream Lite / Fractals Pro)
3. **Multi-platform reach** — Android, iOS, Android TV, Samsung Tizen via Capacitor
4. **Experience polish** — series full-page view, player fixes
5. **Tech health** — type safety, security, hardening

## Disclaimer

Fractals does not provide any playlists or other digital content. Users bring their own IPTV sources.
