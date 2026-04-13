# Product Strategy — three-tier app split

Three apps, one React codebase, split at packaging time with feature flags.

## Tiers

1. **M3U Player** — free, ad-supported, all platforms. "VLC but for M3U". Channel organizer. No TMDB. iptv-org for metadata.
2. **Xtream Lite** — free, ad-supported, Android only. Single source, TMDB enrichment, trimmed UI.
3. **Fractals Pro** — paid, no ads, all platforms. Multi-source M3U + Xtream, full features, setup wizard.

## Why the split

- App Store risk — Xtream is a grey area; keeping it out of iOS/Mac store versions reduces takedown risk.
- Different audiences — cord-cutters (free + ads) vs paying IPTV users.
- Monetization — free+ads vs paid upfront.

## How to apply

- Feature flags, not separate codebases. One React tree, config-driven gating.
- Don't block current development — build features into the unified app, tag them by tier.
- Split only at packaging time (different Electron/Capacitor build configs, different app IDs, different store listings).

Parked until post-g3. No build work on this yet.
