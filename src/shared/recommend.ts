import type { DashboardSnapshot } from './types'
import { selectionKey } from './keys'
import { worktreeLabel } from './format'

export interface RecommendItem {
  kind: 'port' | 'leftover'
  /** 목록 선택 키(화면 이동·한꺼번에 끄기에 쓴다). */
  key: string
  pid: number
  /** 포트 번호(`:3000`) 또는 남은 프로세스 이름. */
  title: string
  /** 워크트리 폴더 · 브랜치(모르면 그렇게). */
  where: string
  memoryBytes: number
}

export interface Recommendation {
  items: RecommendItem[]
  totalBytes: number
}

/**
 * 메모리가 부족할 때 끄라고 권할 것(스펙 §3-7): 정리 후보 포트와, 에이전트가 없는 워크트리의 남은 프로세스.
 * "확인해볼 것"(탭이 열린 포트)·판별 불가 포트·작업 폴더를 모르는 남은 프로세스(에이전트가 띄운 것인지 알 수 없음)는
 * 넣지 않는다(불확실하면 빼는 쪽, 목록에서 하나씩은 끌 수 있다). 메모리 큰 순.
 */
export function cleanupRecommendation(s: DashboardSnapshot): Recommendation {
  const items: RecommendItem[] = []
  for (const p of s.ports) {
    if (p.judgement !== 'candidate' || p.unresolvable || !p.worktree) continue
    items.push({
      kind: 'port',
      key: selectionKey.port(p),
      pid: p.pid,
      title: `:${p.port}`,
      where: worktreeLabel(p.worktree),
      memoryBytes: p.memoryBytes
    })
  }
  for (const l of s.leftovers) {
    if (l.agentInWorktree || !l.worktree) continue
    items.push({
      kind: 'leftover',
      key: selectionKey.leftover(l),
      pid: l.pid,
      title: l.label,
      where: worktreeLabel(l.worktree),
      memoryBytes: l.memoryBytes
    })
  }
  items.sort((a, b) => b.memoryBytes - a.memoryBytes || a.pid - b.pid)
  return { items, totalBytes: items.reduce((sum, i) => sum + i.memoryBytes, 0) }
}
