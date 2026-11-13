import { afterEach, describe, expect, it, vi } from 'vitest'
import { loadMap, resolveImage, themeMapColors } from './loadMap'
import { OCCUPIED, cellAt } from './occupancy'

const YAML = 'image: tiny.pgm\nresolution: 2\norigin: [-1, 3, 0]\nnegate: 0\noccupied_thresh: 0.65\nfree_thresh: 0.25\n'
const PGM = new Uint8Array([...new TextEncoder().encode('P5\n2 2\n255\n'), 0, 254, 254, 254])

const response = (body: BodyInit, type = 'application/octet-stream', status = 200) =>
  new Response(body, { status, headers: { 'content-type': type } })

afterEach(() => vi.unstubAllGlobals())

describe('loadMap', () => {
  it('loads from Blobs (uploads use this path)', async () => {
    const map = await loadMap({ yaml: new Blob([YAML]), image: new Blob([PGM]) })
    expect(map.widthM).toBe(4)
    expect(map.heightM).toBe(4)
    expect(map.origin).toEqual([-1, 3])
    expect(cellAt(map.grid, 0, 1)).toBe(OCCUPIED) // image top-left -> map-frame top-left
  })
  it('loads from a URL and resolves image: relative to the yaml', async () => {
    const fetch = vi.fn(async (url: string) => (url.endsWith('.yaml') ? response(YAML, 'text/yaml') : response(PGM)))
    vi.stubGlobal('fetch', fetch)
    const map = await loadMap({ yaml: '/maps/site.yaml' })
    expect(fetch).toHaveBeenCalledWith('/maps/tiny.pgm')
    expect(map.grid.width).toBe(2)
  })
  it('reports a missing file, including a dev server answering with index.html', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => response('nope', 'text/plain', 404)))
    await expect(loadMap({ yaml: '/maps/gone.yaml' })).rejects.toThrow('Map file not found: /maps/gone.yaml (HTTP 404).')
    vi.stubGlobal('fetch', vi.fn(async () => response('<!doctype html><html></html>', 'text/html')))
    await expect(loadMap({ yaml: '/maps/gone.yaml' })).rejects.toThrow('Map file not found: /maps/gone.yaml.')
    vi.stubGlobal('fetch', vi.fn(async () => Promise.reject(new TypeError('offline'))))
    await expect(loadMap({ yaml: '/maps/gone.yaml' })).rejects.toThrow(/network error/)
  })
  it('names the image in a PGM error', async () => {
    const bad = new File([new Uint8Array([...new TextEncoder().encode('P5\n2 2\n255\n'), 1, 2])], 'site.pgm')
    await expect(loadMap({ yaml: new Blob([YAML]), image: bad })).rejects.toThrow(/^site.pgm: Image data is shorter/)
  })
  it('needs the image when the yaml is a Blob', async () => {
    await expect(loadMap({ yaml: new Blob([YAML]) })).rejects.toThrow(/without its PGM image/)
  })
})

describe('resolveImage', () => {
  it('resolves relative to the yaml URL', () => {
    expect(resolveImage('/maps/yard.yaml', 'yard.pgm')).toBe('/maps/yard.pgm')
    expect(resolveImage('/maps/yard.yaml', '../other/x.pgm')).toBe('/other/x.pgm')
    expect(resolveImage('https://example.test/m/a.yaml', 'a.pgm')).toBe('https://example.test/m/a.pgm')
  })
})

describe('themeMapColors', () => {
  it('builds opaque RGBA colors from the theme, with free matching the floor', () => {
    const c = themeMapColors()
    expect(c.free[3]).toBe(255)
    expect(c.free).not.toEqual(c.occupied)
  })
})
