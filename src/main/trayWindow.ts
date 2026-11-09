import type { Platform } from '../shared/types'

/**
 * 트레이 요약 창(F10)의 위치 계산. 창 만들기는 index.ts(Electron), 여기는 계산만 해서 시험한다.
 * NeoHtop (MIT) src-tauri/src/companion.rs 의 placement 를 따른다: 트레이 아이콘 가운데에 맞추고 화면(작업 영역)
 * 안으로 민다. 바꾼 점: Windows 는 작업 표시줄이 있는 쪽의 반대편(아래면 위, 오른쪽이면 왼쪽)에 붙인다.
 */
export interface Rect {
  x: number
  y: number
  width: number
  height: number
}

/** NeoHtop 요약 창(400×600)보다 조금 작은 세로형. */
export const TRAY_WINDOW_SIZE = { width: 360, height: 520 }
const MARGIN = 8
/** macOS 메뉴바 아이콘과 창 사이 틈. */
const MAC_GAP = 4
/** 포커스를 잃어 숨은 직후의 트레이 클릭은 "닫기" 뜻이다(다시 열지 않는다). */
const REOPEN_GUARD_MS = 250

export function trayWindowBounds(
  tray: Rect,
  display: { bounds: Rect; workArea: Rect },
  size: { width: number; height: number },
  platform: Platform
): Rect {
  const work = display.workArea
  const right = work.x + work.width
  const bottom = work.y + work.height
  const clampX = (x: number): number =>
    Math.max(work.x + MARGIN, Math.min(right - size.width - MARGIN, x))
  const clampY = (y: number): number => Math.max(work.y, Math.min(bottom - size.height, y))
  const centerX = tray.x + tray.width / 2 - size.width / 2
  const centerY = tray.y + tray.height / 2 - size.height / 2
  const at = (x: number, y: number): Rect => ({
    x: Math.round(clampX(x)),
    y: Math.round(clampY(y)),
    width: size.width,
    height: size.height
  })

  // 트레이 위치를 모르면(일부 환경은 0 크기를 준다) 작업 영역 오른쪽 아래.
  if (tray.width <= 0 || tray.height <= 0)
    return at(right - size.width - MARGIN, bottom - size.height - MARGIN)
  if (platform === 'darwin') return at(centerX, tray.y + tray.height + MAC_GAP)
  if (tray.y + tray.height <= work.y) return at(centerX, work.y + MARGIN)
  if (tray.x >= right) return at(right - size.width - MARGIN, centerY)
  if (tray.x + tray.width <= work.x) return at(work.x + MARGIN, centerY)
  if (tray.y >= bottom) return at(centerX, bottom - size.height - MARGIN)
  // 숨은 아이콘 칸(작업 영역 안에 뜨는 창) 등: 아이콘 바로 위.
  return at(centerX, tray.y - size.height - MARGIN)
}

export function shouldReopen(hiddenAt: number | null, now: number): boolean {
  return hiddenAt == null || now - hiddenAt > REOPEN_GUARD_MS
}

/** 숨긴 요약 창을 이 시간 뒤에 닫는다(열어 둔 화면 프로세스가 앱 메모리를 약 90 MB 늘리므로). */
export const TRAY_WINDOW_CLOSE_AFTER_MS = 60_000

/**
 * 숨긴 뒤 delayMs 가 지나면 close 를 부른다. 그 사이 다시 보이면(shown) 취소한다.
 * 자주 여닫을 때는 창을 다시 만들지 않고, 오래 안 쓰면 메모리를 돌려준다.
 */
export function createIdleCloser(
  delayMs: number,
  close: () => void
): { hidden(): void; shown(): void; dispose(): void } {
  let timer: ReturnType<typeof setTimeout> | null = null
  const cancel = (): void => {
    if (timer) clearTimeout(timer)
    timer = null
  }
  return {
    hidden() {
      cancel()
      timer = setTimeout(() => {
        timer = null
        close()
      }, delayMs)
    },
    shown: cancel,
    dispose: cancel
  }
}
