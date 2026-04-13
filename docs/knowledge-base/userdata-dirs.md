# Electron userData directories

On macOS `~/Library/Application Support/` has **two** Fractals-looking directories. They are one letter apart and easy to confuse.

| Dir | What it is | Safe to wipe? |
|-----|------------|---------------|
| `fractals/` | **Production app** — the one the user actually watches TV on daily. Contains real sources, favorites, watch history. | **NEVER.** Do not `rm -rf` this. Do not suggest it. |
| `fractaltv/` | **Dev / testing app** built from this repo (`/Users/numan/Projects/FractalTV`). | ✅ Wipe this one when doing a clean-slate test. |

## Why this matters

User runs both: the stable production app for actually watching TV, and the dev build from this repo for testing. If a factory-wipe is suggested against `fractals/` by accident, it takes out their daily-driver install and real user data.

## Rule

Before any destructive filesystem action against `~/Library/Application Support/`:

1. **Confirm the target directory name aloud.** Spell it out.
2. Only suggest `rm -rf` or equivalent on `~/Library/Application Support/fractaltv`.
3. If the user's request is ambiguous, ask which one they mean.
