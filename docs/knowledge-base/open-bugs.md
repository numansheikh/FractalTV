# Open Bugs

Tracked bugs without fixes yet. For fixed bugs and active QA cycles, see `PLAN.md`.

## Episode stream hang — infinite spinner on 404

### Symptom

Clicking to play an episode that doesn't exist on the provider (e.g. S1E6 of a series with only 5 episodes) → player shows infinite spinner and the app becomes unresponsive.

**Example:** Playing *"S1E6 · GR - Cuori(2021) (IT) - SO1E06 - Επεισόδιο 6"* → stream URL fetch fails → spinner forever.

### Root cause (likely)

In `Player.tsx` or `PlayerOverlay.tsx`:
- `getStreamUrl()` IPC call has no timeout.
- On 404 or provider error, promise never resolves or rejects.
- UI waits forever.

### Solution sketch

1. Add a **timeout** to stream URL fetch (5–10 sec).
2. Show an **error overlay** if fetch fails: "Episode not available" + back button.
3. Test by intentionally requesting a non-existent episode ID.

### Files to check

- `src/components/player/PlayerOverlay.tsx` — stream URL loading logic
- `src/lib/api.ts` — `content.getStreamUrl`
- `electron/ipc/handlers.ts` — backend stream URL handler

### Notes

- Affects **any** missing episode, not just series.
- Should prevent hanging on generic network errors too.

## Black screen — occasional idle

Occasional idle black screen in the app. Needs DevTools diagnosis. **Deferred** until reproducible.

## Browse perf regression after g3 full pipeline

After running all 7 pipeline steps on the test source, browsing movies or channels takes **~30+ seconds** to load the first grid page.

Applied fixes (partial — did not fully resolve):
- Removed per-row `EXISTS` for `has_epg_data` in `G3_LIVE_SELECT` (fixed to 0 in browse payload).
- Added indexes `idx_streams_browse` on `streams(source_id, type, added_at DESC)` and `idx_streams_title` on `streams(title)`.
- Rewrote live browse as two-phase query (cheap paged-id selection → aggregate only on paged rows).

Next direction under discussion: **flatten canonical into streams** — denormalize the canonical layer so browse queries hit a single table. Dedup would move to a separate concern. That's the motivation for the `g2-flat` branch.

## M3U headers not parsed (tech debt)

`#EXTVLCOPT:http-referrer` and `#EXTVLCOPT:http-user-agent` directives are needed for ~200+ free channels but are currently not parsed. Those streams return 403 on playback.
