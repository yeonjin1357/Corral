import {
  applyHookEvent,
  codexTranscriptFor,
  hookViewForAgent,
  reconcileSessions,
  SESSION_EXPIRE_MS,
  type ClaudeSession,
  type HookView,
  type LiveClaude,
  type Sessions
} from './sessions'
import type { AgentState, AgentTool } from '../shared/types'

const CWD = 'C:\\work\\shop-web'

/** 아직 어느 세션과도 짝짓지 않은 에이전트(그 워크트리의 짝 없는 세션을 본다). */
function freeView(
  sessions: Sessions,
  rootKey: string,
  rootOfCwd: (cwd: string) => string | null,
  tool: AgentTool = 'claude'
): HookView | null {
  return hookViewForAgent(sessions, { key: 'free:0', rootKey, tool }, rootOfCwd)
}

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
      lastActivityAt: 2000,
      stoppedAt: null
    })
  })

  test('idle_prompt 알림은 활동 시각을 바꾸지 않는다', () => {
    const sessions: Sessions = new Map()
    applyHookEvent(sessions, ev('UserPromptSubmit'), 1000)
    applyHookEvent(sessions, ev('Stop'), 5000)
    // 응답이 끝나고 약 60초 뒤에 오는 알림은 사용자가 한 일이 아니다.
    applyHookEvent(sessions, ev('Notification', { notification_type: 'idle_prompt' }), 65_000)
    applyHookEvent(sessions, ev('Notification', { notification_type: 'auth_success' }), 70_000)
    applyHookEvent(sessions, ev('PreCompact'), 75_000)
    expect(sessions.get('s1')).toMatchObject({ state: 'idle', lastActivityAt: 5000 })
    // 권한·질문 알림은 활동이다(사용자에게 답을 기다림).
    applyHookEvent(sessions, ev('Notification', { notification_type: 'permission_prompt' }), 80_000)
    expect(sessions.get('s1')?.lastActivityAt).toBe(80_000)
    applyHookEvent(
      sessions,
      ev('Notification', { notification_type: 'elicitation_dialog' }),
      90_000
    )
    expect(sessions.get('s1')?.lastActivityAt).toBe(90_000)
  })

  test.each([
    'SessionStart',
    'UserPromptSubmit',
    'PreToolUse',
    'PostToolUse',
    'PermissionRequest',
    'Stop',
    'StopFailure',
    'Interrupt'
  ])('%s 는 활동 시각을 새로 한다', (name) => {
    const sessions: Sessions = new Map()
    applyHookEvent(sessions, ev('SessionStart'), 1000)
    applyHookEvent(sessions, ev(name, { tool_name: 'Bash' }), 9000)
    expect(sessions.get('s1')?.lastActivityAt).toBe(9000)
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

  test('짝 없는 세션은 6시간 동안 소식이 없으면 버린다', () => {
    const sessions: Sessions = new Map()
    start(sessions, 's1', 1000)
    const opts = { sampledAt: 500, live: [claude('p1')], rootOfCwd }
    reconcileSessions(sessions, { ...opts, now: 1000 + SESSION_EXPIRE_MS - 1 })
    expect(sessions.size).toBe(1)
    reconcileSessions(sessions, { ...opts, now: 1000 + SESSION_EXPIRE_MS })
    expect(sessions.size).toBe(0)
  })

  test('살아 있는 프로세스와 짝지은 세션은 6시간이 지나도 남고, 짝 없는 세션은 만료된다', () => {
    const sessions: Sessions = new Map()
    start(sessions, 'parked', 1000, 'Stop')
    reconcileSessions(sessions, {
      now: 3000,
      sampledAt: 2000,
      live: [claude('p1', 900)],
      rootOfCwd
    })
    expect(sessions.get('parked')?.processKey).toBe('p1')
    // 어느 워크트리인지 모르는 세션은 짝지을 수 없어 짝 없이 남는다.
    applyHookEvent(sessions, { ...ev('SessionStart'), session_id: 'stray', cwd: 'C:\\tmp' }, 3000)

    const later = 3000 + SESSION_EXPIRE_MS
    reconcileSessions(sessions, {
      now: later,
      sampledAt: later,
      live: [claude('p1', 900)],
      rootOfCwd
    })
    // 며칠째 쉬는 세션의 마지막 활동을 잃지 않는다.
    expect([...sessions.keys()]).toEqual(['parked'])
    expect(sessions.get('parked')).toMatchObject({ state: 'idle', lastActivityAt: 1000 })

    // 짝지은 프로세스가 꺼지면 그때 버린다(지금 규칙 그대로).
    reconcileSessions(sessions, { now: later + 1, sampledAt: later + 1, live: [], rootOfCwd })
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

describe('짝 없는 세션은 워크트리로 붙인다', () => {
  const rootOfCwd = (cwd: string): string | null =>
    cwd.startsWith(CWD) ? CWD : cwd.startsWith('C:\\work\\api') ? 'C:\\work\\api' : null

  function sessionsWith(...entries: [string, string, AgentState][]): Sessions {
    return new Map(
      entries.map(([id, cwd, state]) => [
        id,
        { id, cwd, state, updatedAt: 1, firstSeen: 1, lastActivityAt: 1, processKey: null }
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
      expect(freeView(s, CWD, rootOfCwd)?.state).toBe(order[i])
    }
  })

  test('하위 폴더에서 실행한 세션도 같은 워크트리로 보고, 다른 워크트리 세션은 섞지 않는다', () => {
    const s = sessionsWith(
      ['a', CWD + '\\packages\\web', 'working'],
      ['b', 'C:\\work\\api', 'waiting']
    )
    expect(freeView(s, CWD, rootOfCwd)).toMatchObject({ state: 'working', sessionId: 'a' })
    expect(freeView(s, 'C:\\work\\none', rootOfCwd)).toBeNull()
  })
})

describe('프로세스 단위 상태(G3a)', () => {
  const ROOT = CWD.toLowerCase()
  const rootOfCwd = (cwd: string): string | null =>
    cwd.toLowerCase().startsWith(ROOT) ? ROOT : null
  const claude = (key: string, startedAt: number): LiveClaude => ({ key, rootKey: ROOT, startedAt })
  const agent = (
    key: string,
    rootKey: string | null = ROOT,
    tool: AgentTool = 'claude'
  ): Parameters<typeof hookViewForAgent>[1] => ({ key, rootKey, tool })
  const start = (sessions: Sessions, id: string, at: number, name = 'SessionStart'): void => {
    applyHookEvent(sessions, { ...ev(name), session_id: id }, at)
  }

  test('같은 워크트리의 두 프로세스는 각자 짝지은 세션의 상태를 본다', () => {
    const sessions: Sessions = new Map()
    start(sessions, 'a', 1000, 'PermissionRequest')
    start(sessions, 'b', 1100, 'Stop')
    reconcileSessions(sessions, {
      now: 3000,
      sampledAt: 2000,
      live: [claude('p1', 900), claude('p2', 1050)],
      rootOfCwd
    })
    expect(sessions.get('a')?.processKey).toBe('p1')
    expect(sessions.get('b')?.processKey).toBe('p2')
    expect(hookViewForAgent(sessions, agent('p1'), rootOfCwd)).toEqual({
      state: 'waiting',
      since: 1000,
      lastActivityAt: 1000,
      sessionId: 'a'
    })
    expect(hookViewForAgent(sessions, agent('p2'), rootOfCwd)).toEqual({
      state: 'idle',
      since: 1100,
      lastActivityAt: 1100,
      sessionId: 'b'
    })
  })

  test('짝 없는 새 세션은 그 워크트리의 짝 없는 에이전트에만 보인다', () => {
    const sessions: Sessions = new Map()
    start(sessions, 'a', 1000, 'Stop')
    reconcileSessions(sessions, {
      now: 3000,
      sampledAt: 2000,
      live: [claude('p1', 900)],
      rootOfCwd
    })
    // 다음 샘플 전에 같은 폴더에서 새 Claude(p2)가 일을 시작했다(아직 짝 없음).
    start(sessions, 'new', 4000, 'UserPromptSubmit')
    expect(hookViewForAgent(sessions, agent('p1'), rootOfCwd)).toMatchObject({
      state: 'idle',
      sessionId: 'a'
    })
    expect(hookViewForAgent(sessions, agent('p2'), rootOfCwd)).toMatchObject({
      state: 'working',
      sessionId: 'new'
    })
    // 다른 워크트리·워크트리를 모르는 에이전트·다른 도구에는 붙이지 않는다.
    expect(hookViewForAgent(sessions, agent('p3', 'c:\\work\\api'), rootOfCwd)).toBeNull()
    expect(hookViewForAgent(sessions, agent('p4', null), rootOfCwd)).toBeNull()
    expect(hookViewForAgent(sessions, agent('p5', ROOT, 'codex'), rootOfCwd)).toBeNull()
  })

  test('/clear 로 세션이 바뀌면 그 프로세스는 새 세션의 상태를 본다', () => {
    const sessions: Sessions = new Map()
    start(sessions, 'old', 1000, 'PermissionRequest')
    start(sessions, 'other', 1100, 'UserPromptSubmit')
    reconcileSessions(sessions, {
      now: 3000,
      sampledAt: 2000,
      live: [claude('p1', 900), claude('p2', 1050)],
      rootOfCwd
    })
    // p1 에서 /clear: SessionEnd 없이 새 세션이 시작된다. p2 는 그 뒤에도 계속 일한다.
    start(sessions, 'cleared', 4000)
    applyHookEvent(sessions, { ...ev('PostToolUse'), session_id: 'other' }, 5000)
    reconcileSessions(sessions, {
      now: 9000,
      sampledAt: 8000,
      live: [claude('p1', 900), claude('p2', 1050)],
      rootOfCwd
    })
    expect(hookViewForAgent(sessions, agent('p1'), rootOfCwd)).toMatchObject({
      state: 'idle',
      since: 4000,
      sessionId: 'cleared'
    })
    expect(hookViewForAgent(sessions, agent('p2'), rootOfCwd)).toMatchObject({
      state: 'working',
      sessionId: 'other'
    })
  })

  test('한 프로세스에 짝지은 세션이 여럿이면 권한 대기가 먼저이고, 활동 시각은 가장 최근', () => {
    const session = (
      id: string,
      state: AgentState,
      since: number,
      lastActivityAt: number,
      processKey: string | null
    ): [string, ClaudeSession] => [
      id,
      {
        id,
        cwd: CWD,
        state,
        updatedAt: lastActivityAt,
        firstSeen: 1,
        stateSince: since,
        lastActivityAt,
        processKey
      }
    ]
    const sessions: Sessions = new Map([
      session('idle', 'idle', 100, 9000, 'p1'),
      session('waiting', 'waiting', 500, 600, 'p1'),
      session('waiting-old', 'waiting', 300, 400, 'p1'),
      // 다른 프로세스와 짝지은 세션은 쓰지 않는다.
      session('mine-not', 'working', 1, 99_000, 'p2'),
      // 짝지은 세션이 있으면 짝 없는 세션은 보지 않는다.
      session('loose', 'working', 1, 99_000, null)
    ])
    expect(hookViewForAgent(sessions, agent('p1'), rootOfCwd)).toEqual({
      state: 'waiting',
      since: 300,
      lastActivityAt: 9000,
      sessionId: 'waiting-old'
    })
  })
})

describe('상태 시작 시각(F3)', () => {
  test('훅 상태의 시작 시각은 상태가 바뀐 이벤트 시각, 같은 상태 이벤트가 또 와도 그대로', () => {
    const sessions: Sessions = new Map()
    const root = (cwd: string): string | null => (cwd.startsWith(CWD) ? CWD : null)
    applyHookEvent(sessions, ev('UserPromptSubmit'), 1000)
    applyHookEvent(sessions, ev('PostToolUse', { tool_name: 'Bash' }), 2000)
    expect(freeView(sessions, CWD, root)).toMatchObject({ state: 'working', since: 1000 })
    applyHookEvent(sessions, ev('Stop'), 9000)
    expect(freeView(sessions, CWD, root)).toMatchObject({ state: 'idle', since: 9000 })
    applyHookEvent(sessions, ev('Notification', { notification_type: 'idle_prompt' }), 70_000)
    expect(freeView(sessions, CWD, root)).toMatchObject({ state: 'idle', since: 9000 })
  })

  test('같은 워크트리에 같은 상태 세션이 여럿이면 가장 오래 이어진 시각', () => {
    const sessions: Sessions = new Map()
    const root = (cwd: string): string | null => (cwd.startsWith(CWD) ? CWD : null)
    applyHookEvent(sessions, { ...ev('UserPromptSubmit'), session_id: 'a' }, 5000)
    applyHookEvent(sessions, { ...ev('UserPromptSubmit'), session_id: 'b' }, 3000)
    expect(freeView(sessions, CWD, root)).toEqual({
      state: 'working',
      since: 3000,
      lastActivityAt: 5000,
      sessionId: 'b'
    })
  })
})

describe('Codex 훅 세션(F7)', () => {
  const root = (cwd: string): string | null => (cwd.startsWith(CWD) ? CWD : null)
  const codexEv = (name: string, extra: Record<string, unknown> = {}): Record<string, unknown> => ({
    session_id: 'c1',
    cwd: CWD,
    hook_event_name: name,
    ...extra
  })

  test('Codex 훅 이벤트로 작업 중·권한 대기·쉬는 중', () => {
    const sessions: Sessions = new Map()
    const state = (): AgentState | null => freeView(sessions, CWD, root, 'codex')?.state ?? null
    applyHookEvent(sessions, codexEv('SessionStart'), 1000, 'codex')
    expect(state()).toBe('idle')
    applyHookEvent(sessions, codexEv('UserPromptSubmit'), 2000, 'codex')
    expect(state()).toBe('working')
    applyHookEvent(sessions, codexEv('PreToolUse', { tool_name: 'shell' }), 3000, 'codex')
    expect(state()).toBe('working')
    applyHookEvent(sessions, codexEv('PermissionRequest', { tool_name: 'shell' }), 4000, 'codex')
    expect(state()).toBe('waiting')
    applyHookEvent(sessions, codexEv('PostToolUse', { tool_name: 'shell' }), 5000, 'codex')
    expect(state()).toBe('working')
    applyHookEvent(sessions, codexEv('Interrupt'), 6000, 'codex')
    expect(state()).toBe('idle')
    applyHookEvent(sessions, codexEv('UserPromptSubmit'), 7000, 'codex')
    applyHookEvent(sessions, codexEv('Stop'), 8000, 'codex')
    expect(freeView(sessions, CWD, root, 'codex')).toEqual({
      state: 'idle',
      since: 8000,
      lastActivityAt: 8000,
      sessionId: 'c1'
    })
  })

  test('Claude 와 Codex 세션은 섞지 않는다', () => {
    const sessions: Sessions = new Map()
    applyHookEvent(sessions, codexEv('PermissionRequest'), 1000, 'codex')
    applyHookEvent(sessions, ev('UserPromptSubmit'), 1000)
    expect(freeView(sessions, CWD, root)?.state).toBe('working')
    expect(freeView(sessions, CWD, root, 'claude')?.state).toBe('working')
    expect(freeView(sessions, CWD, root, 'codex')?.state).toBe('waiting')
  })

  test('Codex 세션은 같은 워크트리의 Codex 프로세스와만 짝짓는다', () => {
    const sessions: Sessions = new Map()
    applyHookEvent(sessions, codexEv('SessionStart'), 1000, 'codex')
    const live = [
      { key: 'claude-1', rootKey: CWD, startedAt: 500, tool: 'claude' as const },
      { key: 'codex-1', rootKey: CWD, startedAt: 600, tool: 'codex' as const }
    ]
    reconcileSessions(sessions, { now: 3000, sampledAt: 2000, live, rootOfCwd: root })
    expect(sessions.get('c1')?.processKey).toBe('codex-1')
    // 그 워크트리에 Codex 가 없으면(Claude 만 있으면) 버린다.
    const alone: Sessions = new Map()
    applyHookEvent(alone, codexEv('SessionStart'), 1000, 'codex')
    reconcileSessions(alone, { now: 3000, sampledAt: 2000, live: [live[0]], rootOfCwd: root })
    expect(alone.size).toBe(0)
  })
})

describe('Codex 세션 기록 파일(transcript_path)', () => {
  const PATH_A = '/home/dev/.codex/sessions/2026/11/10/rollout-a.jsonl'
  const PATH_B = '/home/dev/.codex/sessions/2026/11/10/rollout-b.jsonl'
  const rootOf = (cwd: string): string | null => (cwd.startsWith('/work/app') ? '/work/app' : null)

  test('Codex 이벤트의 기록 파일 경로를 기억하고, 이후 경로 없는 이벤트에도 유지한다', () => {
    const sessions: Sessions = new Map()
    applyHookEvent(
      sessions,
      {
        session_id: 'c1',
        cwd: '/work/app',
        hook_event_name: 'SessionStart',
        transcript_path: PATH_A
      },
      1000,
      'codex'
    )
    applyHookEvent(
      sessions,
      { session_id: 'c1', hook_event_name: 'UserPromptSubmit' },
      2000,
      'codex'
    )
    expect(sessions.get('c1')?.transcriptPath).toBe(PATH_A)
  })

  test('.jsonl 이 아니거나 너무 긴 경로, Claude 이벤트의 경로는 기억하지 않는다', () => {
    const sessions: Sessions = new Map()
    const ev = (id: string, transcript_path: unknown): Record<string, unknown> => ({
      session_id: id,
      cwd: '/work/app',
      hook_event_name: 'SessionStart',
      transcript_path
    })
    applyHookEvent(sessions, ev('a', '/etc/passwd'), 1000, 'codex')
    applyHookEvent(sessions, ev('b', '/x/' + 'y'.repeat(5000) + '.jsonl'), 1000, 'codex')
    applyHookEvent(sessions, ev('c', PATH_A), 1000, 'claude')
    expect([...sessions.values()].map((s) => s.transcriptPath ?? null)).toEqual([null, null, null])
  })

  test('그 프로세스와 짝지은 Codex 세션의 기록 파일(같은 워크트리의 다른 Codex 세션 것은 고르지 않는다)', () => {
    const sessions: Sessions = new Map()
    const start = (id: string, cwd: string, path: string, at: number): void => {
      applyHookEvent(
        sessions,
        { session_id: id, cwd, hook_event_name: 'SessionStart', transcript_path: path },
        at,
        'codex'
      )
    }
    start('a', '/work/app', PATH_A, 1000)
    start('b', '/work/app/packages/api', PATH_B, 5000)
    reconcileSessions(sessions, {
      now: 6000,
      sampledAt: 6000,
      live: [
        { key: '10:100', rootKey: '/work/app', startedAt: 100, tool: 'codex' },
        { key: '20:4000', rootKey: '/work/app', startedAt: 4000, tool: 'codex' }
      ],
      rootOfCwd: rootOf
    })
    expect(codexTranscriptFor(sessions, '10:100')).toBe(PATH_A)
    expect(codexTranscriptFor(sessions, '20:4000')).toBe(PATH_B)
    expect(codexTranscriptFor(sessions, '30:1')).toBeNull()
  })
})
