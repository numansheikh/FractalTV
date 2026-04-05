# Fractals — Business Plan & Competitor Analysis

## 1. Product Vision

Fractals is a cross-platform IPTV client that treats content as the primary abstraction, not playlists or provider accounts. Users add their IPTV sources once, and the app merges everything into a single unified library — enriched with TMDB metadata, searchable by actor, director, genre, or free text, with a semantic search layer underneath. Think "Plex-quality browsing and discovery for IPTV content, running locally on every platform" — desktop, mobile, and TV from one codebase, with zero cloud dependency.

## 2. Competitor Analysis

| App | Platforms | Key Strengths | Weaknesses | Pricing |
|-----|-----------|---------------|------------|---------|
| **TiviMate** | Android, Android TV, Fire TV | Best-in-class EPG grid, multi-playlist support, catchup/timeshift, recording, fast channel switching, highly polished TV UI | Android-only (no iOS/desktop/web), closed-source, requires Google Play, no metadata enrichment beyond EPG | Free tier (1 playlist); Premium $5/yr or $20 lifetime |
| **IPTV Smarters Pro** | Android, iOS, Smart TVs, Windows, macOS | Wide platform coverage, Xtream Codes native support, familiar UI across platforms, whitelabel-friendly | Dated UI, cluttered interface, no content enrichment, no unified search across sources, ad-supported free tier | Free (ads) or ~$1–3 one-time via provider bundles |
| **GSE Smart IPTV** | iOS, Android, macOS, Apple TV | Strong Apple ecosystem support, EPG, Chromecast, parental controls | Confusing UX, poor discoverability, no cross-source merging, aging codebase, ads | Free (ads); Pro ~$6 one-time |
| **IPTVNator (legacy)** | macOS, Windows, Linux, Web (PWA) | Open-source, desktop-first, M3U + Xtream + Stalker support, Angular/Electron/Capacitor stack | No TMDB enrichment, no semantic search, playlist-centric (not content-centric), complex Angular/NgRx codebase, no TV-optimized UI | Free / open-source |
| **OTT Navigator** | Android, Android TV | Excellent EPG, multi-provider, catchup, series grouping, customizable UI layouts | Android-only, steep learning curve, overwhelming settings, no metadata enrichment | Free (ads); Premium ~$5 one-time |
| **Kodi + PVR IPTV** | All (Windows, macOS, Linux, Android, iOS, RPi) | Massively extensible, huge addon ecosystem, PVR/DVR support, true cross-platform | Complex setup, plugin dependency hell, slow UI for casual users, no native Xtream API support (needs addon), heavy resource usage | Free / open-source |
| **Plex** *(UX benchmark)* | All platforms + web | Gold-standard media browsing UX, rich metadata, unified library, semantic search, beautiful poster-driven UI, cross-device sync | Not an IPTV client, requires media server, subscription for mobile, closed ecosystem | Free tier; Plex Pass $5/mo or $120 lifetime |

### Key Takeaway

The IPTV client market splits into two camps: **polished but platform-locked** (TiviMate, OTT Navigator) and **cross-platform but rough** (Kodi, IPTV Smarters, IPTVNator). Nobody offers Plex-level browsing combined with true cross-platform reach and IPTV source support. That gap is where Fractals sits.

## 3. Fractals Differentiators

**Content-first, source-invisible architecture.** No other IPTV client merges multiple Xtream/M3U sources into a single deduplicated library. Users search "Brad Pitt" and see every matching title across all their providers — they never think about which account has what.

**TMDB enrichment pipeline.** Automatic metadata enrichment (plot, cast, director, genres, posters, ratings) transforms raw IPTV stream lists into a browsable media library. On-demand enrichment with multi-candidate title cleaning handles the messy naming conventions IPTV providers use.

**Semantic search (planned).** Local embedding generation via transformers.js enables "find me something like Interstellar" queries — a capability no IPTV client has. Three-layer search (FTS5 + vector similarity + facet filters) merged and ranked.

**Cross-platform from a single codebase.** React + Electron (desktop) + Capacitor (mobile/TV) + web build (Tizen/PWA). Eight platform targets from one TypeScript codebase, with form-factor-aware UI.

**Local-first, no cloud dependency.** All data in local SQLite — metadata, embeddings, watch history, favorites. Works fully offline after initial sync. No user accounts, no telemetry, no data leaving the device.

**Search-centric, information-dense UI.** The home screen is a search bar with browse content underneath. No hero banners, no autoplay trailers. Typing progressively filters. Keyboard-friendly, dense, utility-first. Closer to Raycast than Netflix.

## 4. Target Users

**Cord-cutters with multiple IPTV subscriptions.** Users juggling 2-4 Xtream accounts who are tired of switching between apps or remembering which provider has which content.

**TiviMate users who also need desktop/iOS.** TiviMate is excellent but Android-only. Users with mixed device ecosystems (MacBook + Android TV + iPad) have no single solution today.

**Technical users frustrated with Kodi complexity.** People who want powerful IPTV features without the plugin management, XML editing, and configuration overhead of Kodi.

**Privacy-conscious users.** People who want an IPTV client that stores everything locally with no cloud sync, no analytics, no account creation.

**IPTVNator / open-source community.** Existing users of the legacy app looking for a modernized, faster, more capable replacement.

## 5. Monetization Options

| Model | Pros | Cons | Fit |
|-------|------|------|-----|
| **Free/open-source + donations** | Community goodwill, contribution pipeline, no support burden expectations | Unreliable revenue, GitHub Sponsors typically yields <$500/mo for niche tools | Good for early growth phase |
| **Freemium** (free core, paid enrichment/search/multi-source) | Natural upgrade path, free tier drives adoption, enrichment has real compute cost to justify | Feature-gating in open-source community can cause forks, TMDB API is free so hard to justify | Moderate fit |
| **One-time purchase** ($5–15, platform-specific) | Simple, TiviMate proves willingness to pay in this market, no recurring billing friction | Revenue tapers after initial wave, no ongoing relationship | Strong fit for mobile/TV app stores |
| **Subscription** ($2–3/mo or $20/yr) | Recurring revenue, funds ongoing development, aligns with ongoing TMDB API costs | Subscription fatigue in a "player" category, hard to justify for a client app | Weak fit unless cloud features added |

**Recommended approach:** Open-source core on GitHub (drives trust and adoption) with a **one-time purchase** on app stores ($8–10) for the compiled mobile/TV builds. Desktop stays free. This mirrors the TiviMate model but with broader platform reach.

## 6. Go-to-Market

**Phase 1 — Developer credibility (now).** Ship a polished desktop app. Open-source on GitHub. Write a clear README with screenshots. Post to r/IPTV, r/cordcutters, r/selfhosted. Let the IPTVNator community migrate naturally.

**Phase 2 — Content marketing.** Create comparison posts (Fractals vs TiviMate, Fractals vs Kodi). Record a 2-minute demo video showing multi-source search. Target IPTV forums, Discord servers, and Telegram groups where users discuss providers and clients.

**Phase 3 — Mobile/TV launch.** Ship Android (phone + TV) APK. List on Google Play. This is where the addressable market expands dramatically — most IPTV usage is on TV devices. Consider a beta program via Discord to build early community.

**Phase 4 — App Store expansion.** iOS/iPadOS on Apple App Store. Samsung Tizen app. Each new platform announcement is a marketing moment.

**Phase 5 — Word of mouth.** IPTV users are highly community-driven. A good product in this space spreads through provider Telegram groups and forums organically. Focus on reliability and speed over feature count.

## 7. Risks and Mitigations

| Risk | Severity | Mitigation |
|------|----------|------------|
| **Legal gray area** — IPTV clients are legal, but association with piracy draws scrutiny. App store takedowns (IPTV Smarters was removed from Google Play multiple times). | High | Ship zero content. Never mention specific providers. Position as "media player for your existing subscriptions." Follow TiviMate's playbook — they survived by being a pure client. |
| **App store rejection** — Apple/Google may reject apps that primarily serve IPTV content. | Medium | Emphasize M3U standard support (used by legitimate providers). Have a website APK distribution as fallback for Android. Apple is harder — may need to frame as "media player" not "IPTV client." |
| **TMDB API dependency** — TMDB could change terms, rate-limit harder, or shut down free tier. | Medium | Cache aggressively (enrichment is one-time per title). TMDB has been stable and generous for years. Fallback: OMDB API, or scrape from public metadata sources. |
| **Electron performance** — Large libraries (200k+ items) could strain SQLite/UI. | Medium | Already mitigated: worker threads for sync, WAL mode for concurrent access, virtual scrolling, pagination. Monitor and optimize as real usage data comes in. |
| **Platform fragmentation** — Maintaining 8 platform targets from one codebase is ambitious. | Medium | Prioritize desktop + Android TV (highest demand). Capacitor abstracts most platform differences. Tizen and iOS can lag without losing core market. |
| **TiviMate dominance** — TiviMate has massive mindshare on Android TV, the primary IPTV device. | Medium | Don't compete on Android TV alone. Win on cross-platform (TiviMate can't do desktop/iOS), enrichment quality, and search. Convert users who need multi-device support. |
| **Sustainability** — Solo/small-team project risk of abandonment. | Low-Medium | Open-source ensures community can fork and continue. Keep codebase clean and well-documented. One-time purchase model avoids obligation of ongoing subscription deliverables. |
