# Design System

Two pieces here: the **parked rethink** (don't start unprompted) and the **contrast rules** that apply today.

## Parked rethink — borders + washed-out lavender

Current visual language feels off:
- Too many bordered boxes.
- `--accent-interactive` (`#7c4dff` lavender purple) reads as washed out, especially against light backgrounds.

User wants a **from-scratch rethink** of the CSS/design system. Surfaced 2026-04-10 during the HomeView hero redesign. After several iterations on the search field's `@ ADV` chip, user said: *"I dont like the over all CSS.... need to think a new.... we are stuck with border and washed out lavender"* — then explicitly parked it: *"but that for later... seriously"*.

### How to apply while it's parked

- **Do NOT start a design system overhaul unprompted**, even if a task touches CSS heavily.
- When picking colors/borders for new components, prefer choices that won't add debt to undo:
  - Avoid layering more borders.
  - Avoid relying on `--accent-interactive` as the only accent.
- When the user is ready, expect broad scope: token system, accent palette, border philosophy, possibly the radial gradient hero backgrounds.
- Until then, match existing patterns so the rethink only has one shape to flatten.

## Contrast and color vibrancy (applies today)

User has complained multiple times about washed-out/dim defaults: *"washed out colors, dim outlines and font, both for dark and light theme... I have asked multiple times on more vibrant high saturated foreground stuff"*.

### Text

- Section headers / titles → `var(--text-0)` (near white on dark, near black on light)
- Secondary actions, labels → `var(--text-1)` minimum
- Decorative metadata (timestamps, counts) → `var(--text-2)` OK
- `var(--text-3)` is **disabled / placeholder only**

### Borders

Minimum values on dark theme:
- `--border-subtle` ≥ `rgba(255,255,255,0.08)` (not 0.04)
- `--border-default` ≥ `rgba(255,255,255,0.14)`
- `--border-strong` ≥ `rgba(255,255,255,0.24)`

On light theme, use indigo-tinted borders minimum `rgba(79,70,229,0.18)` to stay visible.

### Accents

Use Tailwind 400/500-level saturation minimum:

- Live: `#f43f5e` (rose-500)
- Film: `#60a5fa` (blue-400)
- Series: `#34d399` (emerald-400)
- `--accent-interactive: #8b5cf6` (violet-500) — **NOT blue** (that's accent-film)
- Success: `#4ade80` (green-400) on dark
- Danger: `#f87171` (red-400) on dark
- Warning: `#fbbf24` (amber-400) on dark

## Button style for type filter tabs

Use **Bootstrap-style solid colored buttons** for content type tabs (All / Live TV / Movies / Series). **Not** underline tabs (too subtle).

- Active tab: solid filled background with type color, white text, borderRadius ~7px.
- Inactive tab: transparent background, muted text, hover shows a tinted ghost of the type color.
- Each type gets its own semantic color (All = accent/purple, Live = live color, Movies = movie color, Series = series color).

Implemented in `BrowseView.tsx` and `BrowseViewH.tsx` TYPE_TABS render.

## SourceCard layout

- **Top row** — icon-only Disable / Edit / Delete.
- **Bottom row** — labeled buttons for the manual pipeline (Test, Sync, Fetch EPG, Index VoD FTS, Fetch iptv-org, Build Canonical, Canonical FTS). Each has a small step badge.

## TV compatibility (Phase 3)

TV support (Tizen, Android TV) is Phase 3. Don't block current work, but keep in mind.

- No cursor on TV → hover-based interactions (mouseenter/mouseleave, CardActions overlay, marquee, tooltips) are broken.
- D-pad uses focus, not hover.

When adding hover state, also wire `onFocus` / `onBlur` — or at least leave a comment noting the TV gap. Avoid making hover the only way to trigger critical actions (play, remove). Don't invest in hover-only affordances that will need a full rewrite for TV.

## TV detection must be UA-only

`isTV()` must use `navigator.userAgent` only (Android TV, Tizen, GoogleTV patterns). Never screen size.

**Why:** A previous implementation used `width >= 960 && height >= 540 && width >= height` which matched every desktop browser in landscape — cursor:none and TV layout triggered on normal desktops. User saw missing cursor + broken layout at `localhost:4200` in Chrome.

Screen size can supplement phone/tablet detection but never TV.

## FavChannelCard — no unfavorite action (by design)

TV (Channels) mode `FavChannelCard` **intentionally has no unfavorite/remove action**. This is not a bug. To unfavorite a channel the user goes to Live TV view.
