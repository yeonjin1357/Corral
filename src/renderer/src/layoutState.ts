/**
 * 메인 창 위쪽 카드 영역의 단계(G2): 자세히(지금 카드)·간단히(카드마다 한 줄)·접기(카드 없음).
 * 정렬·보기처럼 이 PC 화면에서만 쓰는 편의 값이라 localStorage 에 둔다. 막히거나 깨져도 자세히로 넘어간다.
 */
export type TopMode = 'full' | 'compact' | 'collapsed'

/** 큰 단계부터. 손잡이의 ↑ 는 다음 칸(작게), ↓ 는 앞 칸(크게). */
export const TOP_MODES: TopMode[] = ['full', 'compact', 'collapsed']

/**
 * 단계마다 카드 영역 높이(px) = 카드 높이 + 카드 줄 위·아래 여백. 끄는 동안 보이는 높이와 놓을 때 붙는 단계가 이 값을 같이 쓴다.
 * - 카드 높이: StatsBar 자세히 카드 `h-60`(240px), 간단히 카드 `h-18`(72px, CompactCard).
 * - 여백: app.css `.resource-grid` 의 위 16px + 아래 4px(창 너비가 바뀌어도 위아래는 그대로 둔다).
 */
const CARD_FULL = 240
const CARD_COMPACT = 72
const GRID_PADDING_Y = 16 + 4
export const TOP_HEIGHTS: Record<TopMode, number> = {
  full: CARD_FULL + GRID_PADDING_Y,
  compact: CARD_COMPACT + GRID_PADDING_Y,
  collapsed: 0
}

interface StorageLike {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
}

const TOP_MODE_KEY = 'pitwall.topMode'

export function readTopMode(storage: StorageLike | null): TopMode {
  try {
    const value = storage?.getItem(TOP_MODE_KEY)
    return TOP_MODES.find((m) => m === value) ?? 'full'
  } catch {
    return 'full'
  }
}

export function writeTopMode(storage: StorageLike | null, mode: TopMode): void {
  try {
    storage?.setItem(TOP_MODE_KEY, mode)
  } catch {
    // 저장소가 막혀도 이번 실행 동안은 화면 상태로 유지된다.
  }
}

/** 놓은 높이에 가장 가까운 단계. 두 단계의 가운데면 큰 쪽, 높이가 숫자가 아니면 가장 큰 단계. */
export function snapTopMode(heightPx: number, heights: Record<TopMode, number>): TopMode {
  // 높은 단계부터 보며 더 가까울 때만 바꾸므로 거리가 같으면 앞(큰 쪽)이 남는다.
  const byHeight = [...TOP_MODES].sort((a, b) => heights[b] - heights[a])
  let best = byHeight[0]
  for (const mode of byHeight)
    if (Math.abs(heightPx - heights[mode]) < Math.abs(heightPx - heights[best])) best = mode
  return best
}
