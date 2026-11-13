import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { yardFromMap, STAND_IN_YARD } from '../yard'
import { loadMap } from './loadMap'
import { FREE, OCCUPIED, cellAt, worldToCell, type MapGrid } from './occupancy'

// The committed default map (tools/make_default_map.py). Its marker block is in the TOP-RIGHT corner
// only, so this catches a flipped or mirrored loader.
const file = (name: string) => new Blob([readFileSync(new URL(`../../public/maps/${name}`, import.meta.url))])

const at = (g: MapGrid, x: number, y: number) => {
  const c = worldToCell(g, x, y)
  if (!c) throw new Error(`(${x}, ${y}) is off the map`)
  return cellAt(g, c[0], c[1])
}

describe('default map', async () => {
  const map = await loadMap({ yaml: file('yard.yaml'), image: file('yard.pgm') })

  it('is 100 x 60 m at 0.1 m/px from the origin, matching the stand-in yard', () => {
    expect([map.grid.width, map.grid.height]).toEqual([1000, 600])
    expect(yardFromMap(map)).toEqual(STAND_IN_YARD)
  })
  it('has its marker in the top-right corner and nowhere else', () => {
    expect(at(map.grid, 94, 54)).toBe(OCCUPIED)
    expect(at(map.grid, 6, 54)).toBe(FREE) // mirrored left-right
    expect(at(map.grid, 94, 6)).toBe(FREE) // flipped top-bottom
    expect(at(map.grid, 6, 6)).toBe(FREE)
  })
  it('has the outer wall and keeps the robot loop free', () => {
    expect(at(map.grid, 0.2, 30)).toBe(OCCUPIED)
    for (let k = 0; k < 360; k++) {
      const a = (k * Math.PI) / 180
      expect(at(map.grid, 50 + 40 * Math.cos(a), 30 + 20 * Math.sin(a))).toBe(FREE)
    }
  })
})
