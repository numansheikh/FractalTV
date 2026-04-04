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

// Dedicated source palette — hue zones never overlap type colors.
// --color-src-1 (amber) is reserved for the "All" tab button.
// Sources start at src-2 so they never clash with "All".
// Ordered to maximize hue distance between ANY number of adjacent sources:
//   2 sources → orange, violet        (235° apart)
//   3 sources → orange, violet, pink  (all 100°+ apart)
//   4 sources → orange, violet, pink, green (all 70°+ apart)
const PALETTE: SourceColor[] = [
  makeColor('--color-src-2'),   // orange        ~24°
  makeColor('--color-src-3'),   // soft violet  ~259°
  makeColor('--color-src-5'),   // hot pink     ~328°
  makeColor('--color-src-6'),   // lime-green   ~142°
  makeColor('--color-src-8'),   // yellow        ~53°
  makeColor('--color-src-4'),   // fuchsia      ~294°
  makeColor('--color-src-7'),   // light purple ~278°
]

export function getSourceColor(index: number): SourceColor {
  return PALETTE[index % PALETTE.length]
}

export function buildColorMap(sourceIds: string[]): Record<string, SourceColor> {
  const map: Record<string, SourceColor> = {}
  sourceIds.forEach((id, i) => { map[id] = getSourceColor(i) })
  return map
}
