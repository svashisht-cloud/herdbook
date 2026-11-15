// Shared motion helpers. Robots are placed by interpolation (scene/interpolate.ts, decisions log: Pose
// interpolation); the exponential `alpha` eases the follow camera, and SNAP_DISTANCE_M is the one rule for
// "this jump is a restart or teleport, not motion" (interpolation, trails).

export interface Pose2 {
  x: number // three x
  z: number // three z
  yaw: number // radians about three's +Y
}

export const SMOOTHING_TAU_S = 0.25 // default time constant for alpha()
export const SNAP_DISTANCE_M = 10 // a jump this big is a restart or teleport, not motion

/** Fraction of the remaining gap to close in dt seconds. Frame-rate independent. */
export function alpha(dt: number, tau = SMOOTHING_TAU_S): number {
  if (dt <= 0) return 0
  return 1 - Math.exp(-dt / tau)
}

/** Wrap an angle to (-pi, pi]. */
export function wrapAngle(a: number): number {
  const w = a - 2 * Math.PI * Math.floor((a + Math.PI) / (2 * Math.PI))
  return w === -Math.PI ? Math.PI : w
}
