import { describe, expect, it } from 'vitest'
import { PICK_MAX_M, PICK_MIN_M, hitRadius, metresPerPixel } from './pick'

describe('hitRadius', () => {
  it('is never smaller than the status ring, up close', () => {
    expect(hitRadius(5, 45, 500)).toBe(PICK_MIN_M)
  })
  it('grows linearly with distance between the clamps', () => {
    const a = hitRadius(150, 45, 500, { minM: 0, maxM: 100 })
    const b = hitRadius(300, 45, 500, { minM: 0, maxM: 100 })
    expect(b / a).toBeCloseTo(2)
  })
  it('keeps a 28 px target at 120 m with a 45 degree field of view', () => {
    const r = hitRadius(120, 45, 450)
    expect((2 * r) / metresPerPixel(120, 45, 450)).toBeGreaterThanOrEqual(28 - 1e-9)
  })
  it('is capped so neighbours do not swallow each other', () => {
    expect(hitRadius(5000, 45, 300)).toBe(PICK_MAX_M)
  })
  it('handles a zero-size viewport', () => {
    expect(hitRadius(100, 45, 0)).toBe(PICK_MIN_M)
  })
})
