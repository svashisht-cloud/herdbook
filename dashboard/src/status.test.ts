import { describe, expect, it } from 'vitest'
import { STATUS_COLOR, statusColor } from './status'

describe('statusColor', () => {
  it('maps each status to its color', () => {
    expect(statusColor('online')).toBe(STATUS_COLOR.online)
    expect(statusColor('degraded')).toBe(STATUS_COLOR.degraded)
    expect(statusColor('offline')).toBe(STATUS_COLOR.offline)
  })
  it('offline is grey and degraded is amber', () => {
    expect(statusColor('offline')).toBe('#9aa0a6')
    expect(statusColor('degraded')).toBe('#e0a000')
  })
  it('gives each status a distinct color', () => {
    expect(new Set(Object.values(STATUS_COLOR)).size).toBe(3)
  })
})
