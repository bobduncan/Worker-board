// B320: draws the board's icon, public/board.ico, which the icons of a new project show: a dark tile in the page's own
// colours with three lanes (working, waiting, free), each with its worker's dot. Run it again only to change the
// icon: `node tools/make-icon.mjs`. An .ico of four PNG pictures (16, 32, 48 and 256 pixels), drawn here without any
// package: the drawing is a few rounded rectangles and circles, smoothed by drawing each pixel four by four.

import { writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { deflateSync } from 'node:zlib'

const hex = value => [1, 3, 5].map(at => parseInt(value.slice(at, at + 2), 16))
const TILE = hex('#101826')
const EDGE = hex('#202d40')
const LANES = [['#3fd27f', 0.92], ['#f6b93b', 0.7], ['#3b82f6', 0.5]].map(([colour, length]) => [hex(colour), length])

/** How much of the point (x, y) in a 1 x 1 picture each shape covers, the last on top: [r, g, b, a] or null. */
function colourAt(x, y) {
  const inRound = (left, top, right, bottom, radius) => {
    if (x < left || x > right || y < top || y > bottom) return false
    const cx = Math.min(Math.max(x, left + radius), right - radius)
    const cy = Math.min(Math.max(y, top + radius), bottom - radius)
    return (x - cx) ** 2 + (y - cy) ** 2 <= radius ** 2
  }
  let colour = null
  if (inRound(0.03, 0.03, 0.97, 0.97, 0.2)) colour = [...EDGE, 255]
  if (inRound(0.07, 0.07, 0.93, 0.93, 0.17)) colour = [...TILE, 255]
  LANES.forEach(([lane, length], at) => {
    const top = 0.22 + at * 0.21
    if ((x - 0.24) ** 2 + (y - (top + 0.065)) ** 2 <= 0.07 ** 2) colour = [...lane, 255]
    if (inRound(0.37, top + 0.025, 0.37 + 0.5 * length, top + 0.105, 0.04)) colour = [...lane, 255]
  })
  return colour
}

/** The picture at `size` pixels, as RGBA rows, each pixel the mean of 4 x 4 points. */
function draw(size) {
  const rows = []
  for (let y = 0; y < size; y += 1) {
    const row = Buffer.alloc(1 + size * 4)
    for (let x = 0; x < size; x += 1) {
      const sum = [0, 0, 0, 0]
      for (let sy = 0; sy < 4; sy += 1) {
        for (let sx = 0; sx < 4; sx += 1) {
          const colour = colourAt((x + (sx + 0.5) / 4) / size, (y + (sy + 0.5) / 4) / size)
          if (colour === null) continue
          for (let part = 0; part < 3; part += 1) sum[part] += colour[part] * colour[3]
          sum[3] += colour[3]
        }
      }
      const alpha = sum[3] / 16
      const at = 1 + x * 4
      for (let part = 0; part < 3; part += 1) row[at + part] = sum[3] === 0 ? 0 : Math.round(sum[part] / sum[3])
      row[at + 3] = Math.round(alpha)
    }
    rows.push(row)
  }
  return Buffer.concat(rows)
}

const CRC = Array.from({ length: 256 }, (_none, n) => {
  let c = n
  for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
  return c >>> 0
})
const crc = bytes => {
  let c = 0xffffffff
  for (const byte of bytes) c = CRC[(c ^ byte) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}
function chunk(type, data) {
  const head = Buffer.alloc(8)
  head.writeUInt32BE(data.length, 0)
  head.write(type, 4, 'ascii')
  const tail = Buffer.alloc(4)
  tail.writeUInt32BE(crc(Buffer.concat([head.subarray(4), data])), 0)
  return Buffer.concat([head, data, tail])
}

/** A PNG of the picture at `size`. */
function png(size) {
  const header = Buffer.alloc(13)
  header.writeUInt32BE(size, 0)
  header.writeUInt32BE(size, 4)
  header.writeUInt8(8, 8) // 8 bits a channel
  header.writeUInt8(6, 9) // RGBA
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
  return Buffer.concat([signature, chunk('IHDR', header), chunk('IDAT', deflateSync(draw(size), { level: 9 })), chunk('IEND', Buffer.alloc(0))])
}

/** An .ico holding a PNG for each size. */
function ico(sizes) {
  const pictures = sizes.map(png)
  const head = Buffer.alloc(6 + 16 * sizes.length)
  head.writeUInt16LE(0, 0)
  head.writeUInt16LE(1, 2)
  head.writeUInt16LE(sizes.length, 4)
  let offset = head.length
  sizes.forEach((size, at) => {
    const entry = 6 + at * 16
    head.writeUInt8(size >= 256 ? 0 : size, entry)
    head.writeUInt8(size >= 256 ? 0 : size, entry + 1)
    head.writeUInt16LE(1, entry + 4) // colour planes
    head.writeUInt16LE(32, entry + 6) // bits a pixel
    head.writeUInt32LE(pictures[at].length, entry + 8)
    head.writeUInt32LE(offset, entry + 12)
    offset += pictures[at].length
  })
  return Buffer.concat([head, ...pictures])
}

const board = join(dirname(fileURLToPath(import.meta.url)), '..')
writeFileSync(join(board, 'public', 'board.ico'), ico([16, 32, 48, 256]))
console.log('public/board.ico is drawn.')
