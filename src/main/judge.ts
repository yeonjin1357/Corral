import type { AgentRow, ServerRow } from '../shared/types'
import { agentCovers, worktreeKey } from '../shared/format'
import { selectionKey } from '../shared/keys'

/** 서버별로 지금 상태(연결 0 / 탭만)가 시작된 시각. 키는 서버 선택 키(다시 뜬 서버는 새로 센다). */
export type ServerMemo = Map<string, { state: 'idle' | 'tabs'; since: number }>

/**
 * 안 쓰는 서버를 두 단계로 판단한다(스펙 §3-4). 서버(포트를 연 프로세스 트리) 단위라 포트가 여럿이어도 한 번만 센다.
 * - 같은 워크트리(또는 상위 폴더 저장소)에 에이전트가 실행 중이면(쉬는 중이어도) 판단하지 않는다. 떠나면 처음부터 센다.
 * - 연결 0 이 기준 시간 이상 → 정리 후보, 탭 연결만 기준 시간 이상 → 확인해볼 것.
 * - 판별 불가 서버는 판단하지 않는다(불확실하면 후보에서 빼는 쪽).
 * - 워크트리를 모르는 에이전트(작업 폴더를 못 읽는 수집 방식·관리자 권한 등)가 하나라도 있으면 그 에이전트의
 *   서버일 수 있어 정리 후보를 확인해볼 것으로 낮춘다.
 * 처음 본 서버는 그때부터 센다 — pitwall 이 켜지기 전 상태는 모르므로.
 */
export function judgeServers(
  rows: ServerRow[],
  agents: AgentRow[],
  previous: ServerMemo,
  now: number,
  thresholdMs: number
): { rows: ServerRow[]; memo: ServerMemo } {
  const agentRoots = agents.flatMap((a) => (a.worktree ? [worktreeKey(a.worktree.root)] : []))
  const unknownAgent = agents.some((a) => !a.worktree)
  const memo: ServerMemo = new Map()
  const judged = rows.map((row): ServerRow => {
    if (row.unresolvable || !row.worktree)
      return { ...row, judgement: null, idleSince: null, agentInWorktree: false }
    if (agentCovers(agentRoots, row.worktree.root))
      return { ...row, judgement: null, idleSince: null, agentInWorktree: true }

    const key = selectionKey.server(row)
    const state = row.clientCount > 0 ? 'tabs' : 'idle'
    const prev = previous.get(key)
    const since = prev && prev.state === state ? prev.since : now
    memo.set(key, { state, since })
    const due = now - since >= thresholdMs
    return {
      ...row,
      judgement: due ? (state === 'idle' && !unknownAgent ? 'candidate' : 'check') : null,
      idleSince: since,
      agentInWorktree: false
    }
  })
  return { rows: judged, memo }
}
