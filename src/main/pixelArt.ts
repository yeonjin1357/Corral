/**
 * pitwall 아이콘: NeoHtop 앱 아이콘처럼 검은 둥근 판 위 픽셀 그림 하나("피트월 모니터" — 모니터와 심박 같은 그래프).
 * - 큰 아이콘(앱·설치 파일·macOS): 둥근 판 가운데에 16×16 그림. 테두리만 부드럽게(4×4 표본) 칠한다.
 * - 작은 아이콘(16·24·32px, 트레이·작업 표시줄·제목줄): 큰 그림을 줄이면 흐려지므로, 판을 꽉 채운 16×16 그림을
 *   정수배로 칠한다. 그래프 선 색으로 RAM 상태(정상·경고·위험)를 보인다.
 * 외부 라이브러리 없이 RGBA → PNG·ICO 로 만든다(scripts/make-icon.mjs 와 트레이가 같이 쓴다).
 */
import { deflateSync } from 'node:zlib'

/** 판 색(NeoHtop 앱 아이콘의 검정). */
export const APP_TILE = '#0b0a09'
/** 큰 아이콘의 그래프 선 색(Catppuccin green, 화면의 정상 색과 같다). */
export const APP_LINE = '#a6e3a1'

/** 큰 아이콘 그림(16×16). W 흰색, G 그늘, N 그래프 선, . 빈칸(판 색). */
export const APP_GRID = [
  '................',
  '.WWWWWWWWWWWWWW.',
  '.W............W.',
  '.W.....NN.....W.',
  '.W.....NN.....W.',
  '.W....NNN.....W.',
  '.W....N.N..NN.W.',
  '.WNNNNN.NNNNNNW.',
  '.W......NN....W.',
  '.W............W.',
  '.WWWWWWWWWWWWWW.',
  '.......WG.......',
  '.......WG.......',
  '....WWWWWWWW....',
  '................',
  '................'
]

/** 작은 아이콘 그림(16×16, 판이 꽉 찬다). K 판, W 흰색, L 그래프 선(상태 색), . 투명. */
export const SMALL_GRID = [
  '.KKKKKKKKKKKKKK.',
  'KKKKKKKKKKKKKKKK',
  'KKKKKKKKKKKKKKKK',
  'KKWWWWWWWWWWWWKK',
  'KKWKKKKLLKKKKWKK',
  'KKWKKKKLLKKKKWKK',
  'KKWKKKLLLKKKKWKK',
  'KKWKKKLKLKKLLWKK',
  'KKWLLLLKLLLLLWKK',
  'KKWKKKKKLLKKKWKK',
  'KKWWWWWWWWWWWWKK',
  'KKKKKKKWWKKKKKKK',
  'KKKKKWWWWWWKKKKK',
  'KKKKKKKKKKKKKKKK',
  'KKKKKKKKKKKKKKKK',
  '.KKKKKKKKKKKKKK.'
]

type RGB = [number, number, number]
const rgb = (hex: string): RGB => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)) as RGB

/** 작은 아이콘(16의 정수배 크기). lineColor: 그래프 선 색(#rrggbb). */
export function renderSmallIcon(lineColor: string, size: number): Buffer {
  const scale = size / 16
  const palette: Record<string, RGB> = { K: rgb(APP_TILE), W: [255, 255, 255], L: rgb(lineColor) }
  const out = Buffer.alloc(size * size * 4)
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      const c = SMALL_GRID[Math.floor(y / scale)][Math.floor(x / scale)]
      if (c === '.') continue
      const i = (y * size + x) * 4
      ;[out[i], out[i + 1], out[i + 2]] = palette[c]
      out[i + 3] = 255
    }
  return out
}

/** 큰 아이콘. 판은 가장자리 8% 여백·모서리 반지름 22%, 그림은 가운데 56%. */
export function renderAppIcon(size: number): Buffer {
  const tileOff = size * 0.08
  const tileSize = size * 0.84
  const radius = tileSize * 0.22
  const cell = (size * 0.56) / 16
  const start = (size - cell * 16) / 2
  const palette: Record<string, RGB> = {
    W: [255, 255, 255],
    G: [201, 201, 201],
    N: rgb(APP_LINE)
  }
  const tile = rgb(APP_TILE)
  const inTile = (px: number, py: number): boolean => {
    const x = Math.min(Math.max(px, tileOff + radius), tileOff + tileSize - radius)
    const y = Math.min(Math.max(py, tileOff + radius), tileOff + tileSize - radius)
    return (px - x) ** 2 + (py - y) ** 2 <= radius ** 2
  }
  const glyphAt = (px: number, py: number): RGB | null => {
    const gx = Math.floor((px - start) / cell)
    const gy = Math.floor((py - start) / cell)
    if (gx < 0 || gy < 0 || gx > 15 || gy > 15) return null
    const c = APP_GRID[gy][gx]
    return c === '.' ? null : palette[c]
  }
  const SS = 4
  const out = Buffer.alloc(size * size * 4)
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      let r = 0
      let g = 0
      let b = 0
      let a = 0
      for (let sy = 0; sy < SS; sy++)
        for (let sx = 0; sx < SS; sx++) {
          const px = x + (sx + 0.5) / SS
          const py = y + (sy + 0.5) / SS
          if (!inTile(px, py)) continue
          const c = glyphAt(px, py) ?? tile
          r += c[0]
          g += c[1]
          b += c[2]
          a++
        }
      if (!a) continue
      const i = (y * size + x) * 4
      out[i] = Math.round(r / a)
      out[i + 1] = Math.round(g / a)
      out[i + 2] = Math.round(b / a)
      out[i + 3] = Math.round((a / (SS * SS)) * 255)
    }
  return out
}

const CRC_TABLE = (() => {
  const table = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    table[n] = c >>> 0
  }
  return table
})()

function crc32(data: Buffer): number {
  let c = 0xffffffff
  for (const byte of data) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

function pngChunk(type: string, data: Buffer): Buffer {
  const typeAndData = Buffer.concat([Buffer.from(type, 'latin1'), data])
  const length = Buffer.alloc(4)
  length.writeUInt32BE(data.length)
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(typeAndData))
  return Buffer.concat([length, typeAndData, crc])
}

/**
 * RGBA 비트맵을 PNG 로 감싼다. nativeImage.createFromBitmap 은 OS 마다 바이트 순서(BGRA)와
 * 미리 곱한 알파를 가정해 색이 틀어질 수 있어, 형식이 정해진 PNG 로 넘긴다.
 */
export function encodePng(rgba: Buffer, width: number, height: number): Buffer {
  const header = Buffer.alloc(13)
  header.writeUInt32BE(width, 0)
  header.writeUInt32BE(height, 4)
  header[8] = 8 // 비트 깊이
  header[9] = 6 // RGBA
  const stride = width * 4
  const raw = Buffer.alloc(height * (1 + stride))
  for (let y = 0; y < height; y++) {
    raw[y * (1 + stride)] = 0 // 필터 없음
    rgba.copy(raw, y * (1 + stride) + 1, y * stride, (y + 1) * stride)
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk('IHDR', header),
    pngChunk('IDAT', deflateSync(raw)),
    pngChunk('IEND', Buffer.alloc(0))
  ])
}

/** PNG 여러 장을 Windows .ico 로 묶는다(Vista 부터 PNG 를 그대로 넣을 수 있다). */
export function encodeIco(images: { size: number; png: Buffer }[]): Buffer {
  const header = Buffer.alloc(6)
  header.writeUInt16LE(0, 0)
  header.writeUInt16LE(1, 2)
  header.writeUInt16LE(images.length, 4)
  let offset = 6 + images.length * 16
  const entries = images.map(({ size, png }) => {
    const entry = Buffer.alloc(16)
    entry[0] = size >= 256 ? 0 : size
    entry[1] = size >= 256 ? 0 : size
    entry.writeUInt16LE(1, 4) // planes
    entry.writeUInt16LE(32, 6) // bit count
    entry.writeUInt32LE(png.length, 8)
    entry.writeUInt32LE(offset, 12)
    offset += png.length
    return entry
  })
  return Buffer.concat([header, ...entries, ...images.map((i) => i.png)])
}
