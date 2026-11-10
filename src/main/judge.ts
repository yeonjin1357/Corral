import { localEndpoints, peerPid } from './tcpPeers'
import type { AgentRow, ServerRow, TcpEntry } from '../shared/types'
import { agentCovers, worktreeKey } from '../shared/format'
import { selectionKey } from '../shared/keys'

/**
 * 서버별로 지금 상태(연결 0 / 탭만)가 시작된 시각. 키는 서버 선택 키(다시 뜬 서버는 새로 센다).
 * shielded: 이 샘플에 활동 중인 에이전트가 그 서버를 덮고 있었다(다음 샘플에 떠났으면 처음부터 센다). 없으면 아님.
 */
export type ServerMemo = Map<string, { state: 'idle' | 'tabs'; since: number; shielded?: boolean }>

const LOOPBACK = /^(127\.|::1$|::ffff:127\.)/

/**
 * 서버별 최근 사용 흔적(F9). 샘플 사이에만 잠깐 요청을 받는 서버(다른 서버·CLI 가 가끔 부르는 API)는 샘플 때
 * 연결 0 으로 보여 정리 후보에 잘못 오를 수 있어, 그 사이 요청이 오간 흔적을 찾는다.
 * - 서버 포트에 TIME_WAIT(최근 닫힌 연결)이 있다. Windows 는 소유 pid 가 0 이라 포트로 맞춘다.
 *   같은 PC 의 클라이언트가 먼저 닫으면 클라이언트 쪽(상대 포트 = 서버 포트, 루프백)에 남으므로 그것도 센다.
 * - 지난 샘플에 없던 ESTABLISHED 상대(주소:포트)가 생겼다. 처음 본 서버는 비교할 것이 없어 흔적으로 치지 않는다.
 * 키는 서버 선택 키. connections 는 다음 샘플에 넘길 지금 연결 상대 목록.
 */
export function activityOf(
  servers: ServerRow[],
  tcp: TcpEntry[],
  previous: Map<string, Set<string>>
): { activity: Map<string, boolean>; connections: Map<string, Set<string>> } {
  const activity = new Map<string, boolean>()
  const connections = new Map<string, Set<string>>()
  const owners = localEndpoints(tcp)
  for (const row of servers) {
    const key = selectionKey.server(row)
    const ports = new Set(row.ports)
    const pids = new Set([row.pid, ...row.descendantPids])
    const peers = new Set<string>()
    // 이 서버의 포트를 연 프로세스(부모·자식 JVM 등). 이들끼리의 연결은 사용이 아니다.
    const listeners = new Set(
      tcp
        .filter((t) => t.state === 'Listen' && ports.has(t.localPort) && pids.has(t.pid))
        .map((t) => t.pid)
    )
    let traced = false
    for (const t of tcp) {
      if (t.state === 'TimeWait') {
        if (ports.has(t.localPort) || (ports.has(t.remotePort) && LOOPBACK.test(t.remoteAddress)))
          traced = true
      } else if (t.state === 'Established' && ports.has(t.localPort) && pids.has(t.pid)) {
        // 서버를 이루는 포트 프로세스끼리의 루프백 연결은 사용이 아니다(서버가 띄운 앱 창 등은 사용).
        const peer = peerPid(t, owners)
        if (peer == null || !listeners.has(peer)) peers.add(`${t.remoteAddress}:${t.remotePort}`)
      }
    }
    const before = previous.get(key)
    if (before) for (const peer of peers) if (!before.has(peer)) traced = true
    activity.set(key, traced)
    connections.set(key, peers)
  }
  return { activity, connections }
}

/**
 * 오래 쉬는 세션이고 마지막 활동을 아는 에이전트(G2). 마지막 활동을 모르면 언제부터 쉬었는지 몰라 보호하는
 * 쪽(활동 중)으로 본다(불확실하면 후보에서 빼는 쪽).
 */
function resting(agent: AgentRow): agent is AgentRow & { lastActiveAt: number } {
  return agent.parked && agent.lastActiveAt != null
}

/**
 * 안 쓰는 서버를 두 단계로 판단한다(스펙 §3-4, G2). 서버(포트를 연 프로세스 트리) 단위라 포트가 여럿이어도 한 번만 센다.
 * - 덮는 에이전트 = 같은 워크트리(또는 상위 폴더 저장소)나 같은 작업 공간의 에이전트. 그 가운데 오래 쉬는 세션이
 *   아닌 것(쉬는 중이어도)이 활동 중이다.
 * - 연결 타이머는 늘 잰다. 활동 중인 에이전트가 덮고 있으면 판단만 하지 않는다.
 * - 타이머는 보호가 끝난 때보다 앞서지 않는다: 덮는 에이전트가 모두 오래 쉬면 그들의 마지막 활동 가운데 가장 늦은
 *   시각, 지난 샘플에 활동 중인 에이전트가 덮고 있었으면(떠났으면 — 오래 쉬는 에이전트가 남아 있어도) 지금.
 *   둘 다면 더 늦은 쪽부터 센다.
 * - 연결 0 이 기준 시간 이상 → 정리 후보, 탭 연결만 기준 시간 이상 → 확인해볼 것. 덮는 에이전트가 모두 오래 쉬는
 *   세션이면 연결 0 이어도 확인해볼 것까지만(정리 후보·정리 추천에 넣지 않는다).
 * - 판별 불가·워크트리를 모르는 서버는 판단하지 않는다(불확실하면 후보에서 빼는 쪽).
 * - 워크트리를 모르는 에이전트(작업 폴더를 못 읽는 수집 방식·관리자 권한 등)가 하나라도 있으면 그 에이전트의
 *   서버일 수 있어 정리 후보를 확인해볼 것으로 낮춘다.
 * 처음 본 서버는 그때부터 센다 — pitwall 이 켜지기 전 상태는 모르므로.
 * 사용 흔적(activity)은 "연결 0" 타이머만 지금으로 되돌린다. "탭만 연결"(폴링하는 대시보드 탭)은 새 연결을
 * 계속 만들어서, 여기에 쓰면 잊고 둔 탭이 영영 확인해볼 것이 되지 않는다.
 */
export function judgeServers(
  rows: ServerRow[],
  agents: AgentRow[],
  previous: ServerMemo,
  now: number,
  thresholdMs: number,
  activity: Map<string, boolean> = new Map()
): { rows: ServerRow[]; memo: ServerMemo } {
  const unknownAgent = agents.some((a) => !a.worktree)
  const memo: ServerMemo = new Map()
  const judged = rows.map((row): ServerRow => {
    if (row.unresolvable || !row.worktree)
      return {
        ...row,
        judgement: null,
        idleSince: null,
        agentInWorktree: false,
        parkedAgent: false,
        parkedSince: null
      }
    const root = row.worktree.root
    const workspace = row.workspace ? worktreeKey(row.workspace.root) : null
    const covering = agents.filter(
      (a) =>
        (a.worktree && agentCovers([a.worktree.root], root)) ||
        (workspace !== null && a.workspace && worktreeKey(a.workspace.root) === workspace)
    )

    const key = selectionKey.server(row)
    const state = row.clientCount > 0 ? 'tabs' : 'idle'
    const prev = previous.get(key)
    const traced = state === 'idle' && activity.get(key) === true
    const counted = prev && prev.state === state && !traced ? prev.since : now

    // 활동 중인 에이전트가 하나라도 덮으면 판단하지 않는다(타이머는 잰다).
    if (!covering.every(resting)) {
      memo.set(key, { state, since: counted, shielded: true })
      return {
        ...row,
        judgement: null,
        idleSince: counted,
        agentInWorktree: true,
        parkedAgent: false,
        parkedSince: null
      }
    }

    // 여기서 덮는 에이전트는 모두 오래 쉬는 세션(마지막 활동을 앎). 기간은 그 가운데 가장 늦은 활동부터.
    const parkedSince = covering.length ? Math.max(...covering.map((a) => a.lastActiveAt)) : null
    // 보호가 끝난 때보다 앞서 세지 않는다. 둘 다 해당하면 더 늦은 쪽:
    // (a) 덮는 에이전트가 모두 오래 쉬면 그들의 마지막 활동 가운데 가장 늦은 시각,
    // (b) 지난 샘플에 활동 중인 에이전트가 덮고 있었으면 지금(그 에이전트가 꺼졌으면 오래 쉬는 에이전트가 남아 있어도
    //     처음부터 센다). 활동 중이던 에이전트가 그대로 오래 쉬는 세션이 된 샘플에도 (b)가 걸려 그때부터 세는데,
    //     판단이 한 번 늦어질 뿐이라 둔다.
    const floor = Math.max(parkedSince ?? -Infinity, prev?.shielded ? now : -Infinity)
    const since = Math.max(counted, floor)
    // 보호가 끝났으므로 shielded 없이 기억한다(다음 샘플에 다시 지금부터 세지 않게).
    memo.set(key, { state, since })
    const parked = parkedSince !== null
    const due = now - since >= thresholdMs
    return {
      ...row,
      judgement: due
        ? state === 'idle' && !parked && !unknownAgent
          ? 'candidate'
          : 'check'
        : null,
      idleSince: since,
      agentInWorktree: parked,
      parkedAgent: parked,
      parkedSince
    }
  })
  return { rows: judged, memo }
}
