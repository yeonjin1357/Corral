import type { AgentState } from '../shared/types'

/** Claude Code 세션 하나. 훅 이벤트로만 알 수 있다(프로세스와 직접 연결되지 않고 작업 폴더로 이어 붙인다). */
export interface ClaudeSession {
  id: string
  cwd: string
  state: AgentState
  updatedAt: number
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
  sessions.set(id, { id, cwd, state: state ?? existing!.state, updatedAt: now })
  while (sessions.size > MAX_SESSIONS) {
    const oldest = sessions.keys().next().value
    if (oldest === undefined) break
    sessions.delete(oldest)
  }
  return true
}

/**
 * 끝난 세션을 버린다.
 * - 6시간 동안 소식이 없는 세션
 * - 샘플을 뜨기 전에 소식이 온 세션인데, 그 워크트리에 Claude 프로세스가 없는 세션(SessionEnd 없이 꺼짐).
 *   샘플 뒤에 온 세션은 프로세스가 샘플 뒤에 시작했을 수 있어 다음 샘플까지 둔다.
 *   워크트리를 모르는 세션은 어느 행에도 연결되지 않으니 만료까지 둔다.
 */
export function pruneSessions(
  sessions: Sessions,
  opts: {
    now: number
    sampledAt?: number
    liveRoots?: Set<string>
    rootOfCwd?: (cwd: string) => string | null
  }
): void {
  for (const [id, s] of sessions) {
    if (opts.now - s.updatedAt >= SESSION_EXPIRE_MS) {
      sessions.delete(id)
      continue
    }
    if (opts.sampledAt == null || !opts.liveRoots || !opts.rootOfCwd) continue
    if (s.updatedAt >= opts.sampledAt) continue
    const root = opts.rootOfCwd(s.cwd)
    if (root && !opts.liveRoots.has(root)) sessions.delete(id)
  }
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
