import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { describe, expect, test } from 'vitest'

// 색 토큰 검사: app.css 의 :root(밝게)·.dark(어둡게)를 읽어 옛 팔레트 흔적과 글자 대비를 본다.
const SRC = resolve(__dirname, '..')
const CSS = readFileSync(join(SRC, 'renderer/src/styles/app.css'), 'utf8')

/** 최상위 블록(`:root {…}`, `.dark {…}`)의 `--이름: 값` 을 읽는다. */
function tokens(selector: string): Record<string, string> {
  const start = CSS.indexOf(`\n${selector} {`)
  expect(start, `${selector} 블록`).toBeGreaterThanOrEqual(0)
  const end = CSS.indexOf('\n}', start)
  const out: Record<string, string> = {}
  for (const m of CSS.slice(start, end).matchAll(/(--[\w-]+):\s*([^;]+);/g)) out[m[1]] = m[2].trim()
  return out
}
const LIGHT = tokens(':root')
const DARK = tokens('.dark')

const lum = (hex: string): number => {
  const c = [1, 3, 5].map((i) => {
    const v = parseInt(hex.slice(i, i + 2), 16) / 255
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4
  })
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]
}
const contrast = (a: string, b: string): number => {
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x)
  return (hi + 0.05) / (lo + 0.05)
}
/** fg 를 pct% 섞은 bg(sRGB 보간, color-mix in srgb 와 같다). */
const mix = (fg: string, bg: string, pct: number): string => {
  const ch = (i: number): string =>
    Math.round(
      parseInt(fg.slice(i, i + 2), 16) * pct + parseInt(bg.slice(i, i + 2), 16) * (1 - pct)
    )
      .toString(16)
      .padStart(2, '0')
  return `#${ch(1)}${ch(3)}${ch(5)}`
}

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) walk(p, out)
    else if (/\.(ts|vue|css)$/.test(name) && !/\.test\.ts$/.test(name)) out.push(p)
  }
  return out
}

const OLD_HEX = [
  '#1e1e2e', '#181825', '#11111b', '#cdd6f4', '#89b4fa', '#b4befe', '#fab387', '#f38ba8',
  '#a6e3a1', '#f9e2af', '#94e2d5', '#0969da', '#24292f', '#f6f8fa', '#8250df', '#cf222e',
  '#1a7f37', '#bc4c00', '#9a6700'
] // prettier-ignore

test('옛 Catppuccin·GitHub Light 색이 앱 코드에 남아 있지 않다', () => {
  const found: string[] = []
  for (const file of walk(SRC)) {
    const text = readFileSync(file, 'utf8').toLowerCase()
    for (const hex of OLD_HEX) if (text.includes(hex)) found.push(`${file}: ${hex}`)
  }
  expect(found).toEqual([])
})

const ROLE_TOKENS = [
  '--status-running', '--status-waiting', '--status-stopped', '--status-idle', '--info',
  '--group-dev', '--group-agent', '--group-heavy', '--group-apps', '--group-system',
  '--chart-1', '--chart-2', '--chart-3', '--chart-4', '--chart-5', '--primary', '--destructive'
] // prettier-ignore

test('어둡게·밝게 모두 역할 토큰을 정의한다', () => {
  for (const set of [LIGHT, DARK]) {
    for (const name of ROLE_TOKENS) expect(set[name], name).toMatch(/^#[0-9a-f]{6}$|^var\(--/i)
  }
})

test('옛 Catppuccin 이름 토큰은 없다', () => {
  const old =
    /--(base|mantle|crust|text|subtext\d|surface\d|overlay\d|blue|lavender|sapphire|sky|red|maroon|peach|yellow|green|teal):/
  expect(CSS).not.toMatch(old)
})

/** var(--x) 참조를 풀어 hex 로. */
const resolveHex = (set: Record<string, string>, name: string): string => {
  const v = set[name]
  const ref = /^var\((--[\w-]+)\)$/.exec(v)
  return ref ? resolveHex(set, ref[1]) : v
}

function checkContrast(set: Record<string, string>, pill: number): void {
  const bg = resolveHex(set, '--background')
  const card = resolveHex(set, '--card')
  const names = [
    '--status-running', '--status-waiting', '--status-stopped', '--status-idle', '--info',
    '--muted-foreground', '--primary'
  ] // prettier-ignore
  for (const name of names) {
    const c = resolveHex(set, name)
    expect(contrast(c, bg), `${name} on background`).toBeGreaterThanOrEqual(4.5)
    expect(contrast(c, card), `${name} on card`).toBeGreaterThanOrEqual(4.5)
    expect(contrast(c, mix(c, card, pill)), `${name} on pill`).toBeGreaterThanOrEqual(4.5)
  }
  expect(
    contrast(resolveHex(set, '--primary-foreground'), resolveHex(set, '--primary'))
  ).toBeGreaterThanOrEqual(4.5)
  expect(
    contrast(resolveHex(set, '--destructive-foreground'), resolveHex(set, '--destructive'))
  ).toBeGreaterThanOrEqual(4.5)
}

describe('글자 대비', () => {
  test('밝은 테마 글자 대비가 4.5:1 이상(바탕·카드·옅은 알약 위)', () => checkContrast(LIGHT, 0.13))
  test('어두운 테마 글자 대비도 4.5:1 이상', () => checkContrast(DARK, 0.14))
})
