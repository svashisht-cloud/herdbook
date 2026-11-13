// Design tokens: the one source of every color and size in the dashboard (decisions log: Theme tokens).
// CSS and the SVG map read them as CSS variables (applyTheme writes them on :root at startup);
// three.js and recharts can't read CSS, so they import THEME directly. No hex codes live anywhere else.

const floor = '#1c2532'

const status = {
  online: '#3fb950',
  degraded: '#d29922',
  offline: '#8b949e',
} as const

export const THEME = {
  color: {
    bg: '#0d1117',
    surface: '#161b22',
    surfaceRaised: '#1f2630',
    border: '#30363d',
    borderMuted: '#21262d',
    text: '#e6edf3',
    textMuted: '#8b949e',
    accent: '#58a6ff', // selection, active controls, speed chart
    accentText: '#0d1117', // text on an accent fill
    danger: '#f85149',
    dangerSurface: '#2d1517',
    // Yard map, shared by the 2D SVG and the 3D scene.
    floor,
    // Occupancy map pixels (decisions log: Map loader). Free matches the floor, so only walls stand out.
    mapFree: floor,
    mapOccupied: '#8b98a9',
    mapUnknown: '#121820',
    floorGrid: '#2a3646',
    floorBoundary: '#7d8ea5',
    axisX: '#ff6b6b', // ROS convention: x red
    axisY: '#7ee787', // ROS convention: y green
    robotBody: '#6e7681', // placeholder box while the model loads or if it fails
    robotWheel: '#0d1117', // 2D glyph wheels
    robotNose: '#e6edf3', // 2D glyph heading marker
    chartBattery: '#a371f7', // a series color, deliberately not a status color
    status,
    // Incident status reuses the robot status palette: recording is "in progress", ready is "good".
    incident: { recording: status.degraded, ready: status.online },
  },
  space: [0, 4, 8, 12, 16, 24, 32], // px; --space-0 .. --space-6
  radius: { sm: 4, md: 8, pill: 999 }, // px
  font: {
    family: "system-ui, -apple-system, 'Segoe UI', sans-serif",
    size: { xs: 11, sm: 12, md: 14, lg: 16, xl: 18 }, // px
  },
} as const

export type Theme = typeof THEME

const kebab = (s: string) => s.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)

function flattenColors(obj: Record<string, unknown>, prefix: string, out: Record<string, string>) {
  for (const [k, v] of Object.entries(obj)) {
    const name = `${prefix}-${kebab(k)}`
    if (typeof v === 'string') out[name] = v
    else flattenColors(v as Record<string, unknown>, name, out)
  }
}

/** Every token as a CSS custom property, e.g. --color-floor-grid, --space-3, --radius-md, --font-size-sm. */
export function cssVariables(t: Theme = THEME): Record<string, string> {
  const out: Record<string, string> = {}
  flattenColors(t.color, '--color', out)
  t.space.forEach((v, i) => (out[`--space-${i}`] = `${v}px`))
  for (const [k, v] of Object.entries(t.radius)) out[`--radius-${k}`] = `${v}px`
  out['--font-family'] = t.font.family
  for (const [k, v] of Object.entries(t.font.size)) out[`--font-size-${k}`] = `${v}px`
  return out
}

export function applyTheme(root: HTMLElement = document.documentElement, t: Theme = THEME) {
  for (const [k, v] of Object.entries(cssVariables(t))) root.style.setProperty(k, v)
  root.style.colorScheme = 'dark'
}

// Color math for the contrast checks in tests (WCAG relative luminance).
export function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace('#', '')
  const n = parseInt(h.length === 3 ? [...h].map((c) => c + c).join('') : h, 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}

export function luminance(hex: string): number {
  const [r, g, b] = hexToRgb(hex).map((c) => {
    const s = c / 255
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
  })
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

export function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x)
  return (hi + 0.05) / (lo + 0.05)
}

/** Straight-line distance in sRGB (0..441). Coarse, but enough to keep status colors apart. */
export function rgbDistance(a: string, b: string): number {
  const [p, q] = [hexToRgb(a), hexToRgb(b)]
  return Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2])
}
