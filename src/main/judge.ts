import type { AgentRow, PortRow } from '../shared/types'

/** 포트별로 지금 상태(연결 0 / 탭만)가 시작된 시각. 키는 `포트:pid:시작 시각`(다시 뜬 서버는 새로 센다). */
export type PortMemo = Map<string, { state: 'idle' | 'tabs'; since: number }>

function portKey(row: PortRow): string {
  return `${row.port}:${row.pid}:${row.startedAt ?? ''}`
}

/** Windows·macOS 는 경로 대소문자를 가리지 않고, 판별 경로(명령줄·작업 폴더)에 따라 표기가 다를 수 있다. */
function rootKey(root: string): string {
  return root.replace(/[\\/]+$/, '').toLowerCase()
}

/**
 * 안 쓰는 포트를 두 단계로 판단한다(스펙 §3-4).
 * - 같은 워크트리에 에이전트가 실행 중이면(쉬는 중이어도) 판단하지 않는다. 떠나면 처음부터 센다.
 * - 연결 0 이 기준 시간 이상 → 정리 후보, 탭 연결만 기준 시간 이상 → 확인해볼 것.
 * - 판별 불가 포트는 판단하지 않는다(불확실하면 후보에서 빼는 쪽).
 * 처음 본 포트는 그때부터 센다 — pitwall 이 켜지기 전 상태는 모르므로.
 */
export function judgePorts(
  rows: PortRow[],
  agents: AgentRow[],
  previous: PortMemo,
  now: number,
  thresholdMs: number
): { rows: PortRow[]; memo: PortMemo } {
  const agentRoots = new Set(agents.flatMap((a) => (a.worktree ? [rootKey(a.worktree.root)] : [])))
  const memo: PortMemo = new Map()
  const judged = rows.map((row): PortRow => {
    if (row.unresolvable || !row.worktree)
      return { ...row, judgement: null, idleSince: null, agentInWorktree: false }
    if (agentRoots.has(rootKey(row.worktree.root)))
      return { ...row, judgement: null, idleSince: null, agentInWorktree: true }

    const key = portKey(row)
    const state = row.clientCount > 0 ? 'tabs' : 'idle'
    const prev = previous.get(key)
    const since = prev && prev.state === state ? prev.since : now
    memo.set(key, { state, since })
    const due = now - since >= thresholdMs
    return {
      ...row,
      judgement: due ? (state === 'idle' ? 'candidate' : 'check') : null,
      idleSince: since,
      agentInWorktree: false
    }
  })
  return { rows: judged, memo }
}
