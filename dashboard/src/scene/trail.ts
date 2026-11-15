import { SNAP_DISTANCE_M } from './smoothing'

// Trail buffer for one robot (decisions log: Trails). Pure: the caller keeps the array in a ref.
// Points are ROS metres plus the browser time they arrived; using arrival time (not the robot's ts)
// means trails keep fading while a robot is silent, and clock skew can't matter.

export const TRAIL_WINDOW_MS = 30_000
export const TRAIL_MAX_POINTS = 120 // 2 Hz x 30 s = 60, doubled for headroom
// Fade time constant: ~37% at 5 s, ~5% at 15 s. Robots share a loop, so a trail must be faint by the
// time the next robot drives over it, or it reads as that robot's own path.
export const TRAIL_FADE_TAU_MS = 5_000

export interface TrailPoint {
  x: number
  y: number
  t: number // browser time, ms
  breakBefore: boolean // true: don't draw a segment from the previous point (a jump)
}

export interface TrailSegment {
  a: TrailPoint
  b: TrailPoint
  fade: number // 1 = new, 0 = at the end of the window
}

/** Drop points older than the window, then cap the length (oldest go first). */
export function prune(buf: readonly TrailPoint[], now: number): TrailPoint[] {
  const cutoff = now - TRAIL_WINDOW_MS
  let start = 0
  while (start < buf.length && buf[start].t < cutoff) start++
  start = Math.max(start, buf.length - TRAIL_MAX_POINTS)
  return buf.slice(start)
}

/** Append a point. A jump over SNAP_DISTANCE_M (the same rule that snaps the 3D pose) breaks the trail. */
export function addPoint(buf: readonly TrailPoint[], p: { x: number; y: number }, now: number): TrailPoint[] {
  const last = buf[buf.length - 1]
  if (last && last.x === p.x && last.y === p.y) return prune(buf, now)
  const breakBefore = !!last && Math.hypot(p.x - last.x, p.y - last.y) > SNAP_DISTANCE_M
  return prune([...buf, { x: p.x, y: p.y, t: now, breakBefore }], now)
}

/** 1 for a new point, falling exponentially with age, and 0 from the end of the window. */
export function fadeAt(t: number, now: number): number {
  const age = Math.max(0, now - t)
  if (age >= TRAIL_WINDOW_MS) return 0
  return Math.exp(-age / TRAIL_FADE_TAU_MS)
}

/** Drawable segments between consecutive points, skipping breaks. Fade follows the newer end. */
export function segments(buf: readonly TrailPoint[], now: number): TrailSegment[] {
  const out: TrailSegment[] = []
  for (let i = 1; i < buf.length; i++) {
    const b = buf[i]
    if (b.breakBefore) continue
    const fade = fadeAt(b.t, now)
    if (fade > 0) out.push({ a: buf[i - 1], b, fade })
  }
  return out
}
