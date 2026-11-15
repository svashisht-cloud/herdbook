// Click targets for robots in 3D (decisions log: 3D pick radius). A distant robot is only a few pixels
// tall, so each robot carries an invisible hit sphere sized to stay at least MIN_PX on screen.

export const PICK_MIN_PX = 28
export const PICK_MIN_M = 1.75 // never smaller than the status ring
export const PICK_MAX_M = 6 // never so big that neighbours swallow each other's clicks

/** Metres covered by one screen pixel at `distanceM` from a perspective camera. */
export function metresPerPixel(distanceM: number, fovDeg: number, viewportPx: number): number {
  if (viewportPx <= 0) return 0
  return (2 * distanceM * Math.tan((fovDeg * Math.PI) / 360)) / viewportPx
}

/** Hit-sphere radius in metres: at least minPx across on screen, clamped to [minM, maxM]. */
export function hitRadius(
  distanceM: number,
  fovDeg: number,
  viewportPx: number,
  { minPx = PICK_MIN_PX, minM = PICK_MIN_M, maxM = PICK_MAX_M } = {},
): number {
  const r = (minPx / 2) * metresPerPixel(distanceM, fovDeg, viewportPx)
  return Math.min(maxM, Math.max(minM, r))
}
