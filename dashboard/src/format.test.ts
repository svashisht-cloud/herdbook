import { describe, expect, it } from 'vitest'
import { ago, pct } from './format'

describe('ago', () => {
  it('picks seconds, minutes or hours', () => {
    expect(ago(-5)).toBe('0s ago')
    expect(ago(59_999)).toBe('59s ago')
    expect(ago(60_000)).toBe('1m ago')
    expect(ago(2 * 3_600_000 + 5)).toBe('2h ago')
  })
})

describe('pct', () => {
  it('rounds and handles unknown', () => {
    expect(pct(0.456)).toBe('46%')
    expect(pct(null)).toBe('—')
    expect(pct(undefined)).toBe('—')
  })
})
