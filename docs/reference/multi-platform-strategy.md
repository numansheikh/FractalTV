# Fractals Multi-Platform Implementation Strategy

## 1. Platform Priority Matrix

| Priority | Platform | Input | Why | Effort |
|----------|----------|-------|-----|--------|
| **P0** | macOS / Windows / Linux | Keyboard + mouse | Already working (Electron). Stabilize before expanding. | Done |
| **P1** | Android phone/tablet | Touch | Largest IPTV user base. Capacitor reuses React codebase. Side-loading is common on Android, no store gatekeeping. | Medium |
| **P2** | Android TV / Fire TV | D-pad remote | Fire TV dominates IPTV hardware. Same APK as P1 with input-mode switch. | Medium-High |
| **P3** | iOS / iPadOS | Touch | Shares Capacitor work from P1. App Store review is the main risk. | Low (after P1) |
| **P4** | Samsung Tizen TV | D-pad remote | Large installed base but unique SDK, painful debugging. Only after TV navigation is proven on Android TV. | High |
| **P5** | Web (PWA) | Mixed | Nice-to-have. No SQLite, no native player. Limited to streams that don't require CORS workarounds. | Low |

**Recommended order:** Finish Electron stability (P0) --> Android phone (P1) --> Android TV (P2) --> iOS (P3) --> Tizen (P4).

---

## 2. Capacitor Migration Plan

### 2.1 DataService Abstraction

The current `src/lib/api.ts` already checks `isElectron` and falls back to no-ops. This needs to become a proper interface with two implementations.

```
src/services/
  data.interface.ts       # TypeScript interface for all data operations
  electron.data.ts        # Implementation: IPC calls via window.api
  capacitor.data.ts       # Implementation: direct HTTP + local SQLite
  factory.ts              # Runtime detection, returns correct implementation
```

**Key change:** Every method in `api.ts` today maps to an IPC channel. On Capacitor, the same method calls the Xtream HTTP API directly from the renderer (WebView) and writes results to `@capacitor-community/sqlite`.

Detection logic in `factory.ts`:
```ts
import { Capacitor } from '@capacitor/core'
const platform = Capacitor.isNativePlatform() ? 'capacitor'
               : window.api ? 'electron'
               : 'web'
```

### 2.2 What Is Shared vs Platform-Specific

| Layer | Shared? | Notes |
|-------|---------|-------|
| React components, Zustand stores, hooks | Yes (95%) | Only input-mode variants differ (touch vs d-pad) |
| Tailwind styles | Yes (90%) | TV mode adds 1.5x scale, larger focus rings |
| Search (FTS5 queries) | Yes | Same SQL, different SQLite driver |
| Xtream API HTTP calls | Yes | Electron runs them in main process; Capacitor runs them in WebView via fetch |
| SQLite connection | No | Electron: `better-sqlite3` (sync). Capacitor: `@capacitor-community/sqlite` (async). Web: none. |
| TMDB enrichment | Mostly shared | Same API calls. Electron uses worker threads; Capacitor runs in main thread with requestIdleCallback batching. |
| Embedding generation | Platform-specific | Electron: transformers.js in worker. Mobile: skip embeddings, keyword search only. WASM too heavy for mobile. |
| Video playback | Platform-specific | See section 2.4 |
| File system / preferences | No | Electron: Node fs + SQLite. Capacitor: `@capacitor/preferences` + `@capacitor-community/sqlite`. |

### 2.3 SQLite on Mobile

Use `@capacitor-community/sqlite` (v6+). Key differences from `better-sqlite3`:

- **Async-only API.** All queries return Promises. The Drizzle schema files can be reused, but the Drizzle driver changes to `drizzle-orm/sqlite-proxy` with a custom async executor.
- **Migrations.** Ship SQL migration files as assets. Run them on app startup via `sqlite.execute()`. Same `.sql` files used by Electron.
- **WAL mode.** Supported on both iOS and Android. Enable at connection time.
- **Storage location.** Defaults to app-private directory. No user-visible file.
- **Size.** A 200k-row content table with FTS5 index is roughly 150-300MB. Fine for phones, may need pagination/lazy-load on very large libraries.

FTS5 is available in the default SQLite build on both Android and iOS. No special compilation needed.

### 2.4 Video Playback on Mobile

| Platform | Approach | Why |
|----------|----------|-----|
| Android/iOS phone | `@capawesome/capacitor-video-player` or `capacitor-video-player` plugin wrapping ExoPlayer (Android) / AVPlayer (iOS) | WebView HLS support is inconsistent. Native players handle TS, HLS, and hardware decoding properly. |
| Android TV | Same ExoPlayer plugin, but with custom overlay for d-pad controls | ExoPlayer has built-in Leanback transport controls |
| Tizen | AVPlay API (see section 4) | Samsung's proprietary player, only option on Tizen |
| Web/PWA | HLS.js (already in dependencies) + `<video>` tag | Works for HLS streams. TS container streams may not play. |

**Shared player UI.** The React overlay (progress bar, channel info, episode picker) is shared. The actual `<video>` element is replaced by a native player bridge on mobile. Define a `PlayerAdapter` interface:

```ts
interface PlayerAdapter {
  play(url: string, startPosition?: number): Promise<void>
  pause(): void
  seek(seconds: number): void
  getCurrentPosition(): Promise<number>
  onStateChange(cb: (state: 'playing'|'paused'|'buffering'|'ended') => void): void
  destroy(): void
}
```

Electron implementation wraps Artplayer/HLS.js (current). Capacitor implementation wraps the native plugin. Tizen wraps AVPlay.

---

## 3. Android TV / Fire TV Specifics

### 3.1 D-pad Spatial Navigation

The WebView does not get free spatial navigation. You must implement it in JS.

**Recommended library:** `@noriginmedia/norigin-spatial-navigation` (React-focused, 5KB, well-maintained). Wraps each focusable element in a `<FocusableComponent>`, handles arrow key routing, remembers last-focused element per section.

Integration pattern:
```tsx
// Wrap content cards
<FocusableComponent onFocus={() => scrollIntoView(ref)}>
  <ContentCard ... />
</FocusableComponent>
```

**Alternative:** Custom implementation using a focus-grid model (row/column indexes). More work but avoids dependency. Given the grid layout of BrowseView, a custom grid navigator may actually be simpler.

### 3.2 Leanback Launcher Requirements

To appear on the Android TV home screen (not just "sideloaded apps"):

- `AndroidManifest.xml` must declare `android.intent.category.LEANBACK_LAUNCHER`
- Must provide a 320x180 banner image (shown on home screen)
- Must declare `android.software.leanback` as a `uses-feature` (not required)
- Must NOT require `android.hardware.touchscreen`
- Google Play requires a Leanback-compatible screenshot set

For Fire TV: same manifest entries. Fire TV does not enforce Leanback as strictly but still needs the banner and intent filter.

### 3.3 Focus Management in React

- Every interactive element needs a visible focus indicator (already in the design system: 2px purple ring, 3px on TV)
- Focus must never get "lost" (e.g., when a dialog closes, focus returns to the trigger element)
- Scrolling rows must auto-scroll to keep the focused card visible
- Use `data-focusable` attributes and a global focus manager that tracks focus history as a stack
- Tab index management: only the currently visible "section" should have `tabIndex={0}` elements

### 3.4 Remote Control Button Mapping

| Remote Button | KeyCode | Action |
|---------------|---------|--------|
| D-pad arrows | 37-40 | Navigate |
| Center/Select | 13 (Enter) | Select/play |
| Back | 27 (Escape) on Fire TV, 4 (Android back) on others | Go back / close overlay |
| Play/Pause | 179 (MediaPlayPause) | Toggle playback |
| Rewind | 227 | Seek -10s |
| Fast Forward | 228 | Seek +10s |
| Menu | 82 | Open settings/context menu |

**Important:** Fire TV sends Escape (27) for Back. Standard Android TV sends keyCode 4. Handle both. The existing layered Escape handler (capture phase + stopImmediatePropagation) already works for this -- just also listen for keyCode 4.

### 3.5 Performance on TV Hardware

Fire TV Stick (2nd gen) has 1GB RAM, quad-core 1.3GHz. Fire TV Stick 4K has 1.5GB.

- **Limit DOM nodes.** Virtualize long lists (use `@tanstack/react-virtual`). Keep off-screen cards unmounted.
- **Reduce image sizes.** Serve poster images at 200px width max for TV grids. Use `loading="lazy"`.
- **Minimize JS bundle.** Target < 500KB gzipped for initial load. Code-split settings, player, and enrichment.
- **Avoid complex animations.** Framer Motion spring animations on every card will stutter. On TV, use CSS transitions for focus scaling (transform: scale(1.05)) instead.
- **60fps focus transitions.** Only animate `transform` and `opacity` -- never `width`, `height`, `margin`, or `box-shadow`.

---

## 4. Samsung Tizen TV Specifics

### 4.1 Tizen Web App Packaging

Tizen web apps are packaged as `.wgt` files (renamed ZIP containing `config.xml` + web assets).

Build pipeline: `vite build` --> copy `dist/` into Tizen project --> `tizen package -t wgt`

`config.xml` must declare:
- App ID (reverse domain: `tv.fractals.app`)
- Required privileges: `http://tizen.org/privilege/internet`, `http://tizen.org/privilege/tv.inputdevice`
- Feature: `http://tizen.org/feature/screen.size.normal.1080p`

### 4.2 Tizen Remote Control API

```js
tizen.tvinputdevice.registerKey('MediaPlayPause')
tizen.tvinputdevice.registerKey('MediaRewind')
tizen.tvinputdevice.registerKey('MediaFastForward')
```

Keys must be explicitly registered before they fire DOM keydown events. Unregistered keys are swallowed by the Tizen system.

D-pad arrows and Enter fire standard keydown events without registration.

### 4.3 Memory / CPU Constraints

- **Samsung TV WebView (Chromium-based):** Typically 300-500MB available for the app
- **JS heap limit:** ~150MB on 2020+ models, less on older
- **No Web Workers in some older Tizen versions** (pre-5.0). Enrichment must run on main thread with chunking.
- **No `SharedArrayBuffer`** -- rules out some WASM approaches
- **Cold start budget:** App must show content within 3 seconds or users will abandon. Pre-render a skeleton, lazy-load everything else.

### 4.4 Tizen App Store (Samsung Seller Office)

- Apps must pass Samsung's QA checklist (focus visible, Back button exits app, no crashes for 30 min)
- Must handle network loss gracefully (show offline message, don't crash)
- Must display a loading indicator for any operation > 1 second
- Resolution: 1920x1080 required. Some TVs are 4K but the WebView renders at 1080p and upscales.
- IPTV apps are generally accepted (Samsung has its own IPTV apps). Content legality is the user's responsibility.

### 4.5 Video Playback: AVPlay vs HTML5

**Use AVPlay API.** HTML5 `<video>` on Tizen has limited codec support and no DRM passthrough. AVPlay supports:
- HLS, MPEG-DASH, MPEG-TS, MP4
- Hardware-accelerated decoding
- Subtitle rendering
- Timeshift / seek in live streams

```js
webapis.avplay.open(url)
webapis.avplay.setDisplayRect(0, 0, 1920, 1080)
webapis.avplay.prepare(() => webapis.avplay.play())
```

Wrap AVPlay behind the same `PlayerAdapter` interface described in section 2.4.

---

## 5. iOS / iPadOS Considerations

### 5.1 App Store Restrictions

Apple has historically rejected "generic IPTV player" apps that connect to arbitrary servers. Mitigation strategies:

- **Frame as a "media library manager"** that works with user-provided content sources, similar to how Infuse or VLC are positioned
- **Do not mention IPTV, Xtream, or piracy** in App Store metadata
- **Include a disclaimer** that users are responsible for the legality of their content sources
- **Alternative:** Distribute via TestFlight (up to 10,000 testers, no review for builds after first approval) or AltStore for sideloading

Realistic expectation: initial submission may be rejected. Plan for 2-3 review cycles.

### 5.2 Video Playback

AVFoundation (via Capacitor plugin) handles HLS natively. For TS container streams, use the same ExoPlayer/AVPlayer Capacitor plugin from the Android build. iOS Safari WebView also handles HLS natively in the `<video>` tag, so HLS.js may be unnecessary on iOS.

### 5.3 Touch-Optimized UI Adaptations

- Minimum tap target: 44x44pt (Apple HIG)
- Swipe-back gesture for navigation (Capacitor enables this by default on iOS)
- Pull-to-refresh on browse view to trigger source re-sync
- Bottom tab bar for main navigation (Browse / Search / Favorites / Settings) instead of the desktop sidebar
- Cards: larger touch targets, no hover states, long-press for context menu (favorite, watchlist, share)

---

## 6. Shared vs Platform-Specific Code Estimate

| Code Area | ~Lines | Shared | Platform-Specific |
|-----------|--------|--------|--------------------|
| React components | 5,000 | 85% | 15% (TV focus wrappers, touch gestures, bottom nav) |
| Zustand stores | 800 | 98% | 2% (platform detection flags) |
| Hooks / utilities | 600 | 90% | 10% (input mode detection) |
| Styles (Tailwind) | 1,200 | 90% | 10% (TV scale overrides, touch spacing) |
| DataService interface | 200 | 100% | 0% (interface is shared) |
| DataService implementations | 1,500 | 0% | 100% (Electron, Capacitor, Tizen each ~500 lines) |
| PlayerAdapter implementations | 1,000 | 0% | 100% (Artplayer, ExoPlayer, AVPlay) |
| Navigation (spatial/touch) | 800 | 30% | 70% (d-pad logic, gesture handlers) |
| Build config / native shells | 500 | 0% | 100% |
| **Total** | **~10,600** | **~75%** | **~25%** |

---

## 7. Testing Strategy

### 7.1 Unit Tests (All Platforms)

- **Vitest** for Zustand stores, hooks, utility functions, DataService implementations
- Mock SQLite for Capacitor DataService tests (use `sql.js` as in-memory stand-in)
- Mock IPC for Electron DataService tests
- Target: stores, services, and complex hooks. Not individual UI components.

### 7.2 Component Tests

- **Vitest + Testing Library** for React components with user interaction
- Focus management tests: simulate arrow key sequences, assert correct element receives focus
- Run in JSDOM -- no real browser needed for most cases

### 7.3 E2E Tests

- **Playwright** for Electron (already planned)
- **Appium** or **Maestro** for Android phone + Android TV
  - Maestro is simpler for flow-based tests ("open app, search for X, tap result, verify player opens")
  - Appium for more complex assertions
- **Detox** for iOS (or Maestro, which also supports iOS)
- Tizen: manual testing only. Samsung's remote test lab (cloud device farm) for pre-submission QA.

### 7.4 Device Matrix

| Platform | CI Device | Manual Device |
|----------|-----------|---------------|
| Electron (macOS) | GitHub Actions macOS runner | Dev machine |
| Electron (Windows) | GitHub Actions Windows runner | VM or real machine |
| Android phone | Android emulator (API 33) in CI | Physical device |
| Android TV | Android TV emulator (API 33, TV profile) | Fire TV Stick 4K |
| iOS | iOS Simulator in CI (macOS runner) | Physical iPhone |
| Tizen | Samsung Remote Test Lab | Physical Samsung TV |

### 7.5 Efficient Cross-Platform Testing

1. **Shared test utils.** Write page-object-style helpers (`searchFor("Breaking Bad")`, `openFirstResult()`, `verifyPlayerPlaying()`) that abstract platform input differences.
2. **Platform parity tests.** A small set of critical flows (add source, sync, search, play) run on every platform in CI. Extended tests are platform-specific.
3. **Visual regression.** Use Percy or Chromatic on the web build to catch layout regressions. Cheaper than running visual tests on every platform.
4. **Smoke test on real devices.** Before every release, manually run through the critical flow on one physical device per platform. Emulators miss real-world issues (TV remote timing, touch responsiveness, memory pressure).
