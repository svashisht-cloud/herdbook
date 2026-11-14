import type { YardConfig } from '../yard'

// ROS map frame (x forward/east, y left/north, z up) -> Three.js (y up, -z "north").
// ROS +x -> three +x, ROS +y -> three -z. A CCW ROS yaw is then a +rotation about three's +Y.
export type Vec3 = [number, number, number]

export interface Pose3 {
  position: Vec3
  yaw: number // radians about three's +Y
}

export function rosToThree(p: { x: number; y: number; heading: number }): Pose3 {
  return { position: [p.x, 0, -p.y], yaw: p.heading }
}

/** Ground plane centre (three coords) and size [width along x, depth along z]. */
export function yardPlane(yard: YardConfig): { center: Vec3; size: [number, number] } {
  const { position } = rosToThree({
    x: yard.origin.x + yard.width / 2,
    y: yard.origin.y + yard.height / 2,
    heading: 0,
  })
  return { center: position, size: [yard.width, yard.height] }
}
