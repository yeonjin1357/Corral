/**
 * 묶음별 메모리 값(G4·G6)을 메인 기록과 화면이 같은 규칙으로 다룬다: 믿을 수 없는 값은 0, 사용량은 전체 안으로,
 * 묶음 합이 사용량을 넘으면(측정 시점 차이) 모든 묶음을 같은 비율로 줄인다. 그래서 메모리 카드·지도·묶음 추이의
 * 값이 같고, 묶음 추이의 맨 위가 사용량을 넘지 않는다.
 */
import type { GroupPoint, GroupUsage, MemorySummary, ProcessGroup } from './types'

/** 바이트 값: 유한한 수가 아니면 0, 음수는 0. */
export const safeBytes = (v: number): number => (Number.isFinite(v) ? Math.max(0, v) : 0)

/** 전체와, 전체 안으로 자른 사용량(둘 다 safeBytes). 전체를 모르면 둘 다 0. */
export function usedWithin(memory: Pick<MemorySummary, 'totalBytes' | 'usedBytes'>): {
  total: number
  used: number
} {
  const total = safeBytes(memory.totalBytes)
  return { total, used: Math.min(total, safeBytes(memory.usedBytes)) }
}

/** 묶음 바이트를 safeBytes 로 고르고, 합이 사용량을 넘으면 같은 비율로 줄여 사용량에 맞춘다(다른 값은 그대로). */
export function fitGroups(
  memory: Pick<MemorySummary, 'totalBytes' | 'usedBytes'>,
  groups: GroupUsage[]
): GroupUsage[] {
  const { used } = usedWithin(memory)
  const clean = groups.map((g) => ({ ...g, memoryBytes: safeBytes(g.memoryBytes) }))
  const sum = clean.reduce((n, g) => n + g.memoryBytes, 0)
  if (sum <= used) return clean
  const scale = used / sum
  return clean.map((g) => ({ ...g, memoryBytes: g.memoryBytes * scale }))
}

/** 묶음 사용량을 묶음 추이의 한 점으로(메인 기록·화면 기록이 같이 쓴다). 없는 묶음과 믿을 수 없는 값은 0. */
export function groupPoint(t: number, groups: GroupUsage[]): GroupPoint {
  const bytes = (group: ProcessGroup): number =>
    safeBytes(groups.find((g) => g.group === group)?.memoryBytes ?? 0)
  return {
    t,
    devServer: bytes('devServer'),
    agent: bytes('agent'),
    heavy: bytes('heavy'),
    otherApps: bytes('otherApps'),
    system: bytes('system')
  }
}
