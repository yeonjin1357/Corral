import {
  applyHookEvent,
  pruneSessions,
  SESSION_EXPIRE_MS,
  stateForWorktree,
  type Sessions
} from './sessions'
import type { AgentState } from '../shared/types'

const CWD = 'C:\\work\\shop-web'

function ev(name: string, extra: Record<string, unknown> = {}): Record<string, unknown> {
  return { session_id: 's1', cwd: CWD, hook_event_name: name, ...extra }
}

function stateAfter(...events: Record<string, unknown>[]): AgentState | undefined {
  const sessions: Sessions = new Map()
  events.forEach((e, i) => applyHookEvent(sessions, e, 1000 + i))
  return sessions.get('s1')?.state
}

describe('훅 이벤트 → 세션 상태', () => {
  test.each<[string, Record<string, unknown>, AgentState]>([
    ['SessionStart', {}, 'idle'],
    ['UserPromptSubmit', {}, 'working'],
    ['PostToolUse', {}, 'working'],
    ['PermissionRequest', {}, 'waiting'],
    ['Notification', { notification_type: 'permission_prompt' }, 'waiting'],
    ['Notification', { notification_type: 'elicitation_dialog' }, 'waiting'],
    ['Notification', { notification_type: 'idle_prompt' }, 'idle'],
    ['Stop', {}, 'idle'],
    ['StopFailure', {}, 'error']
  ])('%s %o → %s', (name, extra, expected) => {
    expect(stateAfter(ev('UserPromptSubmit'), ev(name, extra))).toBe(expected)
  })

  test('SessionEnd 는 세션을 지운다', () => {
    expect(stateAfter(ev('UserPromptSubmit'), ev('SessionEnd'))).toBeUndefined()
  })

  test('압축 뒤의 SessionStart(source: compact)는 작업 중 상태를 바꾸지 않는다', () => {
    expect(stateAfter(ev('UserPromptSubmit'), ev('SessionStart', { source: 'compact' }))).toBe(
      'working'
    )
    expect(stateAfter(ev('SessionStart', { source: 'compact' }))).toBe('idle')
  })

  test('모르는 이벤트·다른 알림은 상태를 바꾸지 않고, 세션이 없으면 만들지 않는다', () => {
    expect(stateAfter(ev('UserPromptSubmit'), ev('PreCompact'))).toBe('working')
    expect(
      stateAfter(ev('PermissionRequest'), ev('Notification', { notification_type: 'auth_success' }))
    ).toBe('waiting')
    expect(stateAfter(ev('SubagentStop'))).toBeUndefined()
  })

  test('작업 폴더와 마지막 시각을 갱신하고, cwd 가 없는 이벤트는 이전 cwd 를 쓴다', () => {
    const sessions: Sessions = new Map()
    applyHookEvent(sessions, ev('SessionStart'), 1000)
    applyHookEvent(sessions, { session_id: 's1', hook_event_name: 'UserPromptSubmit' }, 2000)
    expect(sessions.get('s1')).toEqual({ id: 's1', cwd: CWD, state: 'working', updatedAt: 2000 })
  })

  test.each<[string, unknown]>([
    ['객체가 아님', 'hello'],
    ['null', null],
    ['session_id 없음', { cwd: CWD, hook_event_name: 'Stop' }],
    ['session_id 가 문자열이 아님', { session_id: 1, cwd: CWD, hook_event_name: 'Stop' }],
    ['session_id 가 너무 김', { session_id: 'x'.repeat(201), cwd: CWD, hook_event_name: 'Stop' }],
    ['이벤트 이름 없음', { session_id: 's1', cwd: CWD }],
    ['새 세션인데 cwd 없음', { session_id: 's1', hook_event_name: 'SessionStart' }]
  ])('이상한 입력(%s)은 무시한다', (_name, input) => {
    const sessions: Sessions = new Map()
    expect(applyHookEvent(sessions, input, 1000)).toBe(false)
    expect(sessions.size).toBe(0)
  })

  test('세션이 너무 많으면 가장 오래 소식 없는 것부터 버린다(500개)', () => {
    const sessions: Sessions = new Map()
    for (let i = 0; i < 501; i++)
      applyHookEvent(sessions, { ...ev('SessionStart'), session_id: `s${i}` }, 1000 + i)
    expect(sessions.size).toBe(500)
    expect(sessions.has('s0')).toBe(false)
    expect(sessions.has('s500')).toBe(true)
  })
})

describe('세션 정리', () => {
  test('6시간 동안 소식이 없으면 버린다', () => {
    const sessions: Sessions = new Map()
    applyHookEvent(sessions, ev('SessionStart'), 1000)
    pruneSessions(sessions, { now: 1000 + SESSION_EXPIRE_MS - 1 })
    expect(sessions.size).toBe(1)
    pruneSessions(sessions, { now: 1000 + SESSION_EXPIRE_MS })
    expect(sessions.size).toBe(0)
  })

  test('샘플 전에 온 세션인데 그 워크트리에 Claude 가 없으면(꺼진 세션) 버린다', () => {
    const sessions: Sessions = new Map()
    applyHookEvent(sessions, { ...ev('UserPromptSubmit'), session_id: 'dead' }, 1000)
    applyHookEvent(sessions, { ...ev('UserPromptSubmit'), session_id: 'new' }, 3000)
    applyHookEvent(
      sessions,
      { ...ev('UserPromptSubmit'), session_id: 'elsewhere', cwd: 'C:\\tmp' },
      1000
    )
    pruneSessions(sessions, {
      now: 4000,
      sampledAt: 2000,
      liveRoots: new Set(['C:\\work\\api']),
      rootOfCwd: (cwd) => (cwd === CWD ? CWD : null)
    })
    // 샘플 뒤에 온 세션(new)은 다음 샘플까지 기다린다. 워크트리를 모르는 세션은 연결될 일이 없어 남겨 둔다.
    expect([...sessions.keys()].sort()).toEqual(['elsewhere', 'new'])
  })
})

describe('워크트리 상태', () => {
  const rootOfCwd = (cwd: string): string | null =>
    cwd.startsWith(CWD) ? CWD : cwd.startsWith('C:\\work\\api') ? 'C:\\work\\api' : null

  function sessionsWith(...entries: [string, string, AgentState][]): Sessions {
    return new Map(entries.map(([id, cwd, state]) => [id, { id, cwd, state, updatedAt: 1 }]))
  }

  test('같은 워크트리 세션 중 권한 대기 > 작업 중 > 오류 > 쉬는 중', () => {
    const order: AgentState[] = ['idle', 'error', 'working', 'waiting']
    for (let i = 0; i < order.length; i++) {
      const s = sessionsWith(
        ...order
          .slice(0, i + 1)
          .map((state, j): [string, string, AgentState] => [`s${j}`, CWD, state])
      )
      expect(stateForWorktree(s, CWD, rootOfCwd)).toBe(order[i])
    }
  })

  test('하위 폴더에서 실행한 세션도 같은 워크트리로 보고, 다른 워크트리 세션은 섞지 않는다', () => {
    const s = sessionsWith(
      ['a', CWD + '\\packages\\web', 'working'],
      ['b', 'C:\\work\\api', 'waiting']
    )
    expect(stateForWorktree(s, CWD, rootOfCwd)).toBe('working')
    expect(stateForWorktree(s, 'C:\\work\\none', rootOfCwd)).toBeNull()
  })
})
