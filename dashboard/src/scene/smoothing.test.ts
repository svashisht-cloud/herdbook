import { describe, expect, it } from 'vitest'
import { SNAP_DISTANCE_M, alpha, stepPose, wrapAngle, type Pose2 } from './smoothing'

describe('alpha', () => {
  it('is 0 for no time and stays below 1', () => {
    expect(alpha(0)).toBe(0)
    expect(alpha(-1)).toBe(0)
    expect(alpha(1000)).toBeLessThanOrEqual(1)
    expect(alpha(0.5)).toBeLessThan(1)
  })
  it('grows with dt', () => {
    expect(alpha(0.1)).toBeGreaterThan(alpha(0.05))
  })
})

describe('wrapAngle', () => {
  it('wraps into (-pi, pi]', () => {
    expect(wrapAngle(3 * Math.PI)).toBeCloseTo(Math.PI)
    expect(wrapAngle(-Math.PI)).toBeCloseTo(Math.PI)
    expect(wrapAngle(2 * Math.PI + 0.5)).toBeCloseTo(0.5)
    expect(wrapAngle(-0.5)).toBeCloseTo(-0.5)
  })
})

describe('stepPose', () => {
  const target: Pose2 = { x: 5, z: -5, yaw: 1 }

  it('snaps on the first pose', () => {
    expect(stepPose(null, target, 0.016)).toEqual(target)
  })
  it('snaps on a jump bigger than the snap distance', () => {
    const far: Pose2 = { x: target.x + SNAP_DISTANCE_M + 1, z: target.z, yaw: 0 }
    expect(stepPose(far, target, 0.016)).toEqual(target)
  })
  it('moves part of the way, then converges', () => {
    let p: Pose2 = { x: 0, z: 0, yaw: 0 }
    const once = stepPose(p, target, 0.016)
    expect(once.x).toBeGreaterThan(0)
    expect(once.x).toBeLessThan(target.x)
    for (let i = 0; i < 300; i++) p = stepPose(p, target, 0.016)
    expect(p.x).toBeCloseTo(target.x, 3)
    expect(p.z).toBeCloseTo(target.z, 3)
    expect(p.yaw).toBeCloseTo(target.yaw, 3)
  })
  it('turns the short way across +-pi', () => {
    const p = stepPose({ x: 0, z: 0, yaw: 3.1 }, { x: 0, z: 0, yaw: -3.1 }, 0.05)
    // The short way from 3.1 to -3.1 goes up through pi, never down through 0.
    expect(Math.abs(p.yaw)).toBeGreaterThan(3.1)
  })
  it('is frame-rate independent', () => {
    const start: Pose2 = { x: 0, z: 0, yaw: 0 }
    const one = stepPose(start, target, 0.1)
    const two = stepPose(stepPose(start, target, 0.05), target, 0.05)
    expect(two.x).toBeCloseTo(one.x, 10)
    expect(two.z).toBeCloseTo(one.z, 10)
    expect(two.yaw).toBeCloseTo(one.yaw, 10)
  })
})
