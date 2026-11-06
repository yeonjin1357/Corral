import type { AgentState } from '../shared/types'

/**
 * Claude Code 세션 하나. 훅 이벤트로만 알 수 있다. 이벤트에는 프로세스 정보가 없어서, 작업 폴더의 워크트리로
 * 행에 이어 붙이고, 수집 때 같은 워크트리의 Claude 프로세스와 짝지어(processKey) 끝났는지 판단한다.
 */
export interface ClaudeSession {
  id: string
  cwd: string
  state: AgentState
  updatedAt: number
  /** 처음 소식이 온 시각. 어느 프로세스의 세션인지 짝지을 때 쓴다. */
  firstSeen: number
  /** 짝지은 Claude 프로세스(`pid:시작 시각`). 아직 모르면 null. */
  processKey: string | null
}

/** 수집 때 본 최상위 Claude 프로세스. */
export interface LiveClaude {
  key: string
  /** 워크트리 키(worktreeKey). */
  rootKey: string
  startedAt: number | null
}

export type Sessions = Map<string, ClaudeSession>

/** 이 시간 동안 소식이 없으면 끝난 세션으로 본다(SessionEnd 를 못 받은 경우 대비). */
export const SESSION_EXPIRE_MS = 6 * 60 * 60 * 1000
const MAX_SESSIONS = 500
const MAX_ID_LENGTH = 200

/** 같은 워크트리에 세션이 여럿이면 앞쪽 상태를 보인다. 사용자가 봐야 할 것이 먼저. */
const PRIORITY: AgentState[] = ['waiting', 'working', 'error', 'idle']
function rank(state: AgentState): number {
  const i = PRIORITY.indexOf(state)
  return i < 0 ? PRIORITY.length : i
}

/** 이벤트가 정하는 다음 상태. null 은 "상태는 그대로(세션이 없으면 만들지 않음)". */
function nextState(
  ev: Record<string, unknown>,
  current: AgentState | undefined
): AgentState | null {
  switch (ev.hook_event_name) {
    case 'SessionStart':
      // 자동 압축 뒤에도 SessionStart 가 오지만 작업은 이어진다.
      return ev.source === 'compact' && current ? current : 'idle'
    case 'UserPromptSubmit':
    case 'PostToolUse':
      return 'working'
    case 'PermissionRequest':
      return 'waiting'
    case 'Notification':
      if (ev.notification_type === 'permission_prompt') return 'waiting'
      if (ev.notification_type === 'elicitation_dialog') return 'waiting'
      if (ev.notification_type === 'idle_prompt') return 'idle'
      return null
    case 'Stop':
      return 'idle'
    case 'StopFailure':
      return 'error'
    default:
      return null
  }
}

/** 훅 이벤트 하나를 반영한다. 바뀐 것이 있으면 true. 형식이 이상한 입력은 무시한다. */
export function applyHookEvent(sessions: Sessions, input: unknown, now: number): boolean {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return false
  const ev = input as Record<string, unknown>
  const id = ev.session_id
  if (typeof id !== 'string' || !id || id.length > MAX_ID_LENGTH) return false
  if (typeof ev.hook_event_name !== 'string') return false

  const existing = sessions.get(id)
  if (ev.hook_event_name === 'SessionEnd') return sessions.delete(id)

  const cwd = typeof ev.cwd === 'string' && ev.cwd ? ev.cwd : existing?.cwd
  const state = nextState(ev, existing?.state)
  if (!cwd || (!existing && !state)) return false

  // 최근 소식 순서를 유지해 넘칠 때 가장 오래된 것부터 버린다.
  sessions.delete(id)
  sessions.set(id, {
    id,
    cwd,
    state: state ?? existing!.state,
    updatedAt: now,
    firstSeen: existing?.firstSeen ?? now,
    processKey: existing?.processKey ?? null
  })
  while (sessions.size > MAX_SESSIONS) {
    const oldest = sessions.keys().next().value
    if (oldest === undefined) break
    sessions.delete(oldest)
  }
  return true
}

/**
 * 세션을 살아 있는 Claude 프로세스와 짝짓고, 끝난 세션을 버린다(SessionEnd 를 못 받은 경우 대비).
 * - 6시간 동안 소식이 없는 세션은 버린다.
 * - 짝지은 프로세스가 이번 샘플에 없으면(꺼짐) 버린다. 같은 워크트리에 다른 Claude 가 살아 있어도 마찬가지.
 * - 아직 짝이 없고 샘플 전에 소식이 온 세션(그 프로세스는 이번 샘플에 있어야 함)은 같은 워크트리의 짝 없는
 *   Claude 중 시작 시각이 세션보다 앞서고 가장 가까운 것과 짝짓는다.
 *   - 그 워크트리에 Claude 가 하나도 없으면 버린다.
 *   - 모두 짝이 있으면, 이 세션보다 먼저 소식이 끊긴 세션 중 가장 오래된 것의 프로세스가 새 세션으로
 *     넘어온 것으로 보고(/clear 등) 그 예전 세션을 버린다.
 * - 샘플 뒤에 온 세션은 다음 샘플까지 두고, 워크트리를 모르는 세션은 어느 행에도 연결되지 않으니 만료까지 둔다.
 */
export function reconcileSessions(
  sessions: Sessions,
  opts: {
    now: number
    sampledAt: number
    live: LiveClaude[]
    rootOfCwd: (cwd: string) => string | null
  }
): void {
  const liveKeys = new Set(opts.live.map((l) => l.key))
  for (const [id, s] of sessions) {
    if (opts.now - s.updatedAt >= SESSION_EXPIRE_MS) sessions.delete(id)
    else if (s.processKey && !liveKeys.has(s.processKey)) sessions.delete(id)
  }

  const unlinked = [...sessions.values()]
    .filter((s) => !s.processKey && s.firstSeen < opts.sampledAt)
    .sort((a, b) => a.firstSeen - b.firstSeen)
  for (const session of unlinked) {
    const root = opts.rootOfCwd(session.cwd)
    if (!root) continue
    const candidates = opts.live.filter((l) => l.rootKey === root)
    if (candidates.length === 0) {
      sessions.delete(session.id)
      continue
    }
    const owner = new Map<string, ClaudeSession>()
    for (const s of sessions.values()) if (s.processKey) owner.set(s.processKey, s)

    const free = candidates.filter((c) => !owner.has(c.key))
    if (free.length) {
      session.processKey = closestBefore(free, session.firstSeen).key
      continue
    }
    const replaced = candidates
      .map((c) => owner.get(c.key)!)
      .filter((s) => s.updatedAt <= session.firstSeen)
      .sort((a, b) => a.updatedAt - b.updatedAt)[0]
    if (!replaced) continue
    sessions.delete(replaced.id)
    session.processKey = replaced.processKey
  }
}

/** 세션보다 먼저 시작한 것 중 가장 늦게 시작한 프로세스. 없으면 가장 늦게 시작한 것. */
function closestBefore(candidates: LiveClaude[], firstSeen: number): LiveClaude {
  const started = (c: LiveClaude): number => c.startedAt ?? Number.NEGATIVE_INFINITY
  const before = candidates.filter((c) => started(c) <= firstSeen)
  const pool = before.length ? before : candidates
  return pool.reduce((best, c) => (started(c) > started(best) ? c : best))
}

/** 워크트리의 Claude 상태. 그 워크트리 세션이 없으면 null. */
export function stateForWorktree(
  sessions: Sessions,
  root: string,
  rootOfCwd: (cwd: string) => string | null
): AgentState | null {
  let best: AgentState | null = null
  for (const s of sessions.values()) {
    if (rootOfCwd(s.cwd) !== root) continue
    if (best === null || rank(s.state) < rank(best)) best = s.state
  }
  return best
}
