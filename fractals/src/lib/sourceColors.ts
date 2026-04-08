/**
 * Source color palette — 16 fixed colors in rainbow order.
 * Users can manually assign any of these to a source.
 * Auto-assignment cycles through them by source index.
 */

export interface SourceColor {
  accent:         string   // var(--color-X) — for text, dot, stripe
  dim:            string   // 14% fill — normal background
  dimHover:       string   // 20% fill — hover background
  dimSelected:    string   // 26% fill — selected background
  border:         string   // 16% — normal border
  borderSelected: string   // 45% — selected border
  glow:           string   // 40% — status dot glow
  solid:          string   // 65% fill — vibrant block background (EPG, badges)
  solidStrong:    string   // 85% fill — current/active vibrant block
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
    solid:          `color-mix(in srgb, var(${v}) 65%, transparent)`,
    solidStrong:    `color-mix(in srgb, var(${v}) 85%, transparent)`,
  }
}

export const PALETTE_SIZE = 8

export const PALETTE: SourceColor[] = [
  makeColor('--color-src-1'),   // sky blue
  makeColor('--color-src-2'),   // amber
  makeColor('--color-src-3'),   // lime green
  makeColor('--color-src-4'),   // red
  makeColor('--color-src-5'),   // yellow
  makeColor('--color-src-6'),   // purple
  makeColor('--color-src-7'),   // pink/mauve
  makeColor('--color-src-8'),   // teal
]

// Hex values match the dark-mode CSS variables — used for the swatch picker UI
export const PALETTE_HEX = [
  '#00A3E0', // sky blue
  '#E69F00', // amber
  '#A8D600', // lime green
  '#FF4F4F', // red
  '#F6EB61', // yellow
  '#6B32A8', // purple
  '#CC79A7', // pink/mauve
  '#00B2A9', // teal
]

export function getSourceColor(index: number): SourceColor {
  return PALETTE[index % PALETTE_SIZE]
}

export function buildColorMap(
  sourceIds: string[],
  colorOverrides?: Record<string, number>
): Record<string, SourceColor> {
  const map: Record<string, SourceColor> = {}
  sourceIds.forEach((id, i) => {
    const idx = colorOverrides?.[id] ?? i
    map[id] = getSourceColor(idx)
  })
  return map
}

/** Convenience wrapper — pass the full sources array, colorIndex is respected automatically. */
export function buildColorMapFromSources(sources: { id: string; colorIndex?: number }[]): Record<string, SourceColor> {
  const overrides: Record<string, number> = {}
  sources.forEach((s) => { if (s.colorIndex !== undefined) overrides[s.id] = s.colorIndex })
  return buildColorMap(sources.map(s => s.id), overrides)
}
