import { describe, expect, it } from 'vitest'
import { robotGlyph, svgRotation } from './glyph'

describe('robotGlyph', () => {
  const g = robotGlyph()
  it('has a positive body, longer than it is wide', () => {
    expect(g.body.w).toBeGreaterThan(g.body.h)
    expect(g.body.h).toBeGreaterThan(0)
  })
  it('has 6 wheels, mirrored about the centreline and outside the body sides', () => {
    expect(g.wheels).toHaveLength(6)
    const left = g.wheels.filter((w) => w.y > 0)
    const right = g.wheels.filter((w) => w.y < 0)
    expect(left.map((w) => w.x)).toEqual(right.map((w) => w.x))
    left.forEach((w, i) => expect(w.y).toBeCloseTo(-right[i].y))
    for (const w of g.wheels) expect(Math.abs(w.y) - w.h / 2).toBeGreaterThanOrEqual(g.body.h / 2 - 1e-9)
  })
  it('has a nose that points along +x, inside the body', () => {
    const tip = g.nose.reduce((a, b) => (b[0] > a[0] ? b : a))
    expect(tip[1]).toBe(0)
    expect(tip[0]).toBeGreaterThan(0)
    expect(tip[0]).toBeLessThanOrEqual(g.body.w / 2)
  })
})

describe('svgRotation', () => {
  it('turns a CCW ROS heading into a negative SVG rotation', () => {
    expect(svgRotation(0)).toBeCloseTo(0)
    expect(svgRotation(Math.PI / 2)).toBeCloseTo(-90)
  })
})
