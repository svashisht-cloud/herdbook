import { describe, expect, it } from 'vitest'
import { THEME, contrast, cssVariables, hexToRgb, rgbDistance } from './theme'

const { color } = THEME
const statuses = Object.entries(color.status)

describe('cssVariables', () => {
  const vars = cssVariables()
  it('emits every color token, including nested ones', () => {
    expect(vars['--color-bg']).toBe(color.bg)
    expect(vars['--color-floor-grid']).toBe(color.floorGrid)
    expect(vars['--color-status-online']).toBe(color.status.online)
    expect(vars['--color-incident-ready']).toBe(color.incident.ready)
  })
  it('emits spacing, radius and font tokens with units', () => {
    THEME.space.forEach((v, i) => expect(vars[`--space-${i}`]).toBe(`${v}px`))
    expect(vars['--radius-md']).toBe(`${THEME.radius.md}px`)
    expect(vars['--font-size-sm']).toBe(`${THEME.font.size.sm}px`)
  })
})

describe('hexToRgb', () => {
  it('parses long and short hex', () => {
    expect(hexToRgb('#ff8000')).toEqual([255, 128, 0])
    expect(hexToRgb('#fff')).toEqual([255, 255, 255])
  })
})

describe('dark theme stays readable', () => {
  it('status colors stand out on the floor and on panels (>= 3:1)', () => {
    for (const [, c] of statuses) {
      expect(contrast(c, color.floor)).toBeGreaterThanOrEqual(3)
      expect(contrast(c, color.surface)).toBeGreaterThanOrEqual(3)
    }
  })
  it('offline, degraded and online are far apart from each other', () => {
    for (let i = 0; i < statuses.length; i++)
      for (let j = i + 1; j < statuses.length; j++)
        expect(rgbDistance(statuses[i][1], statuses[j][1])).toBeGreaterThan(80)
  })
  it('body text and muted text are readable on every surface', () => {
    for (const bg of [color.bg, color.surface, color.floor]) {
      expect(contrast(color.text, bg)).toBeGreaterThanOrEqual(4.5)
      expect(contrast(color.textMuted, bg)).toBeGreaterThanOrEqual(3)
    }
  })
  it('the floor reads as a place against the background, and the boundary against the floor', () => {
    expect(contrast(color.floor, color.bg)).toBeGreaterThan(1.15)
    expect(contrast(color.floorBoundary, color.floor)).toBeGreaterThanOrEqual(3)
  })
})
