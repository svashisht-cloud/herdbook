import type { CameraView } from './camera'
import type { Vec3 } from './transform'
import { mapFrame } from './yardDecor'
import type { YardConfig } from '../yard'

// The animated 2D<->3D switch (decisions log: View transition). Entering 3D, the camera starts straight
// above the yard, framed exactly like the 2D map, then flies to the perspective home view while the
// robots pop up; leaving 3D runs it in reverse. Pure: the R3F layer feeds elapsed time and writes back.

export const INTRO_MS = 1200
export const OUTRO_MS = 900

export const easeInOutCubic = (t: number) => (t < 0.5 ? 4 * t ** 3 : 1 - (-2 * t + 2) ** 3 / 2)

const easeOutBack = (t: number) => {
  const c1 = 1.70158
  const c3 = c1 + 1
  return 1 + c3 * (t - 1) ** 3 + c1 * (t - 1) ** 2
}

export const POP_MIN = 0.05 // robots are this flat while the camera is overhead
const POP_START = 0.35

/** Robot height scale over the transition: flat at first, then an ease-out-back pop (slight overshoot) to 1. */
export function popScale(t: number): number {
  if (t <= POP_START) return POP_MIN
  if (t >= 1) return 1
  return POP_MIN + (1 - POP_MIN) * easeOutBack((t - POP_START) / (1 - POP_START))
}

/** 0..1 progress; a zero duration (reduced motion) finishes at once. */
export function progress(elapsedMs: number, durationMs: number): number {
  if (durationMs <= 0) return 1
  return Math.min(1, Math.max(0, elapsedMs / durationMs))
}

const lerp3 = (a: Vec3, b: Vec3, k: number): Vec3 => [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k]

export function lerpView(a: CameraView, b: CameraView, k: number): CameraView {
  return { position: lerp3(a.position, b.position, k), target: lerp3(a.target, b.target, k) }
}

/** Offset south (three +z) so the camera isn't exactly overhead: screen-up stays ROS +y, and OrbitControls
 *  avoids its degenerate straight-down case. */
export const TOP_DOWN_TILT_M = 0.001

/**
 * A camera straight above the 2D map's frame (yard + label margins, from mapFrame), at the height where
 * that frame fills a canvas of the same aspect. A flat floor seen straight on has no perspective
 * distortion, so this matches the 2D map.
 */
export function topDownView(yard: YardConfig, aspect: number, fovDeg: number): CameraView {
  const f = mapFrame(yard)
  const cx = (f.minX + f.maxX) / 2
  const cy = (f.minY + f.maxY) / 2
  const halfH = (f.maxY - f.minY) / 2
  const halfW = (f.maxX - f.minX) / 2
  const t = Math.tan((fovDeg * Math.PI) / 360)
  const height = Math.max(halfH, halfW / aspect) / t
  return { position: [cx, height, -cy + TOP_DOWN_TILT_M], target: [cx, 0, -cy] }
}
