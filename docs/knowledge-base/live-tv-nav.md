# Live TV — 3-layer navigation

Decided 2026-04-06 after mockup review (`live-07-flow-interactive.html`).

## The three states

### 1. Grid
Channel cards with NOW/NEXT EPG inline. Clicking a channel → Split View.

### 2. Split View
- **Channel list** (left, 300px)
- **Player** (top-right, `flex:1` — EPG strip never wastes player space)
- **EPG strip** (bottom-right)

Interactions:
- Clicking the player → Fullscreen.
- Clicking a different channel in the list → switches stream (opacity pulse).
- Clicking the **same active channel again** → Fullscreen.

### 3. Fullscreen
Full-screen player overlay. Escape → back to Split View.

## EPG strip (bottom of right column in Split View)

- **Collapsed (96px)** — NOW title + progress bar + NEXT inline. Click to expand.
- **Expanded (244px)** — 4 program rows for current channel. Click row = catchup (Phase 0, done).
- **"Full EPG Guide" button** at bottom of expanded state (Phase 0, done).

## Escape chain for Live TV

- Fullscreen → Split View (Escape)
- Split View → Grid (Escape)
- Grid → back to normal app Escape chain (App.tsx bubble handler)

## Implementation

- `splitViewChannel: ContentItem | null` in `app.store`.
- `LiveSplitView` component in `src/components/live/`.
- Channel grid click → `setSplitViewChannel(item)` (not `setPlayingContent`).
- Split view player click → `setPlayingContent(item)` (fullscreen).
- Escape in split view player uses **capture phase + stopImmediatePropagation** → back to grid.

## Why this layering

Evaluated Option A (grid + mini-bar) vs Option B (split view). Split view gives immediate playback + channel browsing without losing context. Fullscreen is opt-in, not the default on channel click.

When touching Live TV UI, follow this 3-layer stack. Don't collapse split view into a mini-bar or make fullscreen the default.
