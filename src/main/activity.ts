import type { AgentRow } from '../shared/types'
import { agentKey } from '../shared/keys'
import { WORKING_CPU_PERCENT } from './agents'
import { DONE_MIN_WORK_MS } from './notifier'

/**
 * 에이전트의 마지막 활동과 오래 쉬는 세션(G2). 정확한 시각(훅·세션 기록)이 없을 때를 위해 pitwall 이 직접 본 것을
 * 기억한다: 에이전트를 처음 본 시각과 마지막으로 작업 중으로 본 시각. 키는 agentKey(`pid:시작 시각`).
 */
export type SeenMemo = Map<string, { firstSeen: number; lastWorking: number | null }>

/** 이번에 본 에이전트로 기억을 새로 한다. 지금 있는 에이전트만 남긴다. */
export function trackSeen(
  agents: Pick<AgentRow, 'pid' | 'startedAt' | 'state'>[],
  previous: SeenMemo,
  now: number
): SeenMemo {
  const next: SeenMemo = new Map()
  for (const a of agents) {
    const key = agentKey(a)
    const prev = previous.get(key)
    next.set(key, {
      firstSeen: prev?.firstSeen ?? now,
      lastWorking: a.state === 'working' ? now : (prev?.lastWorking ?? null)
    })
  }
  return next
}

/**
 * 마지막 활동 시각. 훅·세션 기록·세션 파일로 아는 상태는 그 정확한 시각(exact, 없으면 본 기록), CPU 추정은 pitwall 이
 * 마지막으로 작업 중으로 본 시각이고 본 적이 없으면 처음 본 시각(그 전은 모르므로 보수적으로).
 * CPU 를 읽지 못해 확인 중(unknown)인 CPU 추정은 근거가 없어 null(오래 쉬는 세션으로 보지 않는다).
 */
export function lastActiveOf(
  agent: Pick<AgentRow, 'stateSource' | 'state'>,
  exact: number | null,
  seen: { firstSeen: number; lastWorking: number | null }
): number | null {
  const observed = seen.lastWorking ?? seen.firstSeen
  if (agent.stateSource !== 'cpu') return exact ?? observed
  return agent.state === 'unknown' ? null : observed
}

/**
 * 오래 쉬는 세션: 쉬는 중·오류·확인 중이고 마지막 활동이 기준 시간(parkedMs) 이상 전.
 * 작업 중·응답 대기는 아무리 오래여도 아니다. 마지막 활동을 모르면 아니다.
 */
export function isParked(
  agent: Pick<AgentRow, 'state' | 'lastActiveAt'>,
  now: number,
  parkedMs: number
): boolean {
  const resting = agent.state === 'idle' || agent.state === 'error' || agent.state === 'unknown'
  return resting && agent.lastActiveAt != null && now - agent.lastActiveAt >= parkedMs
}

/** 조용한 에이전트(G3c)로 보는 시간. */
export const QUIET_MS = 15 * 60 * 1000

/** 에이전트별 조용한 조건(calm)이 이어진 첫 시각(pitwall 이 처음 본 때). 키는 agentKey. 저장하지 않는다. */
export type CalmMemo = Map<string, number>

/**
 * 조용한 조건: 훅으로 작업 중이고 트리 CPU 가 작업 기준(WORKING_CPU_PERCENT) 아래. CPU 를 모르면 아니다.
 * CPU 추정·세션 기록·세션 파일 상태와 쉬는 중·응답 대기는 아니다.
 */
function isCalm(agent: Pick<AgentRow, 'stateSource' | 'state' | 'cpuPercent'>): boolean {
  return (
    agent.stateSource === 'hook' &&
    agent.state === 'working' &&
    agent.cpuPercent != null &&
    agent.cpuPercent < WORKING_CPU_PERCENT
  )
}

/**
 * 조용한 에이전트(G3c)를 채운다. 조용한 조건이 이어진 첫 시각과 마지막 이벤트(lastActiveAt) 가운데 늦은 쪽부터
 * QUIET_MS 이상이면 quietSince 는 그 시각. 조건이 끊기면(CPU 를 씀·모름, 상태가 바뀜) 기억에서 빼고 처음부터 센다.
 * 기억에는 지금 조건이 이어지는 에이전트만 남긴다.
 */
export function trackQuiet(
  agents: AgentRow[],
  previous: CalmMemo,
  now: number
): { agents: AgentRow[]; memo: CalmMemo } {
  const memo: CalmMemo = new Map()
  const rows = agents.map((a): AgentRow => {
    if (!isCalm(a)) return { ...a, quietSince: null }
    const key = agentKey(a)
    const calm = previous.get(key) ?? now
    memo.set(key, calm)
    const start = Math.max(calm, a.lastActiveAt ?? calm)
    return { ...a, quietSince: now - start >= QUIET_MS ? start : null }
  })
  return { agents: rows, memo }
}

/**
 * 수집 사이(훅 이벤트가 왔을 때)의 조용함: 그 뒤 새 이벤트가 왔거나(lastActiveAt > quietSince) 더는 조용한 조건이
 * 아니면 null, 아니면 그대로. 새로 붙이는 것은 다음 수집(trackQuiet)이 한다.
 */
export function stillQuiet(
  agent: Pick<AgentRow, 'stateSource' | 'state' | 'cpuPercent' | 'lastActiveAt' | 'quietSince'>
): number | null {
  const { quietSince, lastActiveAt } = agent
  if (quietSince == null || !isCalm(agent)) return null
  return lastActiveAt != null && lastActiveAt > quietSince ? null : quietSince
}

/**
 * 새로 끝남: 작업을 끝냈는데 사용자가 아직 보지 않은 에이전트. working 은 지금 하는 작업이 시작된 시각, unseen 은 끝난
 * 시각, held 는 백그라운드 작업을 남기고 멈춘 작업이 시작된 시각(깨어나 이어 가면 거기서부터 센다). 키는 모두 agentKey.
 * 저장하지 않는다.
 */
export interface DoneMemo {
  working: Map<string, number>
  unseen: Map<string, number>
  held: Map<string, number>
}
export const EMPTY_DONE: DoneMemo = { working: new Map(), unseen: new Map(), held: new Map() }

/**
 * 백그라운드 작업과의 관계: 'paused' 는 백그라운드 작업(돌고 있는 명령·예약된 깨우기)을 남기고 멈춘 것, 'woken' 은 그렇게
 * 멈췄다가 사용자의 새 요청 없이 다시 일하는 것(백그라운드 작업이 깨웠다). 모르거나 아니면 null.
 */
export type DoneBackground = 'paused' | 'woken' | null

/** 표시가 없는 행(doneSince 를 뗀다 — 지난 스냅샷의 행을 다시 볼 때 옛 표시가 남지 않게). */
function withoutDone(agent: AgentRow): AgentRow {
  if (agent.doneSince === undefined) return agent
  const rest = { ...agent }
  delete rest.doneSince
  return rest
}

/**
 * 새로 끝남을 채운다. 정확한 상태(CPU 추정 아님)로 일하다가 쉬는 중이 됐고 그 작업이 2분(작업 끝남 알림·기록과 같은
 * 기준, DONE_MIN_WORK_MS)을 넘겼으면, 사용자가 볼 때까지 doneSince(끝난 시각)를 붙인다.
 * - 작업은 처음 작업 중이 된 때부터 쉬는 중이 될 때까지다(권한을 기다린 시간도 그 작업이다).
 * - 다시 일하거나 응답을 기다리면 표시를 거둔다(새 요청을 보냈다 = 봤다). 오류로 끝난 것은 표시하지 않는다.
 * - 백그라운드 작업을 남기고 멈춘 것(background 가 'paused')도 끝난 것으로 표시한다 — 개발 서버를 띄워 둔 채 끝낸
 *   작업을 놓치지 않게. 그 작업의 시작은 기억해 두었다가, 백그라운드 작업이 깨워 이어 가면('woken') 거기서부터 센다
 *   (기다리던 명령이 끝나 잠깐 마무리하고 끝난 것도 표시하게). 새 요청으로 시작한 작업은 새로 센다.
 * 기억에는 지금 있는 에이전트만 남긴다.
 */
export function trackDone(
  agents: AgentRow[],
  previous: DoneMemo,
  background: (agent: AgentRow) => DoneBackground
): { agents: AgentRow[]; memo: DoneMemo } {
  const working = new Map<string, number>()
  const unseen = new Map<string, number>()
  const held = new Map<string, number>()
  const rows = agents.map((a): AgentRow => {
    if (a.stateSource === 'cpu') return withoutDone(a)
    const key = agentKey(a)
    const started = previous.working.get(key)
    if (a.state === 'working' || a.state === 'waiting') {
      const since =
        started ??
        (background(a) === 'woken' ? previous.held.get(key) : undefined) ??
        (a.state === 'working' ? a.stateSince : null)
      if (since != null) working.set(key, since)
      return withoutDone(a)
    }
    if (a.state !== 'idle') return withoutDone(a)
    const from = started ?? previous.held.get(key)
    if (from !== undefined && background(a) === 'paused') held.set(key, from)
    const finished =
      started !== undefined && a.stateSince != null && a.stateSince - started >= DONE_MIN_WORK_MS
        ? a.stateSince
        : undefined
    const doneSince = previous.unseen.get(key) ?? finished
    if (doneSince === undefined) return withoutDone(a)
    unseen.set(key, doneSince)
    return { ...a, doneSince }
  })
  return { agents: rows, memo: { working, unseen, held } }
}

/** 사용자가 봤다(Corral 에서 창으로 갔거나 표시를 닫았다): 그 에이전트의 표시를 거둔다. */
export function markDoneSeen(memo: DoneMemo, key: string): DoneMemo {
  if (!memo.unseen.has(key)) return memo
  const unseen = new Map(memo.unseen)
  unseen.delete(key)
  return { ...memo, unseen }
}
