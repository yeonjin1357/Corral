import type { DashboardSnapshot, LeftoverRow, ServerRow } from './types'
import { selectionKey } from './keys'
import { commitSum, portList, worktreeLabel } from './format'

export interface RecommendItem {
  kind: 'server' | 'leftover'
  /** 목록 선택 키(화면 이동·한꺼번에 끄기에 쓴다). */
  key: string
  pid: number
  /** 서버의 포트 목록(`:3000 · :3001`) 또는 남은 프로세스 이름. */
  title: string
  /** 워크트리 폴더 · 브랜치(모르면 그렇게). */
  where: string
  memoryBytes: number
  /** 커밋 합. 모르면 null. */
  commitBytes: number | null
}

export interface Recommendation {
  items: RecommendItem[]
  totalBytes: number
  /** 항목 커밋 중 아는 것의 합. 하나도 모르면 null. */
  totalCommitBytes: number | null
}

/** 서버 하나를 한꺼번에 끄기 항목으로. */
export function serverItem(p: ServerRow): RecommendItem {
  return {
    kind: 'server',
    key: selectionKey.server(p),
    pid: p.pid,
    title: portList(p.ports),
    where: worktreeLabel(p.worktree),
    memoryBytes: p.memoryBytes,
    commitBytes: p.commitBytes
  }
}

/** 남은 프로세스 하나를 한꺼번에 끄기 항목으로. */
export function leftoverItem(l: LeftoverRow): RecommendItem {
  return {
    kind: 'leftover',
    key: selectionKey.leftover(l),
    pid: l.pid,
    title: l.label,
    where: worktreeLabel(l.worktree),
    memoryBytes: l.memoryBytes,
    commitBytes: l.commitBytes
  }
}

/**
 * 메모리 큰 순(같으면 pid 순). 커밋을 알면 커밋, 모르면 RAM 으로 잰다(RAM 은 메모리가 부족할수록 페이지 파일로
 * 밀려나 작게 보인다).
 */
export function byMemory(a: RecommendItem, b: RecommendItem): number {
  return (b.commitBytes ?? b.memoryBytes) - (a.commitBytes ?? a.memoryBytes) || a.pid - b.pid
}

/**
 * 메모리가 부족할 때 끄라고 권할 것(스펙 §3-7): 정리 후보 서버와, 에이전트가 없는 워크트리의 남은 프로세스.
 * "확인해볼 것"(탭이 열린 서버)·판별 불가 서버·작업 폴더를 모르는 남은 프로세스(에이전트가 띄운 것인지 알 수 없음)는
 * 넣지 않는다(불확실하면 빼는 쪽, 목록에서 하나씩은 끌 수 있다). 메모리(커밋, 모르면 RAM) 큰 순.
 */
export function cleanupRecommendation(s: DashboardSnapshot): Recommendation {
  const items: RecommendItem[] = []
  for (const p of s.servers) {
    if (p.judgement !== 'candidate' || p.unresolvable || !p.worktree) continue
    items.push(serverItem(p))
  }
  for (const l of s.leftovers) {
    if (l.agentInWorktree || !l.worktree) continue
    items.push(leftoverItem(l))
  }
  items.sort(byMemory)
  return {
    items,
    totalBytes: items.reduce((sum, i) => sum + i.memoryBytes, 0),
    totalCommitBytes: commitSum(items)
  }
}
