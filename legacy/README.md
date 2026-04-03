# Fractals — Legacy Reference Implementation

This folder contains the original Angular + Electron + Capacitor implementation, forked from IPTVNator and extended through Phase 1 (TV UI mode).

**Stack**: Angular 21 · NgRx · Electron 39 · Capacitor 8 · SQLite/Drizzle · Material Design 3

**Status**: Frozen reference. Do not modify. The new app lives in `../fractals/`.

## To run

```bash
cd legacy
pnpm install
pnpm run serve:frontend   # web only (localhost:4200)
pnpm run serve:backend    # full Electron app
```
