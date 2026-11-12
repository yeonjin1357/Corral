/**
 * 메모리 구성(G4): 전체 RAM 을 묶음(개발 서버·에이전트·무거운 작업·다른 앱·시스템·공유)과 남은 메모리로 나눈다.
 * 메모리 카드의 쌓은 막대·범례, 간단히 카드, 메모리 지도가 같은 값·순서·색을 쓴다.
 */
import type { GroupUsage, MemorySummary, ProcessGroup } from '../../shared/types'
import { fitGroups, usedWithin } from '../../shared/memoryGroups'

/** 묶음 순서(쌓은 막대·지도·묶음 추이가 이 순서로 놓는다). */
export const GROUP_ORDER: ProcessGroup[] = ['devServer', 'agent', 'heavy', 'otherApps', 'system']

/** 묶음 색(메모리 카드와 메모리 상세가 같은 색). */
export const GROUP_COLOR: Record<ProcessGroup, string> = {
  devServer: 'var(--group-dev)',
  agent: 'var(--group-agent)',
  heavy: 'var(--group-heavy)',
  otherApps: 'var(--group-apps)',
  system: 'var(--group-system)'
}

export interface CompositionPart {
  group: ProcessGroup
  bytes: number
  /** 전체 RAM 대비 0~1. */
  share: number
}

export interface MemoryComposition {
  /** GROUP_ORDER 순서, 0 인 묶음도 들어 있다. */
  parts: CompositionPart[]
  freeBytes: number
  freeShare: number
}

/** 비중을 0~1 로 자른다. */
export const clamp01 = (n: number): number => Math.max(0, Math.min(1, n))

/**
 * 풍선말의 %(메모리 카드·표의 메모리 칸): 반올림하되 0 보다 크고 1% 아래는 소수 한 자리
 * (범례가 "<1%" 인 묶음이나 작은 줄이 "0%" 로 보이지 않게). 1% 아래는 0.9 까지 — 0.95~1% 를 반올림해
 * "1%" 로 보이면 같은 묶음의 범례 "<1%" 와 어긋난다.
 */
export const tipPercent = (share: number): number =>
  share > 0 && share < 0.01 ? Math.min(0.9, Math.round(share * 1000) / 10) : Math.round(share * 100)

/**
 * 전체 RAM 의 묶음별 몫과 남은 메모리. 전체를 모르면(0) null.
 * 묶음 합이 사용량을 넘으면(측정 시점 차이) 모든 묶음을 같은 비율로 줄여 사용량에 맞춘다 —
 * 막대가 100% 를 넘지 않고 남은 메모리 칸은 늘 정확하다. 믿을 수 없는 값(NaN 등)은 0 이고, 사용량은 전체까지.
 * 규칙은 메인의 묶음 기록과 같은 fitGroups(묶음 추이가 같은 값).
 */
export function memoryComposition(
  memory: Pick<MemorySummary, 'totalBytes' | 'usedBytes'>,
  groups: GroupUsage[]
): MemoryComposition | null {
  const { total, used } = usedWithin(memory)
  if (!(total > 0)) return null
  const fitted = fitGroups(memory, groups)
  const parts = GROUP_ORDER.map((group) => {
    const bytes = fitted.find((g) => g.group === group)?.memoryBytes ?? 0
    return { group, bytes, share: clamp01(bytes / total) }
  })
  const freeBytes = total - used
  return { parts, freeBytes, freeShare: clamp01(freeBytes / total) }
}
