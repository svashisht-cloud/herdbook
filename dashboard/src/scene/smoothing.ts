// Pose smoothing for the 3D view (decisions log: 3D smoothing). Telemetry arrives at 2 Hz;
// each frame moves the drawn pose exponentially toward the latest one. Pure functions, so
// the R3F layer only calls stepPose from useFrame and writes the result to the mesh.

export interface Pose2 {
  x: number // three x
  z: number // three z
  yaw: number // radians about three's +Y
}

export const SMOOTHING_TAU_S = 0.25 // about one telemetry period
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

export function stepPose(current: Pose2 | null, target: Pose2, dt: number, tau = SMOOTHING_TAU_S): Pose2 {
  if (!current || Math.hypot(target.x - current.x, target.z - current.z) > SNAP_DISTANCE_M) {
    return { ...target }
  }
  const k = alpha(dt, tau)
  return {
    x: current.x + (target.x - current.x) * k,
    z: current.z + (target.z - current.z) * k,
    yaw: wrapAngle(current.yaw + wrapAngle(target.yaw - current.yaw) * k),
  }
}
