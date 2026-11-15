// Top-down robot shape for the 2D map (decisions log: 2D robot glyph): a body, 6 wheels (matching the
// 6-wheel rover model) and a nose triangle. Robot frame: x forward, y left, metres. Slightly larger
// than the 3D rover so it reads at map scale.

export interface Rect {
  x: number // centre
  y: number
  w: number // along x
  h: number // along y
}

export interface Glyph {
  body: Rect
  wheels: Rect[]
  nose: [number, number][] // triangle, robot frame
}

export const GLYPH_LENGTH_M = 3.6
export const GLYPH_WIDTH_M = 2.2
const WHEELS_PER_SIDE = 3

export function robotGlyph(length = GLYPH_LENGTH_M, width = GLYPH_WIDTH_M): Glyph {
  const wheel = { w: length * 0.2, h: width * 0.2 }
  const sideY = width / 2 + wheel.h / 2 // wheels sit just outside the body's sides
  const xs = Array.from({ length: WHEELS_PER_SIDE }, (_, i) => -length * 0.33 + (i * length * 0.66) / (WHEELS_PER_SIDE - 1))
  const wheels = xs.flatMap((x) => [
    { x, y: sideY, ...wheel },
    { x, y: -sideY, ...wheel },
  ])
  const tip = length / 2
  const nose: [number, number][] = [
    [tip - length * 0.28, width * 0.28],
    [tip - length * 0.06, 0],
    [tip - length * 0.28, -width * 0.28],
  ]
  return { body: { x: 0, y: 0, w: length, h: width }, wheels, nose }
}

/** SVG rotation in degrees for a ROS heading (CCW radians); negated because SVG y points down. */
export function svgRotation(heading: number): number {
  return (-heading * 180) / Math.PI
}
