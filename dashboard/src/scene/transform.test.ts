import { describe, expect, it } from 'vitest'
import { STAND_IN_YARD } from '../yard'
import { rosToThree, yardPlane } from './transform'

describe('rosToThree', () => {
  it('keeps the origin at the origin', () => {
    const p = rosToThree({ x: 0, y: 0, heading: 0 })
    expect(p.position[0]).toBeCloseTo(0)
    expect(p.position[1]).toBeCloseTo(0)
    expect(p.position[2]).toBeCloseTo(0)
    expect(p.yaw).toBe(0)
  })
  it('maps (x, y) to (x, 0, -y)', () => {
    expect(rosToThree({ x: 10, y: 20, heading: 0 }).position).toEqual([10, 0, -20])
  })
  it('keeps heading as yaw about +Y', () => {
    expect(rosToThree({ x: 0, y: 0, heading: Math.PI / 2 }).yaw).toBeCloseTo(Math.PI / 2)
  })
  it('a +yaw about three +Y turns +x toward -z, i.e. ROS +x toward ROS +y', () => {
    // Rotating (1, 0, 0) by yaw about +Y gives (cos yaw, 0, -sin yaw).
    const yaw = rosToThree({ x: 0, y: 0, heading: Math.PI / 2 }).yaw
    const dir = [Math.cos(yaw), 0, -Math.sin(yaw)]
    const rosY = rosToThree({ x: 0, y: 1, heading: 0 }).position
    expect(dir[0]).toBeCloseTo(rosY[0])
    expect(dir[2]).toBeCloseTo(rosY[2])
  })
})

describe('yardPlane', () => {
  it('centres the default yard at (50, 0, -30) with size 100 x 60', () => {
    expect(yardPlane(STAND_IN_YARD)).toEqual({ center: [50, 0, -30], size: [100, 60] })
  })
  it('follows the origin', () => {
    const p = yardPlane({ width: 20, height: 10, origin: { x: -5, y: 3 }, grid: 5 })
    expect(p.center).toEqual([5, 0, -8])
    expect(p.size).toEqual([20, 10])
  })
})
