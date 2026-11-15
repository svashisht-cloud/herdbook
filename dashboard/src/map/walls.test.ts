import { describe, expect, it } from 'vitest'
import { FREE, OCCUPIED, type MapGrid } from './occupancy'
import { wallBoxes } from './walls'

/** Rows given top row first (as drawn), '#' occupied, '.' free, '?' unknown. */
function grid(rows: string[], resolution = 1, origin: [number, number] = [0, 0]): MapGrid {
  const height = rows.length
  const width = rows[0].length
  const cells = new Uint8Array(width * height)
  rows.forEach((r, row) => {
    const j = height - 1 - row
    for (let i = 0; i < width; i++) cells[j * width + i] = r[i] === '#' ? OCCUPIED : r[i] === '.' ? FREE : 2
  })
  return { width, height, resolution, origin, cells }
}

const area = (bs: ReturnType<typeof wallBoxes>) => bs.reduce((a, b) => a + (b.x1 - b.x0) * (b.y1 - b.y0), 0)

describe('wallBoxes', () => {
  it('returns nothing for an empty map', () => {
    expect(wallBoxes(grid(['...', '...']))).toEqual([])
  })
  it('merges a solid block into one box, in map-frame metres', () => {
    const g = grid(['.....', '.###.', '.###.', '.....'], 0.5, [10, 20])
    expect(wallBoxes(g)).toEqual([{ x0: 10.5, y0: 20.5, x1: 12, y1: 21.5 }])
  })
  it('keeps the bottom row at the bottom (map frame, not image order)', () => {
    const [b] = wallBoxes(grid(['....', '....', '##..']))
    expect(b).toEqual({ x0: 0, y0: 0, x1: 2, y1: 1 })
  })
  it('splits separate runs and changing spans, covering exactly the occupied cells', () => {
    // An L shape plus a separate pillar: rows with different spans can't share a box.
    const g = grid(['#...#', '#....', '###..'])
    const boxes = wallBoxes(g)
    expect(area(boxes)).toBe(6)
    expect(boxes).toContainEqual({ x0: 4, y0: 2, x1: 5, y1: 3 })
    expect(boxes).toContainEqual({ x0: 0, y0: 0, x1: 3, y1: 1 })
    expect(boxes).toContainEqual({ x0: 0, y0: 1, x1: 1, y1: 3 })
  })
  it('ignores unknown cells', () => {
    expect(wallBoxes(grid(['???', '?#?']))).toEqual([{ x0: 1, y0: 0, x1: 2, y1: 1 }])
  })
  it('closes boxes that reach the top edge', () => {
    expect(wallBoxes(grid(['##', '##']))).toEqual([{ x0: 0, y0: 0, x1: 2, y1: 2 }])
  })
})
