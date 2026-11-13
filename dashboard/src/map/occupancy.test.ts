import { describe, expect, it } from 'vitest'
import { FREE, OCCUPIED, UNKNOWN, cellAt, classify, toMapGrid, toRgba, toRgbaTopFirst, worldToCell, type MapColors } from './occupancy'
import { parsePgm } from './pgm'
import type { MapYaml } from './yaml'

const meta: MapYaml = { image: 'x', resolution: 0.5, origin: [10, 20], negate: false, occupiedThresh: 0.65, freeThresh: 0.25, warnings: [] }

describe('classify (map_server trinary)', () => {
  it('dark is occupied, light is free, mid grey is unknown', () => {
    expect(classify(0, meta)).toBe(OCCUPIED)
    expect(classify(254, meta)).toBe(FREE)
    expect(classify(128, meta)).toBe(UNKNOWN) // p = 0.5, between the thresholds
  })
  it('uses strict thresholds', () => {
    // p = (255 - v) / 255; occupied if p > 0.65, free if p < 0.25
    expect(classify(Math.floor(255 * 0.35) - 1, meta)).toBe(OCCUPIED)
    expect(classify(Math.ceil(255 * 0.75) + 1, meta)).toBe(FREE)
  })
  it('negate flips the meaning of the pixel', () => {
    const neg = { ...meta, negate: true }
    expect(classify(0, neg)).toBe(FREE)
    expect(classify(255, neg)).toBe(OCCUPIED)
  })
})

describe('toMapGrid flips the image into the map frame', () => {
  // 3 x 2 image, top row first. Only the TOP-LEFT pixel is black: an asymmetric marker.
  const pgm = parsePgm(new Uint8Array([...new TextEncoder().encode('P5 3 2 255\n'), 0, 254, 254, 254, 254, 254]))
  const g = toMapGrid(pgm, meta)

  it('puts the image top-left pixel at the map-frame top-left cell (highest j)', () => {
    expect(cellAt(g, 0, 1)).toBe(OCCUPIED)
    expect(cellAt(g, 0, 0)).toBe(FREE)
    expect(cellAt(g, 2, 1)).toBe(FREE)
  })
  it('maps a world position to its cell via origin + cell * resolution', () => {
    expect(worldToCell(g, 10.1, 20.6)).toEqual([0, 1]) // the marker
    expect(worldToCell(g, 11.4, 20.2)).toEqual([2, 0])
    expect(worldToCell(g, 9.9, 20.2)).toBeNull()
    expect(worldToCell(g, 11.6, 20.2)).toBeNull()
  })

  const colors: MapColors = { free: [1, 1, 1, 255], occupied: [9, 9, 9, 255], unknown: [5, 5, 5, 255] }
  it('toRgba is bottom row first (DataTexture order); toRgbaTopFirst is image order', () => {
    const bottom = toRgba(g, colors)
    const top = toRgbaTopFirst(g, colors)
    // marker cell (0, 1): bottom-first index row 1 -> 3*4; top-first index row 0 -> 0
    expect([...bottom.subarray(12, 16)]).toEqual(colors.occupied)
    expect([...top.subarray(0, 4)]).toEqual(colors.occupied)
    expect([...top.subarray(12, 16)]).toEqual(colors.free)
  })
})
