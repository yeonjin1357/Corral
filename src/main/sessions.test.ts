import {
  applyHookEvent,
  reconcileSessions,
  SESSION_EXPIRE_MS,
  hookStateForWorktree,
  stateForWorktree,
  type LiveClaude,
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

  test('권한 대기 중에 다른 도구(병렬 실행)가 끝나도 권한 대기를 유지하고, 권한을 요청한 도구가 끝나야 작업 중', () => {
    const sessions: Sessions = new Map()
    applyHookEvent(sessions, ev('PermissionRequest', { tool_name: 'Bash' }), 1000)
    applyHookEvent(sessions, ev('PostToolUse', { tool_name: 'Read' }), 1001)
    expect(sessions.get('s1')?.state).toBe('waiting')
    applyHookEvent(sessions, ev('Notification', { notification_type: 'permission_prompt' }), 1002)
    applyHookEvent(sessions, ev('PostToolUse', { tool_name: 'Grep' }), 1003)
    expect(sessions.get('s1')?.state).toBe('waiting')
    applyHookEvent(sessions, ev('PostToolUse', { tool_name: 'Bash' }), 1004)
    expect(sessions.get('s1')?.state).toBe('working')
  })

  test('어떤 도구가 기다리는지 모르면(알림만 옴) 다음 도구가 끝날 때 작업 중으로 본다', () => {
    expect(
      stateAfter(
        ev('UserPromptSubmit'),
        ev('Notification', { notification_type: 'permission_prompt' }),
        ev('PostToolUse', { tool_name: 'Read' })
      )
    ).toBe('working')
  })

  test('권한 대기는 사용자가 입력하거나(UserPromptSubmit) 응답이 끝나면(Stop) 풀린다', () => {
    const waiting = ev('PermissionRequest', { tool_name: 'Bash' })
    expect(stateAfter(waiting, ev('UserPromptSubmit'))).toBe('working')
    expect(stateAfter(waiting, ev('Stop'))).toBe('idle')
    expect(stateAfter(waiting, ev('Notification', { notification_type: 'idle_prompt' }))).toBe(
      'idle'
    )
  })

  test('응답이 끝난(Stop) 직후 늦게 도착한 도구 사용 이벤트는 무시한다(훅은 따로따로 비동기로 온다)', () => {
    const sessions: Sessions = new Map()
    applyHookEvent(sessions, ev('UserPromptSubmit'), 1000)
    applyHookEvent(sessions, ev('Stop'), 2000)
    applyHookEvent(sessions, ev('PostToolUse', { tool_name: 'Bash' }), 2500)
    expect(sessions.get('s1')?.state).toBe('idle')
    applyHookEvent(sessions, ev('StopFailure'), 3000)
    applyHookEvent(sessions, ev('PostToolUse', { tool_name: 'Bash' }), 4000)
    expect(sessions.get('s1')?.state).toBe('error')
    // 새 입력이 오면 다시 센다.
    applyHookEvent(sessions, ev('UserPromptSubmit'), 4500)
    applyHookEvent(sessions, ev('Stop'), 5000)
    applyHookEvent(sessions, ev('UserPromptSubmit'), 5100)
    applyHookEvent(sessions, ev('PostToolUse', { tool_name: 'Read' }), 5200)
    expect(sessions.get('s1')?.state).toBe('working')
    // 한참 지난 도구 이벤트는 그대로 반영한다.
    applyHookEvent(sessions, ev('Stop'), 6000)
    applyHookEvent(sessions, ev('PostToolUse', { tool_name: 'Read' }), 12_000)
    expect(sessions.get('s1')?.state).toBe('working')
  })

  test('지나치게 긴 cwd(4096자 초과)는 받지 않는다(새 세션은 만들지 않고, 있던 세션은 이전 cwd 유지)', () => {
    const sessions: Sessions = new Map()
    const long = 'C:\\' + 'a'.repeat(5000)
    expect(applyHookEvent(sessions, ev('SessionStart', { cwd: long }), 1000)).toBe(false)
    applyHookEvent(sessions, ev('SessionStart'), 1000)
    applyHookEvent(sessions, ev('UserPromptSubmit', { cwd: long }), 2000)
    expect(sessions.get('s1')?.cwd).toBe(CWD)
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
    expect(sessions.get('s1')).toEqual({
      id: 's1',
      cwd: CWD,
      state: 'working',
      updatedAt: 2000,
      firstSeen: 1000,
      processKey: null,
      stateSince: 2000,
      stoppedAt: null
    })
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

describe('세션 정리(살아 있는 Claude 프로세스와 짝짓기)', () => {
  const ROOT = CWD.toLowerCase()
  const rootOfCwd = (cwd: string): string | null =>
    cwd.toLowerCase().startsWith(ROOT)
      ? ROOT
      : cwd.startsWith('C:\\work\\api')
        ? 'c:\\work\\api'
        : null
  const claude = (key: string, startedAt: number | null = 0): LiveClaude => ({
    key,
    rootKey: ROOT,
    startedAt
  })
  const start = (sessions: Sessions, id: string, at: number, name = 'SessionStart'): void => {
    applyHookEvent(sessions, { ...ev(name), session_id: id }, at)
  }

  test('6시간 동안 소식이 없으면 버린다', () => {
    const sessions: Sessions = new Map()
    start(sessions, 's1', 1000)
    const opts = { sampledAt: 500, live: [claude('p1')], rootOfCwd }
    reconcileSessions(sessions, { ...opts, now: 1000 + SESSION_EXPIRE_MS - 1 })
    expect(sessions.size).toBe(1)
    reconcileSessions(sessions, { ...opts, now: 1000 + SESSION_EXPIRE_MS })
    expect(sessions.size).toBe(0)
  })

  test('샘플 전에 온 세션은 같은 워크트리의 짝 없는 Claude 와 짝짓는다', () => {
    const sessions: Sessions = new Map()
    start(sessions, 's1', 1000)
    reconcileSessions(sessions, { now: 3000, sampledAt: 2000, live: [claude('p1')], rootOfCwd })
    expect(sessions.get('s1')).toMatchObject({ processKey: 'p1', firstSeen: 1000 })
  })

  test('짝지은 프로세스가 사라지면, 같은 워크트리에 다른 Claude 가 살아 있어도 그 세션은 버린다', () => {
    const sessions: Sessions = new Map()
    start(sessions, 'a', 1000, 'PermissionRequest')
    start(sessions, 'b', 1100)
    reconcileSessions(sessions, {
      now: 3000,
      sampledAt: 2000,
      live: [claude('pa', 900), claude('pb', 1050)],
      rootOfCwd
    })
    expect(sessions.get('a')?.processKey).toBe('pa')
    expect(sessions.get('b')?.processKey).toBe('pb')
    // a 의 터미널 창을 닫음(SessionEnd 없음). b 는 계속 쉬는 중.
    reconcileSessions(sessions, {
      now: 9000,
      sampledAt: 8000,
      live: [claude('pb', 1050)],
      rootOfCwd
    })
    expect([...sessions.keys()]).toEqual(['b'])
  })

  test('한 수집 주기 안에 Claude 를 껐다 다시 켜도 옛 세션은 버리고 새 세션을 새 프로세스와 짝짓는다', () => {
    const sessions: Sessions = new Map()
    start(sessions, 'old', 1000, 'PermissionRequest')
    reconcileSessions(sessions, {
      now: 3000,
      sampledAt: 2000,
      live: [claude('p1', 900)],
      rootOfCwd
    })
    start(sessions, 'new', 5000)
    reconcileSessions(sessions, {
      now: 9000,
      sampledAt: 8000,
      live: [claude('p2', 4900)],
      rootOfCwd
    })
    expect([...sessions.keys()]).toEqual(['new'])
    expect(sessions.get('new')?.processKey).toBe('p2')
  })

  test('한 프로세스에서 새 세션이 시작되면(SessionEnd 없이) 그 프로세스의 예전 세션은 버린다', () => {
    const sessions: Sessions = new Map()
    start(sessions, 'old', 1000, 'PermissionRequest')
    reconcileSessions(sessions, {
      now: 3000,
      sampledAt: 2000,
      live: [claude('p1', 900)],
      rootOfCwd
    })
    start(sessions, 'cleared', 4000)
    reconcileSessions(sessions, {
      now: 9000,
      sampledAt: 8000,
      live: [claude('p1', 900)],
      rootOfCwd
    })
    expect([...sessions.keys()]).toEqual(['cleared'])
    expect(sessions.get('cleared')?.processKey).toBe('p1')
  })

  test('두 Claude 와 두 세션은 시작 시각이 가까운 쪽끼리 짝짓는다', () => {
    const sessions: Sessions = new Map()
    start(sessions, 'late', 5000)
    start(sessions, 'early', 1000)
    reconcileSessions(sessions, {
      now: 9000,
      sampledAt: 8000,
      live: [claude('p-late', 4900), claude('p-early', 900)],
      rootOfCwd
    })
    expect(sessions.get('early')?.processKey).toBe('p-early')
    expect(sessions.get('late')?.processKey).toBe('p-late')
  })

  test('샘플 뒤에 온 세션은 다음 샘플까지 기다리고, 워크트리를 모르는 세션은 만료까지 둔다', () => {
    const sessions: Sessions = new Map()
    start(sessions, 'dead', 1000)
    start(sessions, 'new', 3000)
    applyHookEvent(
      sessions,
      { ...ev('SessionStart'), session_id: 'elsewhere', cwd: 'C:\\tmp' },
      1000
    )
    reconcileSessions(sessions, { now: 4000, sampledAt: 2000, live: [], rootOfCwd })
    expect([...sessions.keys()].sort()).toEqual(['elsewhere', 'new'])
    expect(sessions.get('new')?.processKey).toBeNull()
  })
})

describe('워크트리 상태', () => {
  const rootOfCwd = (cwd: string): string | null =>
    cwd.startsWith(CWD) ? CWD : cwd.startsWith('C:\\work\\api') ? 'C:\\work\\api' : null

  function sessionsWith(...entries: [string, string, AgentState][]): Sessions {
    return new Map(
      entries.map(([id, cwd, state]) => [
        id,
        { id, cwd, state, updatedAt: 1, firstSeen: 1, processKey: null }
      ])
    )
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

describe('상태 시작 시각(F3)', () => {
  test('훅 상태의 시작 시각은 상태가 바뀐 이벤트 시각, 같은 상태 이벤트가 또 와도 그대로', () => {
    const sessions: Sessions = new Map()
    const root = (cwd: string): string | null => (cwd.startsWith(CWD) ? CWD : null)
    applyHookEvent(sessions, ev('UserPromptSubmit'), 1000)
    applyHookEvent(sessions, ev('PostToolUse', { tool_name: 'Bash' }), 2000)
    expect(hookStateForWorktree(sessions, CWD, root)).toEqual({ state: 'working', since: 1000 })
    applyHookEvent(sessions, ev('Stop'), 9000)
    expect(hookStateForWorktree(sessions, CWD, root)).toEqual({ state: 'idle', since: 9000 })
    applyHookEvent(sessions, ev('Notification', { notification_type: 'idle_prompt' }), 70_000)
    expect(hookStateForWorktree(sessions, CWD, root)).toEqual({ state: 'idle', since: 9000 })
  })

  test('같은 워크트리에 같은 상태 세션이 여럿이면 가장 오래 이어진 시각', () => {
    const sessions: Sessions = new Map()
    const root = (cwd: string): string | null => (cwd.startsWith(CWD) ? CWD : null)
    applyHookEvent(sessions, { ...ev('UserPromptSubmit'), session_id: 'a' }, 5000)
    applyHookEvent(sessions, { ...ev('UserPromptSubmit'), session_id: 'b' }, 3000)
    expect(hookStateForWorktree(sessions, CWD, root)).toEqual({ state: 'working', since: 3000 })
    expect(stateForWorktree(sessions, CWD, root)).toBe('working')
  })
})
