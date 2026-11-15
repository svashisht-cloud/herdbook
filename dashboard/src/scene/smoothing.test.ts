import { describe, expect, it } from 'vitest'
import { alpha, wrapAngle } from './smoothing'

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
