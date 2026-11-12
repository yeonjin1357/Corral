/**
 * 창 테두리: OS 기본 제목줄 대신 화면 맨 위 48px 제목줄(NeoHtop TitleBar 모양)을 창 제목줄로 쓴다.
 * Windows 는 오른쪽 위에 OS 창 단추(최소화·최대화·닫기)를 겹쳐 그리고(titleBarOverlay),
 * macOS 는 왼쪽 위 신호등을 제목줄 가운데 높이에 맞춘다. 색은 화면 테마(밝게·어둡게)의 제목줄 색과 같게.
 */

/** 화면 제목줄 높이(px, 아래 테두리 1px 포함). 창 단추는 테두리를 덮지 않게 1px 덜 그린다. */
export const TITLE_BAR_HEIGHT = 48

/** app.css 밝게·어둡게 토큰의 card(제목줄 바탕)·foreground·background 색. */
const COLORS = {
  light: { bar: '#ffffff', symbol: '#1d1f1c', background: '#f6f6f3' },
  dark: { bar: '#17181a', symbol: '#e6e8e3', background: '#111213' }
} as const

export function overlayFor(dark: boolean): { color: string; symbolColor: string; height: number } {
  const c = dark ? COLORS.dark : COLORS.light
  return { color: c.bar, symbolColor: c.symbol, height: TITLE_BAR_HEIGHT - 1 }
}

export function backgroundFor(dark: boolean): string {
  return dark ? COLORS.dark.background : COLORS.light.background
}

export function windowChrome(
  platform: NodeJS.Platform,
  dark: boolean
): {
  titleBarStyle: 'hidden'
  backgroundColor: string
  titleBarOverlay?: ReturnType<typeof overlayFor>
  trafficLightPosition?: { x: number; y: number }
} {
  const base = { titleBarStyle: 'hidden' as const, backgroundColor: backgroundFor(dark) }
  if (platform === 'darwin') return { ...base, trafficLightPosition: { x: 16, y: 17 } }
  return { ...base, titleBarOverlay: overlayFor(dark) }
}
