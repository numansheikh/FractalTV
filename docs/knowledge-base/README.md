# Fractals — Knowledge Base

Snapshot of design decisions, project context, and conventions exported from working-memory notes on 2026-04-14. Live authoritative state lives in `PLAN.md` and `fractals/CLAUDE.md`; this folder is the deeper "why" behind those files.

Read order for a new contributor (or new Claude session):

1. [project-context.md](project-context.md) — where the project is, which branches matter
2. [product-strategy.md](product-strategy.md) — three-tier split (M3U Player / Xtream Lite / Fractals Pro)
3. [feature-buckets.md](feature-buckets.md) — the six work buckets and what's in each
4. [data-model.md](data-model.md) — two-layer provider + canonical model
5. [search-architecture.md](search-architecture.md) — FTS5 + LIKE hybrid, three-parallel queries
6. [g3-design.md](g3-design.md) — locked decisions for canonical channel identity
7. [g3-postmortem.md](g3-postmortem.md) — what broke during g3 integration and why
8. [manual-pipeline.md](manual-pipeline.md) — the 7-step per-source manual pipeline
9. [iptv-org-ingestion.md](iptv-org-ingestion.md) — splash / TTL / refresh flow
10. [live-tv-nav.md](live-tv-nav.md) — Grid → Split → Fullscreen
11. [vocabulary.md](vocabulary.md) — locked UI/code terminology
12. [design-system.md](design-system.md) — parked rethink + contrast rules
13. [iptv-org-reference.md](iptv-org-reference.md) — iptv-org DB shape
14. [userdata-dirs.md](userdata-dirs.md) — `fractals/` (prod) vs `fractaltv/` (dev)
15. [open-bugs.md](open-bugs.md) — tracked bugs without fixes yet
16. [conventions.md](conventions.md) — cross-cutting rules (navigation stack, Escape, source ID fallback, etc.)
17. [user-prefs.md](user-prefs.md) — how the user likes to collaborate
