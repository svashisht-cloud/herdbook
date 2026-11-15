import { OCCUPIED, type MapGrid } from './occupancy'

// Occupied map cells as boxes for the 3D view (decisions log: 3D walls). A PGM has no heights, so every
// box gets the same height. Cells are merged into as few rectangles as possible: runs of occupied cells
// along each row, then runs with the same span in consecutive rows. A drawn floor plan becomes a few
// dozen boxes; a noisy SLAM map stays far below one box per cell.

export const WALL_HEIGHT_M = 2.5

/** Map-frame metres. */
export interface WallBox {
  x0: number
  y0: number
  x1: number
  y1: number
}

export function wallBoxes(g: MapGrid): WallBox[] {
  const boxes: WallBox[] = []
  // Open rectangles keyed by their column span "i0,i1"; the value is the first row they cover.
  let open = new Map<string, number>()
  const close = (key: string, j0: number, j1: number) => {
    const [i0, i1] = key.split(',').map(Number)
    boxes.push({
      x0: g.origin[0] + i0 * g.resolution,
      y0: g.origin[1] + j0 * g.resolution,
      x1: g.origin[0] + i1 * g.resolution,
      y1: g.origin[1] + j1 * g.resolution,
    })
  }
  for (let j = 0; j <= g.height; j++) {
    const next = new Map<string, number>()
    if (j < g.height) {
      const row = j * g.width
      let i = 0
      while (i < g.width) {
        if (g.cells[row + i] !== OCCUPIED) {
          i++
          continue
        }
        const i0 = i
        while (i < g.width && g.cells[row + i] === OCCUPIED) i++
        const key = `${i0},${i}`
        next.set(key, open.get(key) ?? j)
      }
    }
    for (const [key, j0] of open) if (!next.has(key)) close(key, j0, j)
    open = next
  }
  return boxes
}
