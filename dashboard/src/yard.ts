// The one place yard bounds live (decisions log: Yard bounds). Both the 2D map and the 3D view
// read this. Units are metres in the ROS map frame; origin is the yard's bottom-left corner.
export interface YardConfig {
  width: number
  height: number
  origin: { x: number; y: number }
  grid: number // grid line spacing
}

export const YARD: YardConfig = {
  width: 100,
  height: 60,
  origin: { x: 0, y: 0 },
  grid: 10,
}

/** Grid line offsets from the origin along one axis, 0..length inclusive. */
export function gridLines(length: number, step: number): number[] {
  const n = Math.floor(length / step)
  return Array.from({ length: n + 1 }, (_, i) => i * step)
}
