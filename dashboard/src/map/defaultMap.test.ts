import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { yardFromMap, STAND_IN_YARD } from '../yard'
import { loadMap } from './loadMap'
import { FREE, OCCUPIED, cellAt, worldToCell, type MapGrid } from './occupancy'
import { wallBoxes } from './walls'

// The committed default map (tools/make_default_map.py, rasterized from robot/config/floor.json). Its
// marker block is in the TOP-RIGHT corner only, so this catches a flipped or mirrored loader.
const file = (name: string) => new Blob([readFileSync(new URL(`../../public/maps/${name}`, import.meta.url))])
type Rect = [number, number, number, number]
const floor = JSON.parse(new TextDecoder().decode(readFileSync(new URL('../../../robot/config/floor.json', import.meta.url)))) as {
  walls: Rect[]
  racks: Rect[]
  route: { aisle_x: number[] }
}

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
  it('has every floor.json wall and rack, with the aisles between racks free', () => {
    for (const [x0, y0, x1, y1] of [...floor.walls, ...floor.racks]) expect(at(map.grid, (x0 + x1) / 2, (y0 + y1) / 2)).toBe(OCCUPIED)
    for (const x of floor.route.aisle_x) for (let y = 14; y <= 46; y++) expect(at(map.grid, x, y)).toBe(FREE)
  })
  it('becomes one 3D box per wall and rack, plus two for the notched marker', () => {
    expect(wallBoxes(map.grid)).toHaveLength(floor.walls.length + floor.racks.length + 2)
  })
})
