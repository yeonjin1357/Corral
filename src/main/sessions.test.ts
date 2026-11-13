import {
  applyHookEvent,
  claudeTranscriptFor,
  clearActivity,
  codexTranscriptFor,
  hookViewForAgent,
  oneLine,
  pairBySessionFile,
  reconcileSessions,
  SESSION_EXPIRE_MS,
  settleWaiting,
  toolSummary,
  type ClaudeSession,
  type HookView,
  type LiveClaude,
  type Sessions
} from './sessions'
import type { ClaudeSessionFile } from './claudeSessionFiles'
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

  test('권한 대기 중에 온 PreToolUse 는(같은 도구가 늦게 도착한 것이어도) 대기를 풀지 않는다', () => {
    // 훅은 따로따로 비동기로 와서 PreToolUse 가 그 도구의 PermissionRequest 보다 늦게 도착할 수 있다.
    expect(
      stateAfter(
        ev('UserPromptSubmit'),
        ev('PermissionRequest', { tool_name: 'Bash' }),
        ev('PreToolUse', { tool_name: 'Bash' })
      )
    ).toBe('waiting')
    // 승인은 그 도구의 PostToolUse 로 안다.
    expect(
      stateAfter(
        ev('PermissionRequest', { tool_name: 'Bash' }),
        ev('PreToolUse', { tool_name: 'Bash' }),
        ev('PostToolUse', { tool_name: 'Bash' })
      )
    ).toBe('working')
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
      transcriptPath: null,
      stateSince: 2000,
      workingSince: 2000,
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
      workingSince: null,
      sessionId: 'a',
      activity: null
    })
    expect(hookViewForAgent(sessions, agent('p2'), rootOfCwd)).toEqual({
      state: 'idle',
      since: 1100,
      lastActivityAt: 1100,
      workingSince: null,
      sessionId: 'b',
      activity: null
    })
  })

  test('하는 일은 상태를 보인 그 세션의 것(G3b)', () => {
    const sessions: Sessions = new Map()
    const event = (id: string, name: string, extra: Record<string, unknown>, at: number): void => {
      applyHookEvent(sessions, { ...ev(name, extra), session_id: id }, at)
    }
    event('a', 'UserPromptSubmit', { prompt: '쉬던 요청' }, 1000)
    event('a', 'Stop', {}, 2000)
    event('b', 'PermissionRequest', { tool_name: 'Bash', tool_input: { command: 'npm i' } }, 3000)
    // 짝 없는 두 세션 가운데 권한 대기(b)를 보이고, 하는 일도 b 의 것이다(쉬는 a 의 요청을 섞지 않는다).
    expect(hookViewForAgent(sessions, agent('free'), rootOfCwd)).toMatchObject({
      sessionId: 'b',
      activity: {
        title: null,
        prompt: null,
        tool: null,
        waiting: { tool: 'Bash', summary: 'npm i' }
      }
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
      workingSince: null,
      sessionId: 'waiting-old',
      activity: null
    })
  })
})

describe('Claude 세션 파일로 정확한 짝(G3a)', () => {
  const ROOT = CWD.toLowerCase()
  const rootOfCwd = (cwd: string): string | null =>
    cwd.toLowerCase().startsWith(ROOT) ? ROOT : null
  const claude = (key: string, startedAt: number): LiveClaude => ({ key, rootKey: ROOT, startedAt })
  const start = (sessions: Sessions, id: string, at: number, name = 'SessionStart'): void => {
    applyHookEvent(sessions, { ...ev(name), session_id: id }, at)
  }
  /** pid → 그 프로세스가 지금 쓰는 세션 id. */
  const files = (...entries: [number, string][]): Map<number, ClaudeSessionFile> =>
    new Map(
      entries.map(([pid, sessionId]) => [
        pid,
        {
          pid,
          sessionId,
          status: 'idle',
          statusUpdatedAt: null,
          waitingFor: null,
          name: null,
          nameSource: null
        }
      ])
    )
  const keys = new Map([
    [11, 'p1'],
    [12, 'p2'],
    [14, 'p4']
  ])
  const keyOfPid = (pid: number): string | null => keys.get(pid) ?? null

  test('세션 파일이 가리키는 프로세스로 짝을 고치고, 그 프로세스의 예전 세션은 버린다', () => {
    const sessions: Sessions = new Map()
    start(sessions, 'a', 1000)
    start(sessions, 'b', 1100, 'PermissionRequest')
    applyHookEvent(sessions, { ...ev('UserPromptSubmit'), session_id: 'cx' }, 1200, 'codex')
    reconcileSessions(sessions, {
      now: 3000,
      sampledAt: 2000,
      live: [
        claude('p1', 900),
        claude('p2', 1050),
        { key: 'c1', rootKey: ROOT, startedAt: 1150, tool: 'codex' }
      ],
      rootOfCwd
    })
    // 시작 시각으로 짐작한 짝은 a → p1, b → p2 인데 실제로는 반대다(pid 11 = p1 이 b 를 쓴다).
    expect([sessions.get('a')?.processKey, sessions.get('b')?.processKey]).toEqual(['p1', 'p2'])
    pairBySessionFile(
      sessions,
      // 13 은 이번 샘플의 Claude 가 아니고, 14 의 파일이 가리키는 cx 는 Codex 세션이다.
      files([11, 'b'], [12, 'a'], [13, 'a'], [14, 'cx']),
      keyOfPid
    )
    expect(sessions.get('a')?.processKey).toBe('p2')
    expect(sessions.get('b')?.processKey).toBe('p1')
    expect(sessions.get('cx')?.processKey).toBe('c1')
    expect(
      hookViewForAgent(sessions, { key: 'p1', rootKey: ROOT, tool: 'claude' }, rootOfCwd)
    ).toMatchObject({ state: 'waiting', sessionId: 'b' })

    // p1 에서 /clear: 새 세션이 시작되고 파일이 그 세션을 가리킨다. p1 의 예전 세션(b)은 버린다.
    start(sessions, 'cleared', 4000)
    // 아직 훅 소식이 없는 세션을 가리키면(p2 의 새 세션) 그대로 둔다.
    pairBySessionFile(sessions, files([11, 'cleared'], [12, 'not-yet']), keyOfPid)
    expect([...sessions.keys()].sort()).toEqual(['a', 'cleared', 'cx'])
    expect(sessions.get('cleared')?.processKey).toBe('p1')
    expect(sessions.get('a')?.processKey).toBe('p2')
    // 정확한 짝은 다음 정리에서도 그대로다.
    reconcileSessions(sessions, {
      now: 9000,
      sampledAt: 8000,
      live: [claude('p1', 900), claude('p2', 1050)],
      rootOfCwd
    })
    expect(sessions.get('cleared')?.processKey).toBe('p1')
  })

  test('세션 파일이 있는 프로세스는 추측 짝의 후보가 아니다(빈 자리·바꿔치기 모두)', () => {
    // 빈 자리: 세션보다 먼저·가장 가깝게 시작한 p1 은 파일로 다른 세션(훅이 모르는)을 쓰고 있다 → 파일 없는 p2 와 짝짓는다.
    const free: Sessions = new Map()
    start(free, 'n', 1000)
    reconcileSessions(free, {
      now: 3000,
      sampledAt: 2000,
      live: [claude('p1', 900), claude('p2', 100)],
      rootOfCwd,
      exact: new Set(['p1'])
    })
    expect(free.get('n')?.processKey).toBe('p2')

    // 파일이 있는 프로세스뿐이면 짝짓지 않고(버리지도 않고) 둔다.
    const only: Sessions = new Map()
    start(only, 'n', 1000)
    reconcileSessions(only, {
      now: 3000,
      sampledAt: 2000,
      live: [claude('p1', 900)],
      rootOfCwd,
      exact: new Set(['p1'])
    })
    expect(only.get('n')).toMatchObject({ processKey: null })

    // 바꿔치기: 모두 짝이 있어도 파일로 이은 짝(p1 ↔ a)은 새 세션에 넘기지 않는다.
    const replace: Sessions = new Map()
    start(replace, 'a', 1000)
    pairBySessionFile(replace, files([11, 'a']), keyOfPid)
    start(replace, 'n', 5000)
    const opts = { now: 9000, sampledAt: 8000, live: [claude('p1', 900)], rootOfCwd }
    const guessed = new Map([...replace].map(([id, s]) => [id, { ...s }]))
    reconcileSessions(replace, { ...opts, exact: new Set(['p1']) })
    expect([...replace.values()].map((s) => [s.id, s.processKey])).toEqual([
      ['a', 'p1'],
      ['n', null]
    ])
    // 파일이 없으면(빈 집합·없음) 지금처럼 오래 조용한 a 를 버리고 n 이 p1 을 넘겨받는다.
    reconcileSessions(guessed, { ...opts, exact: new Set() })
    expect([...guessed.values()].map((s) => [s.id, s.processKey])).toEqual([['n', 'p1']])
  })

  test('세션 파일로 아는 프로세스는 그 세션만 보고, 워크트리의 짝 없는 세션을 빌리지 않는다', () => {
    const sessions: Sessions = new Map()
    start(sessions, 'mine', 1000, 'Stop')
    start(sessions, 'loose', 2000, 'PermissionRequest')
    pairBySessionFile(sessions, files([11, 'mine']), keyOfPid)
    const p1 = { key: 'p1', rootKey: ROOT, tool: 'claude' as const }
    expect(hookViewForAgent(sessions, { ...p1, sessionId: 'mine' }, rootOfCwd)).toMatchObject({
      state: 'idle',
      sessionId: 'mine'
    })
    // 파일의 세션을 훅이 모르면 훅 상태가 없다(짝 없는 loose 를 빌리지 않는다).
    expect(
      hookViewForAgent(
        sessions,
        { key: 'p2', rootKey: ROOT, tool: 'claude', sessionId: 'x' },
        rootOfCwd
      )
    ).toBeNull()
    // 파일의 세션이 아직 짝지어지기 전(수집 사이에 처음 온 소식)이어도 그 세션이면 본다. 남과 짝지은 것은 아니다.
    start(sessions, 'fresh', 3000, 'UserPromptSubmit')
    expect(
      hookViewForAgent(
        sessions,
        { key: 'p2', rootKey: ROOT, tool: 'claude', sessionId: 'fresh' },
        rootOfCwd
      )
    ).toMatchObject({ state: 'working', sessionId: 'fresh' })
    expect(
      hookViewForAgent(
        sessions,
        { key: 'p2', rootKey: ROOT, tool: 'claude', sessionId: 'mine' },
        rootOfCwd
      )
    ).toBeNull()
    // 파일이 없는 에이전트는 지금처럼 워크트리의 짝 없는 세션을 본다.
    expect(
      hookViewForAgent(sessions, { key: 'p2', rootKey: ROOT, tool: 'claude' }, rootOfCwd)
    ).toMatchObject({ state: 'waiting', sessionId: 'loose' })
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

  test('작업 중이 된 시각(workingSince)은 다른 상태에서 작업 중으로 넘어올 때만 새로 하고, 작업 중을 벗어나도 남는다', () => {
    const sessions: Sessions = new Map()
    const root = (cwd: string): string | null => (cwd.startsWith(CWD) ? CWD : null)
    const workingSince = (): number | null | undefined => sessions.get('s1')?.workingSince
    applyHookEvent(sessions, ev('SessionStart'), 500)
    expect(workingSince()).toBeNull()
    applyHookEvent(sessions, ev('UserPromptSubmit'), 1000)
    expect(workingSince()).toBe(1000)
    // 작업 중에 온 작업 중 이벤트·권한 요청은 바꾸지 않는다.
    applyHookEvent(sessions, ev('PostToolUse', { tool_name: 'Read' }), 2000)
    applyHookEvent(sessions, ev('PermissionRequest', { tool_name: 'Bash' }), 3000)
    expect(workingSince()).toBe(1000)
    // 권한 대기에서 작업 중으로 넘어오면 새로 한다.
    applyHookEvent(sessions, ev('PostToolUse', { tool_name: 'Bash' }), 4000)
    expect(workingSince()).toBe(4000)
    applyHookEvent(sessions, ev('Stop'), 5000)
    applyHookEvent(sessions, ev('Notification', { notification_type: 'idle_prompt' }), 65_000)
    expect(workingSince()).toBe(4000)
    expect(freeView(sessions, CWD, root)).toMatchObject({
      state: 'idle',
      since: 5000,
      workingSince: 4000
    })
    // 붙는 세션이 여럿이면 가장 최근.
    applyHookEvent(sessions, { ...ev('UserPromptSubmit'), session_id: 's2' }, 6000)
    applyHookEvent(sessions, { ...ev('Stop'), session_id: 's2' }, 7000)
    expect(freeView(sessions, CWD, root)?.workingSince).toBe(6000)
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
      workingSince: 5000,
      sessionId: 'b',
      activity: null
    })
  })
})

describe('응답 대기 정리(settleWaiting)', () => {
  const bash = (command: string): Record<string, unknown> => ({
    tool_name: 'Bash',
    tool_input: { command }
  })

  test('세션 파일의 더 늦은 busy 가 이긴 응답 대기를 작업 중으로 정리하고, 그 뒤 새 권한 요청은 새 대기다', () => {
    const sessions: Sessions = new Map()
    applyHookEvent(sessions, ev('UserPromptSubmit', { prompt: '빌드 고쳐 줘' }), 1000)
    applyHookEvent(sessions, ev('PreToolUse', bash('npm run build')), 60_000)
    applyHookEvent(sessions, ev('PermissionRequest', bash('npm run build')), 60_100)
    // 사용자가 답해 세션 파일이 90초에 busy 가 됐다.
    expect(settleWaiting(sessions, 's1', 90_000)).toBe(true)
    expect(sessions.get('s1')).toMatchObject({
      state: 'working',
      stateSince: 90_000,
      // 다시 작업 중이 된 것으로 센다(파일의 옛 응답 대기가 되살아나지 않게).
      workingSince: 90_000,
      waitingTool: null,
      // 훅 이벤트가 온 것이 아니라 마지막 소식·활동 시각은 그대로다.
      updatedAt: 60_100,
      lastActivityAt: 60_100
    })
    expect(sessions.get('s1')?.activity).toEqual({
      title: null,
      prompt: '빌드 고쳐 줘',
      tool: null,
      waiting: null
    })
    // 그 뒤 다른 도구의 이벤트는 작업 중을 이어 간다.
    applyHookEvent(
      sessions,
      ev('PreToolUse', { tool_name: 'Read', tool_input: { file_path: 'a.ts' } }),
      93_000
    )
    expect(sessions.get('s1')).toMatchObject({ state: 'working', stateSince: 90_000 })
    // 새 권한 요청은 새 대기다(새 시작 시각).
    applyHookEvent(sessions, ev('PermissionRequest', bash('npm test')), 120_000)
    expect(sessions.get('s1')).toMatchObject({
      state: 'waiting',
      stateSince: 120_000,
      waitingTool: 'Bash'
    })
  })

  test('아는 것이 기다리던 도구뿐이면 하는 일을 비운다', () => {
    const sessions: Sessions = new Map()
    applyHookEvent(sessions, ev('PermissionRequest', bash('npm run build')), 1000)
    expect(settleWaiting(sessions, 's1', 9000)).toBe(true)
    expect(sessions.get('s1')).not.toHaveProperty('activity')
  })

  test('응답 대기가 아니거나 없는 세션은 그대로(false)', () => {
    const sessions: Sessions = new Map()
    applyHookEvent(sessions, ev('UserPromptSubmit'), 1000)
    const before = structuredClone(sessions.get('s1'))
    expect(settleWaiting(sessions, 's1', 5000)).toBe(false)
    expect(sessions.get('s1')).toEqual(before)
    expect(settleWaiting(sessions, 'none', 5000)).toBe(false)
    expect(sessions.size).toBe(1)
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
      workingSince: 7000,
      sessionId: 'c1',
      activity: null
    })
  })

  test('Codex 훅도 같은 이름의 값이 오면 하는 일에 쓰고, 없으면 null', () => {
    const sessions: Sessions = new Map()
    const activity = (): unknown => sessions.get('c1')?.activity ?? null
    applyHookEvent(sessions, codexEv('UserPromptSubmit'), 1000, 'codex')
    expect(activity()).toBeNull()
    applyHookEvent(
      sessions,
      codexEv('UserPromptSubmit', { prompt: '테스트 고쳐 줘' }),
      2000,
      'codex'
    )
    applyHookEvent(
      sessions,
      codexEv('PreToolUse', { tool_name: 'Bash', tool_input: { command: 'npm test' } }),
      3000,
      'codex'
    )
    expect(activity()).toEqual({
      title: null,
      prompt: '테스트 고쳐 줘',
      tool: { name: 'Bash', summary: 'npm test', since: 3000 },
      waiting: null
    })
    // 요약을 모르는 도구는 이름만.
    applyHookEvent(sessions, codexEv('PreToolUse', { tool_name: 'apply_patch' }), 4000, 'codex')
    expect(sessions.get('c1')?.activity?.tool).toEqual({
      name: 'apply_patch',
      summary: null,
      since: 4000
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
  const CLAUDE_PATH = '/home/dev/.claude/projects/-work-app/c.jsonl'
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

  test('.jsonl 이 아니거나 너무 긴 경로는 기억하지 않는다(Claude 세션의 경로는 기억한다 — G6)', () => {
    const sessions: Sessions = new Map()
    const ev = (id: string, transcript_path: unknown): Record<string, unknown> => ({
      session_id: id,
      cwd: '/work/app',
      hook_event_name: 'SessionStart',
      transcript_path
    })
    applyHookEvent(sessions, ev('a', '/etc/passwd'), 1000, 'codex')
    applyHookEvent(sessions, ev('b', '/x/' + 'y'.repeat(5000) + '.jsonl'), 1000, 'codex')
    applyHookEvent(sessions, ev('c', CLAUDE_PATH), 1000, 'claude')
    applyHookEvent(sessions, ev('d', '/etc/passwd'), 1000, 'claude')
    expect([...sessions.values()].map((s) => s.transcriptPath ?? null)).toEqual([
      null,
      null,
      CLAUDE_PATH,
      null
    ])
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

  test('Claude 프로세스의 기록 파일 단서(G6): 세션 파일의 세션이 먼저, 없으면 짝지은 세션, 짝이 없으면 null', () => {
    const sessions: Sessions = new Map()
    const event = (id: string, at: number, path?: string): void => {
      applyHookEvent(
        sessions,
        {
          session_id: id,
          cwd: '/work/app',
          hook_event_name: 'UserPromptSubmit',
          ...(path ? { transcript_path: path } : {})
        },
        at
      )
    }
    const PATH_OLD = '/home/dev/.claude/projects/-work-app/old.jsonl'
    const PATH_NEW = '/home/dev/.claude/projects/-work-app/new.jsonl'
    event('old', 1000, PATH_OLD)
    event('loose', 3000, '/home/dev/.claude/projects/-work-app/loose.jsonl')
    // Codex 세션은 쓰지 않는다.
    applyHookEvent(
      sessions,
      {
        session_id: 'cx',
        cwd: '/work/app',
        hook_event_name: 'UserPromptSubmit',
        transcript_path: PATH_A
      },
      500,
      'codex'
    )
    sessions.get('old')!.processKey = '10:100'
    sessions.get('cx')!.processKey = '10:100'
    // 세션 파일이 없으면 짝지은 세션의 기록 파일(짝 없는 loose 는 빌리지 않는다).
    expect(claudeTranscriptFor(sessions, '10:100', null)).toEqual({
      sessionId: 'old',
      transcriptPath: PATH_OLD
    })
    expect(claudeTranscriptFor(sessions, '20:200', null)).toBeNull()
    // 세션 파일이 다른 세션(/clear 직후 아직 훅 소식이 없음)을 가리키면 그 세션의 id 만(경로는 읽는 쪽이 찾는다).
    expect(claudeTranscriptFor(sessions, '10:100', 'new')).toEqual({
      sessionId: 'new',
      transcriptPath: null
    })
    // 그 세션의 훅 소식이 오면(아직 짝 전이어도) 그 경로.
    event('new', 4000, PATH_NEW)
    expect(claudeTranscriptFor(sessions, '10:100', 'new')).toEqual({
      sessionId: 'new',
      transcriptPath: PATH_NEW
    })
    // 다른 프로세스와 짝지은 세션의 경로는 쓰지 않는다.
    expect(claudeTranscriptFor(sessions, '20:200', 'old')).toEqual({
      sessionId: 'old',
      transcriptPath: null
    })
  })
})

describe('하는 일(G3b)', () => {
  const activityOf = (sessions: Sessions, id = 's1'): ClaudeSession['activity'] =>
    sessions.get(id)?.activity
  const bash = (command: unknown): Record<string, unknown> => ({
    tool_name: 'Bash',
    tool_input: { command }
  })

  test('PreToolUse 에 실행 중인 도구를 담고 같은 도구의 PostToolUse 에 비운다', () => {
    const sessions: Sessions = new Map()
    applyHookEvent(sessions, ev('UserPromptSubmit'), 1000)
    applyHookEvent(sessions, ev('PreToolUse', bash('npm run build\necho done')), 2000)
    expect(activityOf(sessions)?.tool).toEqual({
      name: 'Bash',
      summary: 'npm run build',
      since: 2000
    })
    // 병렬로 돌던 다른 도구가 끝나도 그대로다.
    applyHookEvent(sessions, ev('PostToolUse', { tool_name: 'Read' }), 3000)
    expect(activityOf(sessions)?.tool?.name).toBe('Bash')
    applyHookEvent(sessions, ev('PostToolUse', bash('npm run build')), 4000)
    expect(activityOf(sessions)?.tool ?? null).toBeNull()

    // 응답 끝·오류·중단·새 입력에도 비운다.
    for (const end of ['Stop', 'StopFailure', 'Interrupt', 'UserPromptSubmit']) {
      const s: Sessions = new Map()
      applyHookEvent(s, ev('UserPromptSubmit'), 1000)
      applyHookEvent(
        s,
        ev('PreToolUse', { tool_name: 'Grep', tool_input: { pattern: 'TODO' } }),
        2000
      )
      expect(activityOf(s)?.tool?.summary, end).toBe('TODO')
      applyHookEvent(s, ev(end), 3000)
      expect(activityOf(s)?.tool ?? null, end).toBeNull()
    }

    // 응답이 끝난 직후 늦게 도착한(상태에 반영하지 않는) 도구 이벤트는 담지 않는다.
    applyHookEvent(sessions, ev('Stop'), 5000)
    applyHookEvent(sessions, ev('PreToolUse', bash('ls')), 5500)
    expect(sessions.get('s1')?.state).toBe('idle')
    expect(activityOf(sessions)?.tool ?? null).toBeNull()
  })

  test('PermissionRequest 의 도구와 명령 요약을 담고, 승인되면 비운다', () => {
    const sessions: Sessions = new Map()
    applyHookEvent(sessions, ev('UserPromptSubmit'), 1000)
    applyHookEvent(sessions, ev('PreToolUse', bash('rm -rf dist')), 2000)
    applyHookEvent(sessions, ev('PermissionRequest', bash('rm -rf dist')), 2100)
    const waiting = { tool: 'Bash', summary: 'rm -rf dist' }
    expect(activityOf(sessions)?.waiting).toEqual(waiting)
    // 권한 알림·다른 도구의 끝은 대기를 풀지 않는다.
    applyHookEvent(sessions, ev('Notification', { notification_type: 'permission_prompt' }), 2200)
    applyHookEvent(sessions, ev('PostToolUse', { tool_name: 'Read' }), 2300)
    expect(sessions.get('s1')?.state).toBe('waiting')
    expect(activityOf(sessions)?.waiting).toEqual(waiting)
    // 승인되어 그 도구가 끝나면 작업 중 — 기다리던 도구를 비운다.
    applyHookEvent(sessions, ev('PostToolUse', bash('rm -rf dist')), 3000)
    expect(sessions.get('s1')?.state).toBe('working')
    expect(activityOf(sessions)?.waiting ?? null).toBeNull()
    // 응답이 끝나 권한 대기를 벗어나도 비운다.
    applyHookEvent(sessions, ev('PermissionRequest', { tool_name: 'WebFetch' }), 4000)
    expect(activityOf(sessions)?.waiting).toEqual({ tool: 'WebFetch', summary: null })
    applyHookEvent(sessions, ev('Stop'), 5000)
    expect(activityOf(sessions)?.waiting ?? null).toBeNull()
  })

  test('PreToolUse 뒤에 온 PermissionRequest 는 그 도구를 실행 중이 아니라 권한 대기로 둔다', () => {
    const sessions: Sessions = new Map()
    applyHookEvent(sessions, ev('UserPromptSubmit'), 1000)
    // Claude 는 권한을 묻기 전에 PreToolUse 를 보낸다. 명령은 아직 돌지 않았다.
    applyHookEvent(sessions, ev('PreToolUse', bash('rm -rf dist')), 2000)
    applyHookEvent(sessions, ev('PermissionRequest', bash('rm -rf dist')), 2100)
    expect(activityOf(sessions)).toMatchObject({
      tool: null,
      waiting: { tool: 'Bash', summary: 'rm -rf dist' }
    })
    // 승인되어도 다시 실행 중으로 담지 않는다(그 뒤의 이벤트가 알려 줄 때만). 그 도구가 끝나면 대기만 풀린다.
    applyHookEvent(sessions, ev('PostToolUse', bash('rm -rf dist')), 3000)
    expect(sessions.get('s1')?.state).toBe('working')
    expect(activityOf(sessions)?.tool ?? null).toBeNull()
    expect(activityOf(sessions)?.waiting ?? null).toBeNull()

    // 병렬로 돌던 다른 도구는 실행 중 그대로다.
    const parallel: Sessions = new Map()
    applyHookEvent(parallel, ev('UserPromptSubmit'), 1000)
    applyHookEvent(
      parallel,
      ev('PreToolUse', { tool_name: 'Grep', tool_input: { pattern: 'TODO' } }),
      2000
    )
    applyHookEvent(parallel, ev('PermissionRequest', bash('npm i')), 2100)
    expect(activityOf(parallel)).toMatchObject({
      tool: { name: 'Grep', summary: 'TODO' },
      waiting: { tool: 'Bash', summary: 'npm i' }
    })
  })

  test('프롬프트는 첫 줄 200자, 제목은 80자', () => {
    const sessions: Sessions = new Map()
    applyHookEvent(sessions, ev('SessionStart', { session_title: 'T'.repeat(100) }), 1000)
    expect(activityOf(sessions)?.title).toBe('T'.repeat(79) + '…')
    applyHookEvent(
      sessions,
      ev('UserPromptSubmit', { prompt: '\n  로그인   버그 고쳐 줘  \n자세한 내용은 이슈에' }),
      2000
    )
    expect(activityOf(sessions)).toMatchObject({
      title: 'T'.repeat(79) + '…',
      prompt: '로그인 버그 고쳐 줘'
    })
    applyHookEvent(sessions, ev('UserPromptSubmit', { prompt: 'p'.repeat(300) }), 3000)
    expect(activityOf(sessions)?.prompt).toBe('p'.repeat(199) + '…')
    // 제목은 새로 오면 덮어쓰고, 없으면 그대로다.
    applyHookEvent(
      sessions,
      ev('UserPromptSubmit', { prompt: '다음', session_title: '로그인 버그' }),
      4000
    )
    expect(activityOf(sessions)).toMatchObject({ title: '로그인 버그', prompt: '다음' })
    // 프롬프트 없이 온 새 입력은 마지막 요청을 모른다(이전 요청을 남기지 않는다).
    applyHookEvent(sessions, ev('UserPromptSubmit'), 5000)
    expect(activityOf(sessions)).toMatchObject({ title: '로그인 버그', prompt: null })
  })

  test('1 MB 명령·제어 문자·문자열이 아닌 tool_input 도 예외 없이 한 줄로', () => {
    const sessions: Sessions = new Map()
    const tool = (): NonNullable<ClaudeSession['activity']>['tool'] | undefined =>
      activityOf(sessions)?.tool
    applyHookEvent(sessions, ev('PreToolUse', bash('a'.repeat(1_000_000))), 1000)
    expect(tool()?.summary?.length).toBeLessThanOrEqual(160)
    expect(tool()?.summary?.endsWith('…')).toBe(true)
    // 터미널 제어 문자·줄바꿈 뒤는 버린다.
    applyHookEvent(sessions, ev('PreToolUse', bash('echo hi\u001b[31m red\r\nrm -rf /')), 2000)
    expect(tool()?.summary).toBe('echo hi')
    applyHookEvent(sessions, ev('PreToolUse', { tool_name: 'Bash', tool_input: 42 }), 3000)
    expect(tool()).toEqual({ name: 'Bash', summary: null, since: 3000 })
    applyHookEvent(
      sessions,
      ev('PreToolUse', { tool_name: 'Read', tool_input: { file_path: 'x'.repeat(1_000_000) } }),
      4000
    )
    expect(tool()?.summary?.length).toBeLessThanOrEqual(80)
    // 도구 이름이 문자열이 아니면 무엇을 실행하는지 모른다.
    applyHookEvent(sessions, ev('PreToolUse', { tool_name: 7, tool_input: { command: 'x' } }), 5000)
    expect(tool() ?? null).toBeNull()
  })

  test('activity 를 끄면 내용 값을 저장하지 않는다(상태는 그대로)', () => {
    const events = [
      ev('SessionStart', { session_title: '배포 준비' }),
      ev('UserPromptSubmit', { prompt: '배포해 줘' }),
      ev('PreToolUse', bash('npm run deploy')),
      ev('PermissionRequest', bash('npm run deploy'))
    ]
    for (const tool of ['claude', 'codex'] as const) {
      const on: Sessions = new Map()
      const off: Sessions = new Map()
      events.forEach((e, i) => {
        applyHookEvent(on, e, 1000 + i, tool)
        applyHookEvent(off, e, 1000 + i, tool, { activity: false })
      })
      expect(on.get('s1')?.activity).toBeDefined()
      const withoutActivity = { ...on.get('s1')! }
      delete withoutActivity.activity
      expect(off.get('s1')).toEqual(withoutActivity)
      expect(off.get('s1')).not.toHaveProperty('activity')
      // 들고 있던 세션에 끈 채로 이벤트가 오면 그 내용도 버린다.
      applyHookEvent(
        on,
        ev('Notification', { notification_type: 'permission_prompt' }),
        2000,
        tool,
        {
          activity: false
        }
      )
      expect(on.get('s1')).toMatchObject({ state: 'waiting', waitingTool: 'Bash' })
      expect(on.get('s1')).not.toHaveProperty('activity')
    }
  })

  test('멈출 때(Stop) 에이전트의 마지막 말 첫 줄을 담고, 다시 일하기 시작하면 비운다', () => {
    const sessions: Sessions = new Map()
    applyHookEvent(sessions, ev('UserPromptSubmit', { prompt: '테스트 돌려 줘' }), 1000)
    expect(activityOf(sessions)?.reply ?? null).toBeNull()
    applyHookEvent(
      sessions,
      ev('Stop', {
        last_assistant_message:
          '\n테스트 3개가   실패해서 멈췄어요. 계속할까요?\n\n- auth.test.ts\n- cart.test.ts'
      }),
      2000
    )
    expect(activityOf(sessions)).toMatchObject({
      prompt: '테스트 돌려 줘',
      reply: '테스트 3개가 실패해서 멈췄어요. 계속할까요?'
    })
    // 60초 뒤의 쉬는 중 알림은 마지막 말을 지우지 않는다.
    applyHookEvent(sessions, ev('Notification', { notification_type: 'idle_prompt' }), 3000)
    expect(activityOf(sessions)?.reply).toBe('테스트 3개가 실패해서 멈췄어요. 계속할까요?')
    // 새 요청이 오면 지난 말은 비운다.
    applyHookEvent(sessions, ev('UserPromptSubmit', { prompt: '응 계속해' }), 4000)
    expect(activityOf(sessions)?.reply ?? null).toBeNull()
  })

  test('마지막 말은 200자까지, 글이 아니거나 비어 있으면 담지 않는다', () => {
    const sessions: Sessions = new Map()
    applyHookEvent(sessions, ev('UserPromptSubmit', { prompt: 'p' }), 1000)
    applyHookEvent(sessions, ev('Stop', { last_assistant_message: 'r'.repeat(300) }), 2000)
    expect(activityOf(sessions)?.reply).toBe('r'.repeat(199) + '…')
    for (const empty of ['', '   \n  ', 42, null, undefined, { text: 'x' }]) {
      applyHookEvent(sessions, ev('UserPromptSubmit', { prompt: 'p' }), 3000)
      applyHookEvent(sessions, ev('Stop', { last_assistant_message: empty }), 4000)
      expect(activityOf(sessions)?.reply ?? null, String(empty)).toBeNull()
    }
  })

  test('하는 일 보기를 끄면 마지막 말도 담지 않는다', () => {
    const sessions: Sessions = new Map()
    const off = { activity: false }
    applyHookEvent(sessions, ev('UserPromptSubmit', { prompt: 'p' }), 1000, 'claude', off)
    applyHookEvent(
      sessions,
      ev('Stop', { last_assistant_message: '다 했어요' }),
      2000,
      'claude',
      off
    )
    expect(activityOf(sessions)).toBeUndefined()
    expect(sessions.get('s1')?.state).toBe('idle')
  })

  test('백그라운드 작업을 남기고 멈췄다가 새 요청 없이 다시 일하면 이어 가는 작업으로 적는다', () => {
    const sessions: Sessions = new Map()
    const woken = (): boolean => sessions.get('s1')?.wokenByBackground ?? false
    applyHookEvent(sessions, ev('UserPromptSubmit', { prompt: 'p' }), 100_000)
    applyHookEvent(
      sessions,
      ev('Stop', { background_tasks: [{ id: 'task-001', type: 'shell' }] }),
      200_000
    )
    expect(sessions.get('s1')?.pausedForBackground).toBe(true)
    expect(woken()).toBe(false)
    // 백그라운드 작업이 끝나 에이전트가 깨어났다(새 요청 없이 도구를 쓴다): 이어 가는 작업이다.
    applyHookEvent(sessions, ev('PreToolUse', bash('npm test')), 300_000)
    expect(sessions.get('s1')).toMatchObject({ state: 'working', wokenByBackground: true })
    expect(sessions.get('s1')?.pausedForBackground ?? false).toBe(false)
    // 권한을 기다려도, 도구가 끝나도 그대로다.
    applyHookEvent(sessions, ev('PermissionRequest', bash('npm test')), 301_000)
    applyHookEvent(sessions, ev('PostToolUse', bash('npm test')), 302_000)
    expect(woken()).toBe(true)
    // 멈추면 지운다.
    applyHookEvent(sessions, ev('Stop', {}), 303_000)
    expect(woken()).toBe(false)

    // 사용자가 새 요청을 보내 다시 일한 것은 이어 가는 작업이 아니다.
    applyHookEvent(sessions, ev('UserPromptSubmit', { prompt: 'p' }), 350_000)
    applyHookEvent(sessions, ev('Stop', { session_crons: [{ id: 'c1' }] }), 400_000)
    applyHookEvent(sessions, ev('UserPromptSubmit', { prompt: 'p' }), 500_000)
    applyHookEvent(sessions, ev('PreToolUse', bash('npm test')), 501_000)
    expect(woken()).toBe(false)
    // 남긴 것 없이 멈췄다가 새 요청 없이 다시 일한 것도 아니다(늦게 온 이벤트 등).
    applyHookEvent(sessions, ev('Stop', {}), 600_000)
    applyHookEvent(sessions, ev('PreToolUse', bash('npm test')), 700_000)
    expect(sessions.get('s1')?.state).toBe('working')
    expect(woken()).toBe(false)
  })

  test('멈출 때 백그라운드 작업이 남아 있으면 적어 두고, 다시 일하면 지운다', () => {
    const sessions: Sessions = new Map()
    applyHookEvent(sessions, ev('UserPromptSubmit', { prompt: 'p' }), 1000)
    applyHookEvent(
      sessions,
      ev('Stop', { background_tasks: [{ id: 'task-001', type: 'shell' }], session_crons: [] }),
      2000
    )
    expect(sessions.get('s1')?.pausedForBackground).toBe(true)
    // 60초 뒤의 쉬는 중 알림에도 그대로다.
    applyHookEvent(sessions, ev('Notification', { notification_type: 'idle_prompt' }), 62_000)
    expect(sessions.get('s1')?.pausedForBackground).toBe(true)
    // 백그라운드 작업이 끝나 깨어나 다시 일한다(멈춘 직후의 늦은 도구 이벤트가 아닌 때).
    applyHookEvent(sessions, ev('PreToolUse', bash('npm test')), 300_000)
    expect(sessions.get('s1')?.state).toBe('working')
    expect(sessions.get('s1')?.pausedForBackground ?? false).toBe(false)
    // 남은 것이 없이 멈추면 적지 않는다. 예약된 깨우기(session_crons)만 있어도 적는다.
    applyHookEvent(sessions, ev('Stop', { background_tasks: [], session_crons: [] }), 301_000)
    expect(sessions.get('s1')?.pausedForBackground ?? false).toBe(false)
    applyHookEvent(sessions, ev('UserPromptSubmit', { prompt: 'p' }), 302_000)
    applyHookEvent(sessions, ev('Stop', { session_crons: [{ id: 'c1' }] }), 303_000)
    expect(sessions.get('s1')?.pausedForBackground).toBe(true)
    // 모양이 다르면(배열이 아님) 없는 것으로 본다.
    applyHookEvent(sessions, ev('UserPromptSubmit', { prompt: 'p' }), 304_000)
    applyHookEvent(sessions, ev('Stop', { background_tasks: 'many' }), 305_000)
    expect(sessions.get('s1')?.pausedForBackground ?? false).toBe(false)
  })

  test('clearActivity 는 들고 있던 내용을 지운다', () => {
    const sessions: Sessions = new Map()
    applyHookEvent(sessions, ev('UserPromptSubmit', { prompt: '배포해 줘' }), 1000)
    applyHookEvent(
      sessions,
      { ...ev('PermissionRequest', bash('npm i')), session_id: 's2' },
      1000,
      'codex'
    )
    clearActivity(sessions)
    expect([...sessions.values()].map((s) => s.activity)).toEqual([undefined, undefined])
    // 상태는 그대로다.
    expect([...sessions.values()].map((s) => s.state)).toEqual(['working', 'waiting'])
  })

  test('한 줄로: 문자열이 아니거나 빈 글은 null, 앞의 빈 줄은 건너뛰고 넘치면 …', () => {
    expect(oneLine(5, 10)).toBeNull()
    expect(oneLine(null, 10)).toBeNull()
    expect(oneLine('', 10)).toBeNull()
    expect(oneLine(' \n\t ', 10)).toBeNull()
    expect(oneLine('\u0007벨', 10)).toBeNull()
    expect(oneLine('\r\n  첫 줄\t 이어서 \n둘째 줄', 80)).toBe('첫 줄 이어서')
    expect(oneLine('abcdef', 4)).toBe('abc…')
    expect(oneLine('abcd', 4)).toBe('abcd')
    // 이모지(서로게이트 쌍)를 반으로 자르지 않는다.
    expect(oneLine('ab😀cd', 4)).toBe('ab…')
    expect(oneLine('첫 줄\u2028둘째', 80)).toBe('첫 줄')
  })

  test.each<[string, unknown, string | null]>([
    ['Bash', { command: 'npm run build && npm test' }, 'npm run build && npm test'],
    ['PowerShell', { command: 'Get-ChildItem\nRemove-Item x' }, 'Get-ChildItem'],
    ['Read', { file_path: 'C:\\work\\shop-web\\src\\App.vue' }, 'App.vue'],
    ['Edit', { file_path: '/Users/dev/app/src/main.ts' }, 'main.ts'],
    ['Write', { file_path: '/Users/dev/app/README.md', content: '# 비밀' }, 'README.md'],
    ['MultiEdit', { file_path: '/Users/dev/app/a.ts' }, 'a.ts'],
    ['NotebookEdit', { notebook_path: '/Users/dev/app/n.ipynb' }, 'n.ipynb'],
    ['Read', { file_path: '/Users/dev/app/' }, 'app'],
    ['Grep', { pattern: 'TODO|FIXME' }, 'TODO|FIXME'],
    ['Glob', { pattern: 'g'.repeat(100) }, 'g'.repeat(79) + '…'],
    [
      'WebFetch',
      { url: 'https://user:pw@docs.example.com:8443/hooks?q=1' },
      'docs.example.com:8443'
    ],
    ['WebFetch', { url: 'not a url' }, null],
    ['Task', { description: '테스트 고치기', prompt: '긴 지시' }, '테스트 고치기'],
    ['Agent', { description: '코드 살펴보기' }, '코드 살펴보기'],
    ['TodoWrite', { todos: [] }, null],
    ['mcp__github__create_pull_request', { title: 'x' }, null],
    ['Bash', { command: 42 }, null],
    ['Read', 'C:\\x', null],
    ['Bash', null, null],
    ['Bash', ['ls'], null]
  ])('도구 요약 %s %o → %s', (name, input, expected) => {
    expect(toolSummary(name, input)).toBe(expected)
  })
})
