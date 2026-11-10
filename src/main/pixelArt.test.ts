import { inflateSync } from 'zlib'
import {
  APP_TILE,
  encodeIco,
  encodePng,
  renderAppIcon,
  renderSmallIcon,
  SMALL_GRID
} from './pixelArt'

const px = (rgba: Buffer, size: number, x: number, y: number): number[] => {
  const i = (y * size + x) * 4
  return [...rgba.subarray(i, i + 4)]
}
const hex = (c: string): number[] => [1, 3, 5].map((i) => parseInt(c.slice(i, i + 2), 16))

describe('작은 아이콘(16px 트레이·작업 표시줄): 피트월 모니터를 픽셀 그대로', () => {
  test('16×16 격자 한 칸이 한 픽셀: 모서리는 투명, 화면 테두리는 흰색, 그래프 선은 받은 색', () => {
    const rgba = renderSmallIcon('#f38ba8', 16)
    expect(rgba.length).toBe(16 * 16 * 4)
    expect(px(rgba, 16, 0, 0)[3]).toBe(0)
    expect(px(rgba, 16, 15, 15)[3]).toBe(0)
    expect(px(rgba, 16, 1, 1)).toEqual([...hex(APP_TILE), 255])
    const borderY = SMALL_GRID.findIndex((row) => row.includes('WWWWWWWWWWWW'))
    expect(px(rgba, 16, 4, borderY)).toEqual([255, 255, 255, 255])
    const lineAt = SMALL_GRID.flatMap((row, y) =>
      [...row].map((c, x) => (c === 'L' ? [x, y] : null)).filter(Boolean)
    )[0] as number[]
    expect(px(rgba, 16, lineAt[0], lineAt[1])).toEqual([...hex('#f38ba8'), 255])
  })

  test('32px 는 같은 그림을 2배로(흐려지지 않게 정수배)', () => {
    const small = renderSmallIcon('#a6e3a1', 16)
    const big = renderSmallIcon('#a6e3a1', 32)
    for (const [x, y] of [
      [4, 3],
      [7, 6],
      [1, 1],
      [0, 0]
    ])
      expect(px(big, 32, x * 2 + 1, y * 2 + 1)).toEqual(px(small, 16, x, y))
  })
})

test('점을 주면 오른쪽 위 픽셀이 주황', () => {
  const orange = [...hex('#fab387'), 255]
  const dark = [...hex(APP_TILE), 255]
  const plain = renderSmallIcon('#a6e3a1', 16)
  const dotted = renderSmallIcon('#a6e3a1', 16, '#fab387')
  // 16px: 오른쪽 위 5×5(x 11~15, y 0~4)에 지름 5px 점. 가운데 3×3 주황, 테두리 1px 어두운 색.
  for (let y = 1; y <= 3; y++)
    for (let x = 12; x <= 14; x++) expect(px(dotted, 16, x, y)).toEqual(orange)
  expect(px(plain, 16, 13, 3)).not.toEqual(orange)
  expect(px(plain, 16, 13, 4)).toEqual([255, 255, 255, 255]) // 원래는 모니터 테두리(흰색)
  expect(px(dotted, 16, 13, 4)).toEqual(dark)
  expect(px(dotted, 16, 15, 2)).toEqual(dark)
  expect(px(dotted, 16, 13, 0)).toEqual(dark)
  // 점의 네 모서리는 원래 그림 그대로(판 모서리는 투명).
  expect(px(dotted, 16, 15, 0)[3]).toBe(0)
  expect(px(dotted, 16, 11, 4)).toEqual(px(plain, 16, 11, 4))
  // 점 밖은 그대로.
  for (const [x, y] of [
    [10, 2],
    [13, 5],
    [4, 3],
    [8, 8]
  ])
    expect(px(dotted, 16, x, y)).toEqual(px(plain, 16, x, y))

  // 32px 는 2배: 지름 10px(x 22~31, y 0~9), 테두리 2px.
  const big = renderSmallIcon('#a6e3a1', 32, '#fab387')
  expect(px(big, 32, 24, 2)).toEqual(orange)
  expect(px(big, 32, 29, 7)).toEqual(orange)
  expect(px(big, 32, 22, 4)).toEqual(dark)
  expect(px(big, 32, 23, 4)).toEqual(dark)
  expect(px(big, 32, 26, 8)).toEqual(dark)
  expect(px(big, 32, 26, 9)).toEqual(dark)
  expect(px(big, 32, 31, 0)[3]).toBe(0)
})

test('큰 아이콘: 둥근 검은 판 위 가운데에 모니터, 바깥 여백은 투명', () => {
  const size = 256
  const rgba = renderAppIcon(size)
  expect(px(rgba, size, 2, 2)[3]).toBe(0)
  expect(px(rgba, size, size / 2, Math.round(size * 0.12))).toEqual([...hex(APP_TILE), 255])
  // 모니터 화면 위 테두리(흰색)가 판 가운데 줄에 있다.
  const column = [...Array(size).keys()].map((y) => px(rgba, size, size / 2, y))
  expect(column.some((c) => c[0] === 255 && c[1] === 255 && c[2] === 255 && c[3] === 255)).toBe(
    true
  )
})

test('ICO: 머리(아이콘 형식·개수)와 항목마다 크기·PNG 위치가 맞다', () => {
  const pngs = [16, 32, 256].map((size) => ({
    size,
    png: encodePng(renderSmallIcon('#a6e3a1', size), size, size)
  }))
  const ico = encodeIco(pngs)
  expect(ico.readUInt16LE(0)).toBe(0)
  expect(ico.readUInt16LE(2)).toBe(1)
  expect(ico.readUInt16LE(4)).toBe(3)
  pngs.forEach(({ size, png }, i) => {
    const entry = 6 + i * 16
    expect(ico[entry]).toBe(size === 256 ? 0 : size)
    expect(ico.readUInt32LE(entry + 8)).toBe(png.length)
    const offset = ico.readUInt32LE(entry + 12)
    expect(ico.subarray(offset, offset + png.length).equals(png)).toBe(true)
  })
})

test('PNG: 시그니처·크기·압축을 푼 픽셀이 원본과 같다', () => {
  const rgba = renderSmallIcon('#f38ba8', 16)
  const png = encodePng(rgba, 16, 16)
  expect([...png.subarray(0, 8)]).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
  const idatAt = png.indexOf('IDAT')
  const raw = inflateSync(png.subarray(idatAt + 4, idatAt + 4 + png.readUInt32BE(idatAt - 4)))
  expect(raw.length).toBe(16 * (1 + 16 * 4))
  expect([...raw.subarray(1, 5)]).toEqual([...rgba.subarray(0, 4)])
})
