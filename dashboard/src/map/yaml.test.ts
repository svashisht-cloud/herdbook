import { describe, expect, it } from 'vitest'
import { parseFlatYaml, parseMapYaml } from './yaml'

const DEFAULT = `image: yard.pgm
resolution: 0.1
origin: [0, 0, 0]
negate: 0
occupied_thresh: 0.65
free_thresh: 0.25
`

describe('parseMapYaml', () => {
  it('parses the default map yaml', () => {
    expect(parseMapYaml(DEFAULT)).toEqual({
      image: 'yard.pgm',
      resolution: 0.1,
      origin: [0, 0],
      negate: false,
      occupiedThresh: 0.65,
      freeThresh: 0.25,
      warnings: [],
    })
  })
  it('accepts a block-list origin, comments, quotes and unknown keys', () => {
    const y = parseMapYaml(`# saved by map_saver
image: "my map.pgm"   # quoted, with a space
mode: trinary
resolution: 0.05
origin:
  - -10.5
  - 4
  - 0.0
negate: 1
occupied_thresh: 0.65
free_thresh: 0.196
`)
    expect(y.image).toBe('my map.pgm')
    expect(y.origin).toEqual([-10.5, 4])
    expect(y.negate).toBe(true)
  })
  it('warns about and ignores a nonzero yaw', () => {
    const y = parseMapYaml(DEFAULT.replace('[0, 0, 0]', '[1, 2, 0.3]'))
    expect(y.origin).toEqual([1, 2])
    expect(y.warnings[0]).toMatch(/yaw 0.3 rad .* ignored/)
  })
  it('gives clear errors for missing or bad fields', () => {
    expect(() => parseMapYaml(DEFAULT.replace('image: yard.pgm\n', ''))).toThrow(/"image" .* is missing/)
    expect(() => parseMapYaml(DEFAULT.replace('resolution: 0.1', 'resolution: 0'))).toThrow(/positive number/)
    expect(() => parseMapYaml(DEFAULT.replace('resolution: 0.1', 'resolution: -1'))).toThrow(/positive number/)
    expect(() => parseMapYaml(DEFAULT.replace('resolution: 0.1\n', ''))).toThrow(/"resolution" must be a number, and it is missing/)
    expect(() => parseMapYaml(DEFAULT.replace('free_thresh: 0.25', 'free_thresh: 0.7'))).toThrow(/must be below/)
    expect(() => parseMapYaml(DEFAULT.replace('[0, 0, 0]', '[0]'))).toThrow(/origin/)
  })
  it('rejects YAML outside the supported subset, with the line number', () => {
    expect(() => parseFlatYaml('image: a.pgm\nmeta:\n  nested: 1\n')).toThrow(/line 3/)
    expect(() => parseFlatYaml('origin: [0, 0,\n  0]')).toThrow(/line 1/)
    expect(() => parseFlatYaml('ref: *anchor')).toThrow(/line 1/)
  })
})
