import { alpha } from './smoothing'
import type { Vec3 } from './transform'

// Click-to-follow camera for the 3D view (decisions log: 3D follow camera). Pure: the R3F layer reads
// the live camera and orbit target each frame, calls stepCamera, and writes the result back. Reading
// them live means the user can still orbit and zoom while following.

export const FOLLOW_DISTANCE_M = 14 // camera distance from the robot after zooming in
export const FOCUS_HEIGHT_M = 0.6 // look at the robot's body, not the floor under it
export const CAMERA_TAU_S = 0.35
export const ARRIVE_M = 1 // target close enough to the goal to stop easing (a moving robot keeps a small lag)
export const ARRIVE_DISTANCE_M = 0.2 // zoom-in is done when the camera distance is this close to FOLLOW_DISTANCE_M

/**
 * free:   the user has the camera; nothing is driven.
 * zoomIn: easing toward the selected robot at FOLLOW_DISTANCE_M, keeping the current viewing angle.
 * follow: the orbit target tracks the robot and the camera moves with it; orbit and zoom stay the user's.
 * home:   easing back to the whole-yard view, then free.
 */
export type CameraPhase = 'free' | 'zoomIn' | 'follow' | 'home'

export interface CameraView {
  position: Vec3
  target: Vec3
}

export interface CameraState extends CameraView {
  phase: CameraPhase
}

const add = (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]]
const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]]
const mul = (a: Vec3, k: number): Vec3 => [a[0] * k, a[1] * k, a[2] * k]
const len = (a: Vec3) => Math.hypot(a[0], a[1], a[2])
const lerp = (a: Vec3, b: Vec3, k: number): Vec3 => add(a, mul(sub(b, a), k))

/** The whole-yard view: above and south of the yard centre, looking at it. */
export function homeView(center: Vec3, span: number): CameraView {
  return { position: [center[0], span * 0.55, center[2] + span * 0.5], target: center }
}

/** A close view of `focus` from the same direction the camera looks now. */
export function followView(current: CameraView, focus: Vec3, distance = FOLLOW_DISTANCE_M): CameraView {
  const d = sub(current.position, current.target)
  const n = len(d)
  const dir: Vec3 = n > 1e-6 ? mul(d, 1 / n) : [0, Math.SQRT1_2, Math.SQRT1_2]
  return { position: add(focus, mul(dir, distance)), target: focus }
}

function arrived(s: CameraView, goal: CameraView): boolean {
  return len(sub(s.position, goal.position)) < ARRIVE_M && len(sub(s.target, goal.target)) < ARRIVE_M
}

/** focus: the selected robot's point to look at, or null for none. */
export function stepCamera(s: CameraState, focus: Vec3 | null, home: CameraView, dt: number, tau = CAMERA_TAU_S): CameraState {
  const k = alpha(dt, tau)
  if (focus) {
    if (s.phase === 'follow') {
      // Move the camera by exactly as much as the target moves, so the user's orbit and zoom are kept.
      const target = lerp(s.target, focus, k)
      return { position: add(s.position, sub(target, s.target)), target, phase: 'follow' }
    }
    const goal = followView(s, focus)
    const next = { position: lerp(s.position, goal.position, k), target: lerp(s.target, goal.target, k) }
    const zoomed = Math.abs(len(sub(next.position, next.target)) - FOLLOW_DISTANCE_M) < ARRIVE_DISTANCE_M
    return { ...next, phase: zoomed && len(sub(next.target, focus)) < ARRIVE_M ? 'follow' : 'zoomIn' }
  }
  if (s.phase === 'free') return s
  const next = { position: lerp(s.position, home.position, k), target: lerp(s.target, home.target, k) }
  return { ...next, phase: arrived(next, home) ? 'free' : 'home' }
}
