/**
 * 메모리 구성(G4): 전체 RAM 을 묶음(개발 서버·에이전트·무거운 작업·다른 앱·시스템·공유)과 남은 메모리로 나눈다.
 * 메모리 카드의 쌓은 막대·범례, 간단히 카드, 메모리 지도가 같은 값·순서·색을 쓴다.
 */
import type { GroupUsage, MemorySummary, ProcessGroup } from '../../shared/types'

/** 묶음 순서(쌓은 막대·지도·묶음 추이가 이 순서로 놓는다). */
export const GROUP_ORDER: ProcessGroup[] = ['devServer', 'agent', 'heavy', 'otherApps', 'system']

/** 묶음 색(메모리 카드와 메모리 상세가 같은 색). */
export const GROUP_COLOR: Record<ProcessGroup, string> = {
  devServer: 'var(--chart-1)',
  agent: 'var(--chart-2)',
  heavy: 'var(--chart-3)',
  otherApps: 'var(--chart-4)',
  system: 'var(--status-idle)'
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

const clamp01 = (n: number): number => Math.max(0, Math.min(1, n))

/**
 * 전체 RAM 의 묶음별 몫과 남은 메모리. 전체를 모르면(0) null.
 * 묶음 합이 사용량을 넘으면(측정 시점 차이) 모든 묶음을 같은 비율로 줄여 사용량에 맞춘다 —
 * 막대가 100% 를 넘지 않고 남은 메모리 칸은 늘 정확하다.
 */
export function memoryComposition(
  memory: Pick<MemorySummary, 'totalBytes' | 'usedBytes'>,
  groups: GroupUsage[]
): MemoryComposition | null {
  const total = memory.totalBytes
  if (!(total > 0)) return null
  const used = Math.max(0, Math.min(total, memory.usedBytes))
  const raw = GROUP_ORDER.map((group) =>
    Math.max(0, groups.find((g) => g.group === group)?.memoryBytes ?? 0)
  )
  const sum = raw.reduce((a, b) => a + b, 0)
  const scale = sum > used ? used / sum : 1
  const parts = GROUP_ORDER.map((group, i) => {
    const bytes = raw[i] * scale
    return { group, bytes, share: clamp01(bytes / total) }
  })
  const freeBytes = total - used
  return { parts, freeBytes, freeShare: clamp01(freeBytes / total) }
}
