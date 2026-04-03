# Fractals — Multi-Platform Enhancement Plan

## Vision

Ship Fractals as a polished IPTV player across all major platforms from a single Angular codebase:

| Platform | Mechanism | Status |
|---|---|---|
| Web (PWA) | Angular build | Working |
| macOS | Electron | Working |
| Windows | Electron | Working |
| Android (phone/tablet) | Capacitor | Scaffolded — needs UI adaptation |
| iOS | Capacitor | Scaffolded — needs UI adaptation |
| Android TV | Capacitor (single APK) | FormFactorService wired — needs TV layout |
| Tizen (Samsung TV) | Web app + Tizen Studio wrapper | Not started |

---

## Architecture Principles

- **One Angular codebase** drives all platforms. No platform-specific forks.
- **FormFactorService** (`apps/web/src/app/services/form-factor.service.ts`) is the single source of truth for layout mode: `phone`, `tablet`, `tv`.
- **DataService factory** (`app.config.ts`) selects Electron, PWA (Capacitor), or Web implementation at runtime.
- All platform-specific code lives in isolated adapters — components stay clean.

---

## Phase 0 — Codebase Hygiene (Do First)

Before building new features, stabilize the base:

- [ ] Commit all current in-progress changes with meaningful messages
- [ ] Verify existing tests pass: `nx run-many --target=test --all`
- [ ] Verify the web app builds cleanly: `nx build web --configuration=pwa`
- [ ] Verify Electron builds: `nx build electron-backend`
- [ ] Review and document any broken/skipped tests

---

## Phase 1 — TV UI Mode (Highest Leverage)

TV layout drives both Android TV and Tizen. Design this first — it ripples everywhere.

**Goal**: When `FormFactorService.isTV()` is true, the app switches to a 10-foot UI:
- D-pad navigable (keyboard arrow keys map to focus movement)
- Large touch targets (min 48px, recommended 64px+)
- Full-screen category/channel browsing (no sidebars)
- No hover-dependent interactions

**Tasks**:
- [ ] Create `TvLayoutComponent` — full-screen category browser with D-pad focus management
- [ ] Implement `FocusManagerService` — tracks focused element, handles arrow key navigation
- [ ] Wrap video player in TV-friendly controls overlay (auto-hide, remote-style seek)
- [ ] Connect `isTV()` signal in `AppComponent` to switch layout at runtime
- [ ] Test with keyboard navigation (simulates remote control)

---

## Phase 2 — Mobile UI (Android & iOS)

**Goal**: Phone and tablet layouts that feel native, not shrunken desktop.

**Tasks**:
- [ ] Phone layout: bottom nav bar, full-screen channel list, swipe to dismiss player
- [ ] Tablet layout: split-pane (channel list left, player right), similar to current desktop but touch-optimized
- [ ] Adapt `FormFactorService` usage across all route components
- [ ] Capacitor plugins to wire up:
  - `@capacitor/app` — back button handling (Android)
  - `@capacitor/status-bar` — immersive mode for video playback
  - `@capacitor/screen-orientation` — lock to landscape during playback
- [ ] Build and test on Android emulator: `npx cap run android`
- [ ] Build and test on iOS simulator: `npx cap run ios`

---

## Phase 3 — Android TV (Single APK)

Android TV reuses the Capacitor Android build with `isTV()` routing to TV layout.

**Tasks**:
- [ ] Add `android:banner` and leanback launcher to `AndroidManifest.xml`
- [ ] Declare `android.hardware.type.television` feature in manifest
- [ ] Ensure TV layout (Phase 1) activates via UA/size detection on Android TV
- [ ] Test D-pad navigation on Android TV emulator
- [ ] Single APK ships to both Play Store (phone/tablet) and Amazon/TV stores

---

## Phase 4 — Tizen (Samsung Smart TV)

**Goal**: Package the Angular PWA build as a Tizen web app.

**Tasks**:
- [ ] Create `tizen/` project directory with `config.xml` manifest
- [ ] Set app ID, icons, required privileges (internet access, media playback)
- [ ] Add Tizen-specific UA string to `FormFactorService` TV detection (already has HbbTV — verify Samsung coverage)
- [ ] Build script: `nx build web --configuration=pwa` → copy `dist/apps/web/` → Tizen package
- [ ] Handle Tizen remote control key codes (mapped to standard key events where possible)
- [ ] Test in Tizen Studio emulator
- [ ] Document signing/packaging for Samsung App Store submission

---

## Phase 5 — Desktop Polish (macOS & Windows)

The Electron path already works. These are quality-of-life improvements:

- [ ] macOS: native menu bar integration, Touch Bar support (optional)
- [ ] macOS: proper app signing and notarization for distribution
- [ ] Windows: NSIS installer, auto-update via `electron-updater`
- [ ] Both: system tray with quick controls
- [ ] Both: keyboard shortcuts surface (channel up/down, mute, fullscreen)

---

## Phase 6 — Feature Enhancements

Cross-platform features that improve all variants:

- [ ] Parental controls / PIN lock
- [ ] Sleep timer
- [ ] Picture-in-Picture (web API + Electron)
- [ ] Improved EPG: multi-day view, reminder notifications
- [ ] Playlist sync via Turso remote DB (already supported via env vars)
- [ ] Remote control web app (`apps/remote-control-web`) — finish and ship

---

## Key Files Reference

| File | Purpose |
|---|---|
| `apps/web/src/app/services/form-factor.service.ts` | Phone/tablet/TV detection signals |
| `capacitor.config.ts` | Capacitor root config (appId: `tv.fractals.app`) |
| `android/` | Capacitor Android project |
| `ios/` | Capacitor iOS project |
| `apps/electron-backend/` | Electron main process |
| `apps/web/src/app/app.config.ts` | DataService factory (Electron vs PWA) |
| `apps/web/src/app/app.routes.ts` | Lazy routes (Electron vs web variants) |
| `apps/remote-control-web/` | Companion remote control web app |

---

## Decision Log

| Date | Decision | Reason |
|---|---|---|
| 2026-04-03 | Kept FractalTV-M as the single working repo | Has Capacitor scaffold + FormFactorService already; FractalTV was identical minus mobile |
| 2026-04-03 | TV UI design before mobile UI | D-pad/10-foot layout decision ripples to Tizen + Android TV; do it once |
