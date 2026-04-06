/**
 * Source color palette using dedicated --color-src-N variables.
 * These live in hue zones (amber, orange, violet, fuchsia, pink, lime)
 * that never overlap the type indicator colors (red=live, blue=movies, teal=series).
 * Dark and light theme variants are defined in globals.css.
 */

export interface SourceColor {
  accent:         string   // var(--color-X) — for text, dot, stripe
  dim:            string   // 14% fill — normal background
  dimHover:       string   // 20% fill — hover background
  dimSelected:    string   // 26% fill — selected background
  border:         string   // 16% — normal border
  borderSelected: string   // 45% — selected border
  glow:           string   // 40% — status dot glow
}

function makeColor(v: string): SourceColor {
  return {
    accent:         `var(${v})`,
    dim:            `color-mix(in srgb, var(${v}) 14%, transparent)`,
    dimHover:       `color-mix(in srgb, var(${v}) 20%, transparent)`,
    dimSelected:    `color-mix(in srgb, var(${v}) 26%, transparent)`,
    border:         `color-mix(in srgb, var(${v}) 16%, transparent)`,
    borderSelected: `color-mix(in srgb, var(${v}) 45%, transparent)`,
    glow:           `color-mix(in srgb, var(${v}) 40%, transparent)`,
  }
}

// Source palette — hue zones that never overlap type indicator colors
// (red/rose=live, blue=movies, teal/emerald=series).
// Ordered to maximize hue distance for the most common case (2–4 sources):
//   1 source  → violet (280°)
//   2 sources → violet, gold            (128° apart)
//   3 sources → violet, gold, hot-pink  (128°, 80°, 56°)
//   4 sources → violet, gold, hot-pink, orange (all 56°+ apart)
const PALETTE: SourceColor[] = [
  makeColor('--color-src-1'),   // vivid violet  ~280°
  makeColor('--color-src-2'),   // vivid gold     ~48°
  makeColor('--color-src-5'),   // hot pink      ~328°   ← 80° from gold, 56° from orange
  makeColor('--color-src-3'),   // vivid orange   ~24°
  makeColor('--color-src-4'),   // vivid fuchsia ~294°
  makeColor('--color-src-6'),   // warm amber     ~32°
  makeColor('--color-src-7'),   // soft lavender ~278°
  makeColor('--color-src-8'),   // bright lemon   ~53°
]

export function getSourceColor(index: number): SourceColor {
  return PALETTE[index % PALETTE.length]
}

export function buildColorMap(sourceIds: string[]): Record<string, SourceColor> {
  const map: Record<string, SourceColor> = {}
  sourceIds.forEach((id, i) => { map[id] = getSourceColor(i) })
  return map
}
