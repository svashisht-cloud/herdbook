import { describe, expect, it } from 'vitest'
import { STAND_IN_YARD, gridLines, niceGridStep, yardFromMap } from './yard'

describe('niceGridStep', () => {
  it('gives about ten 1/2/5 x 10^n cells', () => {
    expect(niceGridStep(100)).toBe(10)
    expect(niceGridStep(50)).toBe(5)
    expect(niceGridStep(120)).toBe(10)
    expect(niceGridStep(30)).toBe(2)
    expect(niceGridStep(400)).toBe(50)
    expect(niceGridStep(7)).toBeCloseTo(0.5)
  })
  it('handles a degenerate extent', () => {
    expect(niceGridStep(0)).toBe(1)
  })
})

describe('yardFromMap', () => {
  it('sizes the yard from pixels * resolution, starting at the map origin', () => {
    expect(yardFromMap({ widthM: 1000 * 0.1, heightM: 600 * 0.1, origin: [0, 0] })).toEqual(STAND_IN_YARD)
    const y = yardFromMap({ widthM: 50, heightM: 30, origin: [-5, 2.5] })
    expect(y).toEqual({ width: 50, height: 30, origin: { x: -5, y: 2.5 }, grid: 5 })
  })
})

describe('gridLines', () => {
  it('includes both ends and survives float steps', () => {
    expect(gridLines(100, 10)).toHaveLength(11)
    expect(gridLines(0.6, 0.2)).toHaveLength(4)
  })
})
