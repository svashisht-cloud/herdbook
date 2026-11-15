import { gridLines, type YardConfig } from '../yard'

// What the yard map draws besides robots, all derived from the YardConfig (decisions log: Yard bounds).
// Coordinates are ROS map metres; each view maps them with its own transform.

export interface EdgeLabel {
  x: number
  y: number
  text: string
  edge: 'bottom' | 'left'
}

const fmt = (m: number) => `${Number.isInteger(m) ? m : m.toFixed(1)}`

/** Metre labels every grid step along the bottom (x) and left (y) edges, including both ends. */
export function edgeLabels(yard: YardConfig): EdgeLabel[] {
  const { x: ox, y: oy } = yard.origin
  const offsets = (len: number) => {
    const xs = gridLines(len, yard.grid)
    if (len - xs[xs.length - 1] > 1e-9) xs.push(len) // a yard that isn't a multiple of the grid still labels its far edge
    return xs
  }
  const bottom = offsets(yard.width).map((d) => ({ x: ox + d, y: oy, text: fmt(ox + d), edge: 'bottom' as const }))
  // The origin corner is already labelled on the bottom edge.
  const left = offsets(yard.height)
    .slice(1)
    .map((d) => ({ x: ox, y: oy + d, text: fmt(oy + d), edge: 'left' as const }))
  return [...bottom, ...left]
}

export interface Axes {
  length: number
  x: [[number, number], [number, number]]
  y: [[number, number], [number, number]]
}

/** Short axes at the ROS map origin (0,0): x red, y green. Half a grid cell long. */
export function axes(yard: YardConfig): Axes {
  const length = yard.grid / 2
  return { length, x: [[0, 0], [length, 0]], y: [[0, 0], [0, length]] }
}

/** One grid cell, as the scale reference. */
export function scaleHint(yard: YardConfig): { meters: number; label: string } {
  return { meters: yard.grid, label: `${fmt(yard.grid)} m` }
}

/** Space around the 2D map for edge labels and the scale bar, in metres (SVG units). */
export function mapMargin(yard: YardConfig): { left: number; right: number; top: number; bottom: number } {
  const unit = Math.max(yard.width, yard.height) / 100 // label size scales with the yard
  return { left: 6 * unit, right: 2 * unit, top: 2 * unit, bottom: 9 * unit }
}

/** Font size for map labels, in metres (SVG units / 3D sprite height). */
export function labelSize(yard: YardConfig): number {
  return (Math.max(yard.width, yard.height) / 100) * 2.2
}

/**
 * The box both map views frame, in ROS metres: the yard plus the label margins. The 2D viewBox and
 * the 3D canvas use it, so the two views have the same aspect ratio and the top-down 3D camera
 * (scene/transition.ts) lines up with the 2D map.
 */
export function mapFrame(yard: YardConfig): { minX: number; minY: number; maxX: number; maxY: number; aspect: number } {
  const m = mapMargin(yard)
  const minX = yard.origin.x - m.left
  const maxX = yard.origin.x + yard.width + m.right
  const minY = yard.origin.y - m.bottom
  const maxY = yard.origin.y + yard.height + m.top
  return { minX, minY, maxX, maxY, aspect: (maxX - minX) / (maxY - minY) }
}

/** Where edge labels sit relative to the yard edge, in metres, shared by the SVG text and the 3D sprites. */
export function labelLayout(yard: YardConfig) {
  const font = labelSize(yard)
  return {
    font, // text size (em)
    bottomBaseline: font * 1.3, // below the bottom edge, to the text baseline (SVG)
    bottomCenter: font * 0.95, // below the bottom edge, to the text's visual centre (3D sprite)
    leftGap: font * 0.6, // left of the left edge, to the text's right end
    /** Rough rendered width of a label, for centring a 3D sprite on the same spot as right-aligned SVG text. */
    width: (text: string) => text.length * font * 0.6,
  }
}
