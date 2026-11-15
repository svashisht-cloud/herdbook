import { describe, expect, it } from 'vitest'
import { STATUS_COLOR, statusColor } from './status'
import { THEME } from './theme'

describe('statusColor', () => {
  it('maps each status to its theme color', () => {
    expect(statusColor('online')).toBe(THEME.color.status.online)
    expect(statusColor('degraded')).toBe(THEME.color.status.degraded)
    expect(statusColor('offline')).toBe(THEME.color.status.offline)
  })
  it('gives each status a distinct color', () => {
    expect(new Set(Object.values(STATUS_COLOR)).size).toBe(3)
  })
})
