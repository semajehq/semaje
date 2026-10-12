// Rasterize the semaje icon (teal tile + sound-wave bars) to PNG at any size.
// Pure Node (zlib only) so the build has zero dependencies and icons are not
// committed as binaries.
import { deflateSync, crc32 } from 'node:zlib'

const TEAL = [15, 143, 131]
const WHITE = [255, 255, 255]
const BARS = [0.34, 0.62, 0.9, 0.62, 0.34]  // relative heights: a voice waveform

function coverage(x, y, size) {
  // Rounded-square tile with corner radius 22% of the size.
  const r = size * 0.22
  const cx = Math.min(Math.max(x, r), size - r)
  const cy = Math.min(Math.max(y, r), size - r)
  const inTile = (x - cx) ** 2 + (y - cy) ** 2 <= r * r
  if (!inTile) return null
  const barW = size * 0.1
  const gap = size * 0.055
  const total = BARS.length * barW + (BARS.length - 1) * gap
  const left = (size - total) / 2
  for (let i = 0; i < BARS.length; i++) {
    const bx = left + i * (barW + gap)
    const h = BARS[i] * size * 0.62
    const top = (size - h) / 2
    if (x >= bx && x <= bx + barW && y >= top && y <= top + h) {
      // round the bar ends
      const capR = barW / 2
      const capY = y < top + capR ? top + capR : y > top + h - capR ? top + h - capR : y
      if ((x - (bx + capR)) ** 2 + (y - capY) ** 2 <= capR * capR) return WHITE
    }
  }
  return TEAL
}

export function renderIcon(size) {
  const ss = 4  // supersampling for smooth edges
  const raw = Buffer.alloc(size * (size * 4 + 1))
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0  // filter: none
    for (let x = 0; x < size; x++) {
      let r = 0, g = 0, b = 0, a = 0
      for (let sy = 0; sy < ss; sy++) for (let sx = 0; sx < ss; sx++) {
        const c = coverage(x + (sx + 0.5) / ss, y + (sy + 0.5) / ss, size)
        if (c) { r += c[0]; g += c[1]; b += c[2]; a += 1 }
      }
      const o = y * (size * 4 + 1) + 1 + x * 4
      if (a) { raw[o] = Math.round(r / a); raw[o + 1] = Math.round(g / a); raw[o + 2] = Math.round(b / a) }
      raw[o + 3] = Math.round((a / (ss * ss)) * 255)
    }
  }
  const chunk = (type, data) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length)
    const body = Buffer.concat([Buffer.from(type, 'ascii'), data])
    const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(body) >>> 0)
    return Buffer.concat([len, body, crc])
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4)
  ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0  // 8-bit RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0)),
  ])
}
