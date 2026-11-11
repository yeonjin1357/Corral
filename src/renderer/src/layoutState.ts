/**
 * 메인 창 위쪽 카드 영역의 단계(G2): 자세히(지금 카드)·간단히(카드마다 한 줄)·접기(카드 없음), 그리고 카드 배치(G3).
 * 정렬·보기처럼 이 PC 화면에서만 쓰는 편의 값이라 localStorage 에 둔다. 막히거나 깨지면 자세히·기본 배치로 넘어간다.
 */
import type { StorageLike } from './storage'

export type TopMode = 'full' | 'compact' | 'collapsed'

/** 큰 단계부터. 손잡이의 ↑ 는 다음 칸(작게), ↓ 는 앞 칸(크게). */
export const TOP_MODES: TopMode[] = ['full', 'compact', 'collapsed']

/**
 * 단계마다 카드 영역 높이(px) = 카드 높이 + 카드 줄 위·아래 여백. 끄는 동안 보이는 높이와 놓을 때 붙는 단계가 이 값을 같이 쓴다.
 * - 카드 높이: StatsBar 자세히 카드 `h-60`(240px), 간단히 카드 `h-18`(72px, CompactCard).
 * - 여백: app.css `.resource-grid` 의 위 16px + 아래 4px(창 너비가 바뀌어도 위아래는 그대로 둔다).
 * 카드가 한 줄에 다 들어가지 않으면 카드 줄에 가로 스크롤바가 생겨 그만큼 높아진다 — 화면은 잰 스크롤바 높이를
 * withScrollbar 로 더해 쓴다.
 */
const CARD_FULL = 240
const CARD_COMPACT = 72
const GRID_PADDING_Y = 16 + 4
export const TOP_HEIGHTS: Record<TopMode, number> = {
  full: CARD_FULL + GRID_PADDING_Y,
  compact: CARD_COMPACT + GRID_PADDING_Y,
  collapsed: 0
}

/** 카드 줄의 가로 스크롤바 높이(px)만큼 카드가 있는 단계(자세히·간단히)를 높인다. 숫자가 아니거나 0 이하면 그대로. */
export function withScrollbar(
  heights: Record<TopMode, number>,
  scrollbarPx: number
): Record<TopMode, number> {
  const extra = Number.isFinite(scrollbarPx) && scrollbarPx > 0 ? scrollbarPx : 0
  return {
    full: heights.full + extra,
    compact: heights.compact + extra,
    collapsed: heights.collapsed
  }
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

// ── 카드 고르기(G3) ──
/**
 * 카드 줄의 카드: 기본 여섯 장과 더할 수 있는 새 카드 세 장. 배치는 단계처럼 localStorage 에 둔다.
 * - order: 카드 줄에 올라 있는 카드(기본 카드 + 더한 새 카드)의 순서, hidden: 그 가운데 숨긴 것.
 * - 기본 카드는 늘 order 에 있고(뺄 수 없고 숨길 수만 있다), 새 카드는 더하면 끝에 붙고 빼면 order 에서 지운다.
 * - 보이는 카드는 늘 하나 이상(마지막 하나는 숨기거나 뺄 수 없다).
 * 조작 함수는 바꿀 것이 없으면 받은 배치를 그대로 돌려준다(화면이 저장을 다시 하지 않게).
 */
export type CardId =
  'memory' | 'servers' | 'agents' | 'heavy' | 'leftovers' | 'disk' | 'waiting' | 'tokens' | 'events'
export const DEFAULT_CARDS: CardId[] = ['memory', 'servers', 'agents', 'heavy', 'leftovers', 'disk']
export const EXTRA_CARDS: CardId[] = ['waiting', 'tokens', 'events']
export interface CardLayout {
  order: CardId[]
  hidden: CardId[]
}

const CARDS_KEY = 'pitwall.cards'
const ALL_CARDS: readonly CardId[] = [...DEFAULT_CARDS, ...EXTRA_CARDS]
const isCardId = (v: unknown): v is CardId => ALL_CARDS.includes(v as CardId)
const defaultLayout = (): CardLayout => ({ order: [...DEFAULT_CARDS], hidden: [] })

/** 아는 카드 이름만, 처음 나온 순서대로 한 번씩. 배열이 아니면 빈 목록. */
function cardList(value: unknown): CardId[] {
  return Array.isArray(value) ? [...new Set(value.filter(isCardId))] : []
}

/**
 * 저장된 값을 쓸 수 있는 배치로: 모르는 이름·중복은 버리고, order 에 없는 기본 카드는 끝에 붙이고(앞으로 기본 카드가
 * 늘어도 사라지지 않게), hidden 은 order 에 있는 것만 남긴다. 보이는 카드가 하나도 없으면 기본 배치.
 */
export function normalizeCardLayout(raw: unknown): CardLayout {
  const value = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  const order = cardList(value.order)
  for (const id of DEFAULT_CARDS) if (!order.includes(id)) order.push(id)
  const hidden = cardList(value.hidden).filter((id) => order.includes(id))
  return hidden.length < order.length ? { order, hidden } : defaultLayout()
}

export function readCardLayout(storage: StorageLike | null): CardLayout {
  try {
    const value = storage?.getItem(CARDS_KEY)
    return normalizeCardLayout(value ? JSON.parse(value) : null)
  } catch {
    return defaultLayout()
  }
}

export function writeCardLayout(storage: StorageLike | null, layout: CardLayout): void {
  try {
    storage?.setItem(CARDS_KEY, JSON.stringify({ order: layout.order, hidden: layout.hidden }))
  } catch {
    // 저장소가 막혀도 이번 실행 동안은 화면 상태로 유지된다.
  }
}

/** 카드 줄에 보이는 카드(숨긴 것을 뺀 order). */
export function visibleCards(l: CardLayout): CardId[] {
  return l.order.filter((id) => !l.hidden.includes(id))
}

/**
 * 카드마다 열 너비의 비중(fr)과 최소 너비(px). 비중은 여섯 장일 때의 예전 비율 그대로(메모리 1.5·남은 프로세스 1.05·
 * 디스크 정리 1.2), 새 카드는 1. 최소 너비는 메모리 240px(범례·커밋 줄), 나머지 160px(1180~1280px 창에서 카드가
 * 161~176px 로 잘 보였다).
 */
const CARD_WIDTH: Record<CardId, { weight: number; minPx: number }> = {
  memory: { weight: 1.5, minPx: 240 },
  servers: { weight: 1, minPx: 160 },
  agents: { weight: 1, minPx: 160 },
  heavy: { weight: 1, minPx: 160 },
  leftovers: { weight: 1.05, minPx: 160 },
  disk: { weight: 1.2, minPx: 160 },
  waiting: { weight: 1, minPx: 160 },
  tokens: { weight: 1, minPx: 160 },
  events: { weight: 1, minPx: 160 }
}

/**
 * 카드 줄의 grid-template-columns: 받은 카드 순서대로 `minmax(최소, 비중fr)`. 카드는 몇 장이든 한 줄이라
 * 최소 너비의 합이 창보다 넓으면 카드 줄만 가로로 스크롤한다(app.css `.resource-grid`).
 */
export function cardColumns(ids: CardId[]): string {
  return ids.map((id) => `minmax(${CARD_WIDTH[id].minPx}px, ${CARD_WIDTH[id].weight}fr)`).join(' ')
}

/** 숨기거나 다시 보인다. 마지막 보이는 카드를 숨기려 하면 그대로. */
export function setCardHidden(l: CardLayout, id: CardId, hidden: boolean): CardLayout {
  if (!l.order.includes(id) || l.hidden.includes(id) === hidden) return l
  if (!hidden) return { order: l.order, hidden: l.hidden.filter((x) => x !== id) }
  if (visibleCards(l).length <= 1) return l
  return { order: l.order, hidden: [...l.hidden, id] }
}

/** 새 카드를 줄 끝에 더한다(기본 카드·이미 있는 카드는 그대로). */
export function addCard(l: CardLayout, id: CardId): CardLayout {
  if (!EXTRA_CARDS.includes(id) || l.order.includes(id)) return l
  return { order: [...l.order, id], hidden: l.hidden }
}

/** 새 카드를 줄에서 뺀다(기본 카드는 그대로). 마지막 보이는 카드면 빼지 않는다. */
export function removeCard(l: CardLayout, id: CardId): CardLayout {
  if (!EXTRA_CARDS.includes(id) || !l.order.includes(id)) return l
  const next = { order: l.order.filter((x) => x !== id), hidden: l.hidden.filter((x) => x !== id) }
  return visibleCards(next).length > 0 ? next : l
}

/** order 안에서 to 자리로 옮긴다(범위 밖은 양 끝). 줄에 없거나 제자리면 그대로. */
export function moveCard(l: CardLayout, id: CardId, to: number): CardLayout {
  const from = l.order.indexOf(id)
  const target = Math.min(l.order.length - 1, Math.max(0, to))
  if (from < 0 || from === target) return l
  const order = l.order.filter((x) => x !== id)
  order.splice(target, 0, id)
  return { order, hidden: l.hidden }
}
