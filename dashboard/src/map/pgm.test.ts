import { describe, expect, it } from 'vitest'
import { MapError } from './errors'
import { MAX_PIXELS, parsePgm } from './pgm'

const enc = (s: string) => new TextEncoder().encode(s)
const p5 = (header: string, data: number[]) => new Uint8Array([...enc(header), ...data])

describe('parsePgm', () => {
  it('parses P5 with comments in the header', () => {
    const pgm = parsePgm(p5('P5\n# a comment\n3 2 # inline\n255\n', [0, 1, 2, 3, 4, 254]))
    expect(pgm).toMatchObject({ width: 3, height: 2, maxval: 255 })
    expect([...pgm.data]).toEqual([0, 1, 2, 3, 4, 254])
  })
  it('parses P2 text, with comments between values', () => {
    const pgm = parsePgm(enc('P2\n2 2\n255\n0 255\n# row 2\n128 7\n'))
    expect([...pgm.data]).toEqual([0, 255, 128, 7])
  })
  it('scales a smaller maxval to 0..255', () => {
    const pgm = parsePgm(enc('P2 2 1 15 0 15'))
    expect([...pgm.data]).toEqual([0, 255])
  })
  it('rejects other formats with a clear message', () => {
    expect(() => parsePgm(enc('P6\n1 1\n255\n\0\0\0'))).toThrow(/Unsupported image format 'P6'/)
    expect(() => parsePgm(new Uint8Array([0x89, 0x50, 0x4e, 0x47]))).toThrow(/Unsupported image format/)
  })
  it('rejects a malformed or truncated header', () => {
    expect(() => parsePgm(enc('P5\n10'))).toThrow(/Malformed PGM header/)
    expect(() => parsePgm(enc('P5\nten 2\n255\n'))).toThrow(/width is "ten"/)
    expect(() => parsePgm(enc('P5\n0 2\n255\n'))).toThrow(/0 × 2 px/)
    expect(() => parsePgm(enc(''))).toThrow(MapError)
  })
  it('rejects 16-bit images', () => {
    expect(() => parsePgm(enc('P5\n1 1\n65535\n\0\0'))).toThrow(/maxval 65535/)
  })
  it('rejects data shorter or longer than the header says', () => {
    expect(() => parsePgm(p5('P5\n3 2\n255\n', [1, 2, 3, 4, 5]))).toThrow(/shorter than the header says: expected 6 bytes, got 5/)
    expect(() => parsePgm(p5('P5\n3 2\n255\n', [1, 2, 3, 4, 5, 6, 7]))).toThrow(/longer than the header says/)
    expect(() => parsePgm(enc('P2\n2 2\n255\n1 2 3'))).toThrow(/3 values, but the header says 2 × 2 = 4/)
  })
  it('caps absurd sizes before allocating', () => {
    expect(() => parsePgm(enc('P5\n20000 20000\n255\n'))).toThrow(/too large: 20000 × 20000/)
    const side = Math.ceil(Math.sqrt(MAX_PIXELS)) + 1
    expect(() => parsePgm(enc(`P5\n${side} ${side}\n255\n`))).toThrow(/too large/)
  })
})
