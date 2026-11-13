import { describe, expect, it } from 'vitest'
import { YARD, type YardConfig } from '../yard'
import { axes, edgeLabels, labelLayout, labelSize, mapFrame, mapMargin, scaleHint } from './yardDecor'

describe('edgeLabels', () => {
  it('labels the default yard every 10 m, 0..100 along x and 10..60 along y', () => {
    const l = edgeLabels(YARD)
    expect(l.filter((e) => e.edge === 'bottom').map((e) => e.text)).toEqual(['0', '10', '20', '30', '40', '50', '60', '70', '80', '90', '100'])
    expect(l.filter((e) => e.edge === 'left').map((e) => e.text)).toEqual(['10', '20', '30', '40', '50', '60'])
  })
  it('puts bottom labels on y = origin.y and left labels on x = origin.x', () => {
    for (const e of edgeLabels(YARD)) {
      if (e.edge === 'bottom') expect(e.y).toBe(YARD.origin.y)
      else expect(e.x).toBe(YARD.origin.x)
    }
  })
  it('includes the far edge when the size is not a multiple of the grid', () => {
    const odd: YardConfig = { width: 37, height: 22, origin: { x: 0, y: 0 }, grid: 10 }
    const l = edgeLabels(odd)
    expect(l.filter((e) => e.edge === 'bottom').map((e) => e.x)).toEqual([0, 10, 20, 30, 37])
    expect(l.filter((e) => e.edge === 'left').map((e) => e.y)).toEqual([10, 20, 22])
  })
  it('follows the origin', () => {
    const shifted: YardConfig = { width: 20, height: 10, origin: { x: -10, y: 5 }, grid: 10 }
    const l = edgeLabels(shifted)
    expect(l.filter((e) => e.edge === 'bottom').map((e) => e.text)).toEqual(['-10', '0', '10'])
    expect(l.filter((e) => e.edge === 'left').map((e) => e.text)).toEqual(['15'])
  })
})

describe('axes', () => {
  it('starts at ROS (0,0) and is half a grid cell long, x along +x and y along +y', () => {
    const a = axes(YARD)
    expect(a.length).toBe(YARD.grid / 2)
    expect(a.x).toEqual([[0, 0], [5, 0]])
    expect(a.y).toEqual([[0, 0], [0, 5]])
  })
})

describe('scale and sizes', () => {
  it('the scale hint is one grid cell', () => {
    expect(scaleHint(YARD)).toEqual({ meters: 10, label: '10 m' })
  })
  it('margins and label size scale with the yard', () => {
    const big: YardConfig = { ...YARD, width: 200, height: 120 }
    expect(mapMargin(big).bottom).toBeCloseTo(mapMargin(YARD).bottom * 2)
    expect(labelSize(big)).toBeCloseTo(labelSize(YARD) * 2)
  })
})

describe('mapFrame and labelLayout', () => {
  it('frames the yard plus margins around the origin', () => {
    const f = mapFrame(YARD)
    const m = mapMargin(YARD)
    expect(f.minX).toBeCloseTo(-m.left)
    expect(f.maxX).toBeCloseTo(YARD.width + m.right)
    expect(f.minY).toBeCloseTo(-m.bottom)
    expect(f.maxY).toBeCloseTo(YARD.height + m.top)
    expect(f.aspect).toBeCloseTo((f.maxX - f.minX) / (f.maxY - f.minY))
  })
  it('follows the origin', () => {
    const f = mapFrame({ ...YARD, origin: { x: 10, y: -5 } })
    expect(f.minX).toBeCloseTo(10 - mapMargin(YARD).left)
    expect(f.minY).toBeCloseTo(-5 - mapMargin(YARD).bottom)
  })
  it('puts labels inside the frame margins', () => {
    const l = labelLayout(YARD)
    const m = mapMargin(YARD)
    expect(l.bottomBaseline).toBeLessThan(m.bottom)
    expect(l.leftGap + l.width('60')).toBeLessThan(m.left)
  })
})
