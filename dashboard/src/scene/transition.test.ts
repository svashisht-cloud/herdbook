import { describe, expect, it } from 'vitest'
import { STAND_IN_YARD } from '../yard'
import { POP_MIN, easeInOutCubic, lerpView, popScale, progress, topDownView } from './transition'
import { mapFrame } from './yardDecor'

describe('easing', () => {
  it('easeInOutCubic goes 0 -> 1 and never decreases', () => {
    expect(easeInOutCubic(0)).toBe(0)
    expect(easeInOutCubic(1)).toBe(1)
    let prev = -1
    for (let t = 0; t <= 1; t += 0.05) {
      expect(easeInOutCubic(t)).toBeGreaterThanOrEqual(prev)
      prev = easeInOutCubic(t)
    }
  })
  it('popScale starts flat and ends at exactly 1, with a small overshoot on the way', () => {
    expect(popScale(0)).toBe(POP_MIN)
    expect(popScale(0.3)).toBe(POP_MIN)
    expect(popScale(1)).toBe(1)
    const peak = Math.max(...Array.from({ length: 101 }, (_, i) => popScale(i / 100)))
    expect(peak).toBeGreaterThan(1)
    expect(peak).toBeLessThan(1.15)
  })
})

describe('progress', () => {
  it('runs 0..1 over the duration and clamps', () => {
    expect(progress(0, 1000)).toBe(0)
    expect(progress(500, 1000)).toBe(0.5)
    expect(progress(2000, 1000)).toBe(1)
  })
  it('finishes at once with a zero duration (reduced motion)', () => {
    expect(progress(0, 0)).toBe(1)
  })
})

describe('lerpView', () => {
  const a = { position: [0, 10, 0] as [number, number, number], target: [0, 0, 0] as [number, number, number] }
  const b = { position: [10, 20, 30] as [number, number, number], target: [5, 0, -5] as [number, number, number] }
  it('hits both endpoints', () => {
    expect(lerpView(a, b, 0)).toEqual(a)
    expect(lerpView(a, b, 1)).toEqual(b)
  })
})

describe('topDownView', () => {
  const fov = 45
  const f = mapFrame(STAND_IN_YARD)
  const v = topDownView(STAND_IN_YARD, f.aspect, fov)

  it('looks (almost) straight down at the centre of the 2D map frame', () => {
    const dx = v.position[0] - v.target[0]
    const dz = v.position[2] - v.target[2]
    expect(Math.atan2(Math.hypot(dx, dz), v.position[1])).toBeLessThan(1e-3)
    expect(v.target[0]).toBeCloseTo((f.minX + f.maxX) / 2)
    expect(v.target[2]).toBeCloseTo(-(f.minY + f.maxY) / 2)
  })
  it('is tilted south, so screen-up is ROS +y (three -z)', () => {
    expect(v.position[2]).toBeGreaterThan(v.target[2])
  })
  it('fits the frame exactly when the canvas has the frame aspect', () => {
    const halfH = (v.position[1]) * Math.tan((fov * Math.PI) / 360)
    expect(halfH).toBeCloseTo((f.maxY - f.minY) / 2)
  })
  it('backs off further for a canvas narrower than the frame, so the width still fits', () => {
    const narrow = topDownView(STAND_IN_YARD, f.aspect / 2, fov)
    const halfW = narrow.position[1] * Math.tan((fov * Math.PI) / 360) * (f.aspect / 2)
    expect(halfW).toBeCloseTo((f.maxX - f.minX) / 2)
    expect(narrow.position[1]).toBeGreaterThan(v.position[1])
  })
})
