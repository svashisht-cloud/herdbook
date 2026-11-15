import { describe, expect, it } from 'vitest'
import { DEFAULT_ROUTE, formatRoute, parseRoute, type Route } from './route'

describe('parseRoute', () => {
  it('reads page, view and robot', () => {
    expect(parseRoute('#/map?view=3d&robot=robot2')).toEqual({ page: 'map', view: '3d', robot: 'robot2' })
    expect(parseRoute('#/incidents')).toEqual({ page: 'incidents', view: '2d', robot: null })
  })
  it('falls back to the default for empty or unknown input', () => {
    expect(parseRoute('')).toEqual(DEFAULT_ROUTE)
    expect(parseRoute('#/')).toEqual(DEFAULT_ROUTE)
    expect(parseRoute('#/nope?view=4d')).toEqual(DEFAULT_ROUTE)
  })
  it('accepts a hash without the leading slash', () => {
    expect(parseRoute('#robots?robot=robot1')).toEqual({ page: 'robots', view: '2d', robot: 'robot1' })
  })
})

describe('formatRoute', () => {
  it('writes only non-default params', () => {
    expect(formatRoute(DEFAULT_ROUTE)).toBe('#/map')
    expect(formatRoute({ page: 'logs', view: '2d', robot: null })).toBe('#/logs')
    expect(formatRoute({ page: 'map', view: '3d', robot: 'robot2' })).toBe('#/map?view=3d&robot=robot2')
  })
  it('round-trips through parseRoute', () => {
    const routes: Route[] = [
      { page: 'map', view: '3d', robot: null },
      { page: 'robots', view: '2d', robot: 'robot 4' },
      { page: 'incidents', view: '3d', robot: 'robot1' },
    ]
    for (const r of routes) expect(parseRoute(formatRoute(r))).toEqual(r)
  })
})
