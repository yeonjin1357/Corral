import { createNotifier, type Notice } from './notifier'
import { blankSnapshot } from '../shared/snapshot'
import { DEFAULT_SETTINGS, type NotifySettings } from '../shared/settings'
import type {
  AgentRow,
  DashboardSnapshot,
  HeavyJobRow,
  MemoryLevel,
  ServerRow
} from '../shared/types'

const MIN = 60 * 1000
const GB = 1024 ** 3
const MB = 1024 ** 2

function snap(
  over: Partial<DashboardSnapshot> = {},
  level: MemoryLevel = 'normal'
): DashboardSnapshot {
  const usedPercent = { normal: 50, warn: 85, danger: 93.6 }[level]
  const usedBytes = (32 * GB * usedPercent) / 100
  return {
    ...blankSnapshot(1),
    memory: {
      totalBytes: 32 * GB,
      usedBytes,
      usedPercent,
      availableBytes: 32 * GB - usedBytes,
      level,
      ramLevel: level,
      commit: null,
      kernelBytes: null
    },
    ...over
  }
}

/** RAM 은 넉넉한데(50%) 커밋이 한도에 가까워 메모리 단계가 level 인 스냅샷. */
function commitBound(
  over: Partial<DashboardSnapshot>,
  level: MemoryLevel,
  percent: number
): DashboardSnapshot {
  const s = snap(over)
  return {
    ...s,
    memory: {
      ...s.memory,
      level,
      commit: { usedBytes: (64 * GB * percent) / 100, limitBytes: 64 * GB, percent, level }
    }
  }
}

function agent(pid: number, state: AgentRow['state'], root = 'C:\\work\\shop-web'): AgentRow {
  return {
    pid,
    tool: 'claude',
    worktree: { root, branch: 'develop', isLinkedWorktree: false },
    workspace: null,
    startedAt: pid,
    memoryBytes: 1,
    commitBytes: null,
    descendantCount: 0,
    processes: [],
    state,
    stateSource: state === 'waiting' ? 'hook' : 'cpu',
    stateSince: null,
    cpuPercent: 0,
    lastActiveAt: null,
    parked: false,
    activity: null,
    quietSince: null,
    host: { pids: [], app: null }
  }
}

function heavy(pid: number, label: string): HeavyJobRow {
  return {
    pid,
    label,
    processName: 'node.exe',
    commandLine: label,
    worktree: null,
    workspace: null,
    memoryBytes: 4 * GB,
    commitBytes: null,
    descendantPids: [],
    processes: [],
    startedAt: 1
  }
}

const candidate = {
  ports: [3000],
  pid: 4100,
  processName: 'node.exe',
  commandLine: 'node vite',
  worktree: { root: 'C:\\work\\old', branch: 'feat/x', isLinkedWorktree: true },
  workspace: null,
  unresolvable: false,
  memoryBytes: 900 * MB,
  commitBytes: null,
  descendantPids: [],
  processes: [],
  clientCount: 0,
  startedAt: 1,
  judgement: 'candidate',
  idleSince: 0,
  agentInWorktree: false,
  parkedAgent: false,
  parkedSince: null,
  cpuPercent: null,
  memoryGrowth: null
} as ServerRow

function setup(
  over: { notify?: Partial<NotifySettings>; focused?: boolean; reminderMs?: number } = {}
): {
  shown: Notice[]
  clock: { now: number }
  /** 창이 앞에 있는지(테스트 중에 바꿀 수 있다). */
  window: { focused: boolean }
  update: (s: DashboardSnapshot) => void
} {
  const shown: Notice[] = []
  const clock = { now: 0 }
  const window = { focused: over.focused ?? false }
  const notifier = createNotifier({
    show: (n) => shown.push(n),
    settings: () => ({ ...DEFAULT_SETTINGS.notify, ...over.notify }),
    isFocused: () => window.focused,
    now: () => clock.now,
    reminderMs: () => over.reminderMs ?? DEFAULT_SETTINGS.waitingReminderMinutes * MIN
  })
  return { shown, clock, window, update: notifier.update }
}

/** 명령·요청·세션 제목(알림에 들어가면 안 되는 내용)을 들고 있는 하는 일. */
const SECRET = 'npm run deploy --token=abc123'
function activity(waitingTool: string | null = null): AgentRow['activity'] {
  return {
    title: `배포 ${SECRET}`,
    prompt: `이걸로 배포해 줘: ${SECRET}`,
    tool: waitingTool ? null : { name: 'Bash', summary: SECRET, since: 0 },
    waiting: waitingTool ? { tool: waitingTool, summary: SECRET } : null
  }
}

/** 정확한 상태(훅)를 아는 에이전트. */
function hooked(
  pid: number,
  state: AgentRow['state'],
  stateSince = 0,
  root = 'C:\\work\\shop-web'
): AgentRow {
  return { ...agent(pid, state, root), stateSource: 'hook', stateSince }
}

describe('RAM 부족', () => {
  test('위험으로 넘어갈 때 한 번, 정리 추천 합계와 함께. 정상으로 내려와야 다시 알린다', () => {
    const { shown, clock, update } = setup()
    update(snap())
    update(snap({ servers: [candidate] }, 'danger'))
    expect(shown).toEqual([
      {
        title: 'RAM 이 부족해요 (93%)',
        body: '정리 후보 1개를 끄면 약 900 MB 를 확보할 수 있어요.',
        target: null
      }
    ])
    // 위험 ↔ 경고를 오가도 다시 알리지 않는다.
    update(snap({}, 'warn'))
    update(snap({}, 'danger'))
    expect(shown).toHaveLength(1)
    // 정상으로 내려왔다가 30분 뒤 다시 위험이면 알린다.
    update(snap())
    clock.now += 30 * MIN
    update(snap({}, 'danger'))
    expect(shown).toHaveLength(2)
    expect(shown[1].body).toBe('정리할 후보가 없어요. 메모리를 많이 쓰는 앱을 확인해 보세요.')
  })

  test('정리 후보의 커밋을 알면 RAM·커밋 둘 다 알린다', () => {
    const { shown, update } = setup()
    update(snap())
    update(snap({ servers: [{ ...candidate, commitBytes: 2 * GB }] }, 'danger'))
    expect(shown[0].body).toBe(
      '정리 후보 1개를 끄면 RAM 약 900 MB · 커밋 약 2.0 GB 를 확보할 수 있어요.'
    )
  })

  test('30분 안에는 다시 알리지 않는다(기준선 근처에서 오르내림)', () => {
    const { shown, clock, update } = setup()
    update(snap())
    update(snap({}, 'danger'))
    update(snap())
    clock.now += 29 * MIN
    update(snap({}, 'danger'))
    expect(shown).toHaveLength(1)
  })

  test('위험과 경고를 오가며 정상으로 안 내려와도, 위험 아래로 5분 있었으면 다시 알린다(30분 간격은 지킨다)', () => {
    const { shown, clock, update } = setup()
    update(snap())
    update(snap({}, 'danger'))
    expect(shown).toHaveLength(1)
    // 위험 아래로 5분이 안 됐다가 다시 위험이면 알리지 않는다.
    clock.now = 1 * MIN
    update(snap({}, 'warn'))
    clock.now = 5 * MIN
    update(snap({}, 'danger'))
    expect(shown).toHaveLength(1)
    // 경고로 5분 있었어도 첫 알림에서 30분이 안 됐으면 알리지 않는다.
    clock.now = 6 * MIN
    update(snap({}, 'warn'))
    clock.now = 11 * MIN
    update(snap({}, 'warn'))
    clock.now = 12 * MIN
    update(snap({}, 'danger'))
    expect(shown).toHaveLength(1)
    // 30분이 지난 뒤 경고로 5분 있다가 다시 위험이면 알린다.
    clock.now = 31 * MIN
    update(snap({}, 'warn'))
    clock.now = 36 * MIN
    update(snap({}, 'warn'))
    clock.now = 37 * MIN
    update(snap({}, 'danger'))
    expect(shown).toHaveLength(2)
    expect(shown[1].title).toBe('RAM 이 부족해요 (93%)')
  })

  test('커밋 때문에 위험이면 제목이 커밋 문구', () => {
    const { shown, clock, update } = setup()
    update(snap())
    update(commitBound({ servers: [candidate] }, 'danger', 95.8))
    expect(shown).toEqual([
      {
        title: '메모리 한도에 가까워요 (커밋 95%)',
        body: '정리 후보 1개를 끄면 약 900 MB 를 확보할 수 있어요.',
        target: null
      }
    ])
    // RAM 도 위험이면 RAM 문구.
    update(snap())
    clock.now = 30 * MIN
    const both = snap({}, 'danger')
    update({
      ...both,
      memory: {
        ...both.memory,
        commit: { usedBytes: 62 * GB, limitBytes: 64 * GB, percent: 96.9, level: 'danger' }
      }
    })
    expect(shown[1].title).toBe('RAM 이 부족해요 (93%)')
  })

  test('시작할 때 이미 위험이면 알리지 않고, 정상으로 내려온 뒤부터 알린다', () => {
    const { shown, update } = setup()
    update(snap({}, 'danger'))
    update(snap({}, 'danger'))
    expect(shown).toEqual([])
  })

  test('지연(stale)·RAM 정보 없음 스냅샷은 보지 않는다', () => {
    const { shown, update } = setup()
    update(snap())
    update({ ...snap({}, 'danger'), stale: true })
    update(blankSnapshot(2))
    expect(shown).toEqual([])
  })

  test('설정에서 끄면 알리지 않는다', () => {
    const { shown, update } = setup({ notify: { ramLow: false } })
    update(snap())
    update(snap({}, 'danger'))
    expect(shown).toEqual([])
  })
})

describe('Claude 권한 대기', () => {
  test('훅으로 권한 대기로 바뀐 세션마다 알리고, 그 에이전트로 가는 대상을 담는다', () => {
    const { shown, update } = setup()
    update(snap({ agents: [agent(5000, 'working')] }))
    update(snap({ agents: [agent(5000, 'waiting')] }))
    expect(shown).toEqual([
      {
        title: 'Claude 가 권한을 기다려요',
        body: 'shop-web · develop',
        target: 'agent:5000:5000',
        focusAgentKey: 'agent:5000:5000'
      }
    ])
    // 계속 기다리는 중이면 다시 알리지 않고, 풀렸다가 다시 기다리면 새 요청이라 알린다.
    update(snap({ agents: [agent(5000, 'waiting')] }))
    update(snap({ agents: [agent(5000, 'working')] }))
    update(snap({ agents: [agent(5000, 'waiting')] }))
    expect(shown).toHaveLength(2)
  })

  test('Codex(훅 연동)가 기다리면 Codex 로 알리고, 도구가 섞이면 에이전트로 묶는다', () => {
    const codex = (pid: number, state: AgentRow['state'], root?: string): AgentRow => ({
      ...agent(pid, state, root),
      tool: 'codex'
    })
    const one = setup()
    one.update(snap({ agents: [codex(6000, 'working')] }))
    one.update(snap({ agents: [codex(6000, 'waiting')] }))
    expect(one.shown[0].title).toBe('Codex 가 권한을 기다려요')
    const mixed = setup()
    mixed.update(snap({ agents: [codex(6000, 'working'), agent(5000, 'working')] }))
    mixed.update(snap({ agents: [codex(6000, 'waiting'), agent(5000, 'waiting')] }))
    expect(mixed.shown[0].title).toBe('에이전트 2개가 권한을 기다려요')
  })

  test('한꺼번에 여럿이 기다리면 하나로 묶는다', () => {
    const { shown, update } = setup()
    update(snap({ agents: [agent(5000, 'working'), agent(5100, 'idle', 'C:\\work\\wt-a')] }))
    update(snap({ agents: [agent(5000, 'waiting'), agent(5100, 'waiting', 'C:\\work\\wt-a')] }))
    expect(shown).toEqual([
      {
        title: 'Claude 2개가 권한을 기다려요',
        body: 'shop-web · develop, wt-a · develop',
        target: null
      }
    ])
  })

  test('시작할 때 이미 기다리던 세션, pitwall 창이 앞에 있을 때, 설정에서 끈 경우는 알리지 않는다', () => {
    const start = setup()
    start.update(snap({ agents: [agent(5000, 'waiting')] }))
    expect(start.shown).toEqual([])

    const focused = setup({ focused: true })
    focused.update(snap({ agents: [agent(5000, 'working')] }))
    focused.update(snap({ agents: [agent(5000, 'waiting')] }))
    expect(focused.shown).toEqual([])

    const off = setup({ notify: { claudeWaiting: false } })
    off.update(snap({ agents: [agent(5000, 'working')] }))
    off.update(snap({ agents: [agent(5000, 'waiting')] }))
    expect(off.shown).toEqual([])
  })
})

describe('무거운 작업 겹침', () => {
  test('겹침이 시작될 때 알리고, 끝났다가 10분 뒤 다시 겹치면 또 알린다', () => {
    const { shown, clock, update } = setup()
    const jobs = [heavy(1, 'vue-tsc'), heavy(2, 'vite build')]
    update(snap({}, 'warn'))
    update(snap({ heavyJobs: jobs, heavyOverlap: true }, 'warn'))
    expect(shown).toEqual([
      {
        title: '무거운 작업이 겹쳤어요 (RAM 85%)',
        body: 'vue-tsc, vite build 이(가) 동시에 돌고 있어요.',
        target: null
      }
    ])
    update(snap({ heavyJobs: jobs, heavyOverlap: true }, 'warn'))
    update(snap({}, 'warn'))
    clock.now += 5 * MIN
    update(snap({ heavyJobs: jobs, heavyOverlap: true }, 'warn'))
    expect(shown).toHaveLength(1)
    update(snap({}, 'warn'))
    clock.now += 10 * MIN
    update(snap({ heavyJobs: jobs, heavyOverlap: true }, 'warn'))
    expect(shown).toHaveLength(2)
  })

  test('커밋 때문에 겹침 경고가 나면 제목에 커밋 사용률', () => {
    const { shown, update } = setup()
    const jobs = [heavy(1, 'vue-tsc'), heavy(2, 'vite build')]
    update(commitBound({}, 'warn', 86.4))
    update(commitBound({ heavyJobs: jobs, heavyOverlap: true }, 'warn', 86.4))
    expect(shown.map((n) => n.title)).toEqual(['무거운 작업이 겹쳤어요 (커밋 86%)'])
  })

  test('설정에서 끄면 알리지 않는다', () => {
    const { shown, update } = setup({ notify: { heavyOverlap: false } })
    update(snap({}, 'warn'))
    update(snap({ heavyJobs: [heavy(1, 'a'), heavy(2, 'b')], heavyOverlap: true }, 'warn'))
    expect(shown).toEqual([])
  })
})

describe('작업 끝남(F4)', () => {
  test('2분 넘게 일한 뒤 끝나면 알린다(그 에이전트로 가는 대상)', () => {
    const { shown, clock, update } = setup()
    update(snap({ agents: [hooked(1, 'working', 0)] }))
    clock.now = 12 * MIN
    update(snap({ agents: [hooked(1, 'idle', 12 * MIN)] }))
    expect(shown).toEqual([
      {
        title: 'shop-web 의 Claude 가 작업을 끝냈어요',
        body: '12분 동안 일했어요.',
        target: 'agent:1:1',
        focusAgentKey: 'agent:1:1'
      }
    ])
  })

  test('2분이 안 된 짧은 답은 알리지 않는다', () => {
    const { shown, clock, update } = setup()
    update(snap({ agents: [hooked(1, 'working', 0)] }))
    clock.now = 2 * MIN - 1
    update(snap({ agents: [hooked(1, 'idle', clock.now)] }))
    expect(shown).toEqual([])
  })

  test('세션 파일로 안 상태도 2분 넘게 일하고 끝나면 작업 끝남을 알린다', () => {
    const { shown, clock, update } = setup()
    const file = (state: AgentRow['state'], since: number): AgentRow => ({
      ...agent(1, state),
      stateSource: 'file',
      stateSince: since
    })
    update(snap({ agents: [file('working', 0)] }))
    clock.now = 3 * MIN
    update(snap({ agents: [file('idle', clock.now)] }))
    expect(shown).toEqual([
      {
        title: 'shop-web 의 Claude 가 작업을 끝냈어요',
        body: '3분 동안 일했어요.',
        target: 'agent:1:1',
        focusAgentKey: 'agent:1:1'
      }
    ])
  })

  test('CPU 추정 상태로는 알리지 않는다', () => {
    const { shown, clock, update } = setup()
    const cpu = (state: AgentRow['state'], since: number): AgentRow => ({
      ...agent(1, state),
      stateSource: 'cpu',
      stateSince: since
    })
    update(snap({ agents: [cpu('working', 0)] }))
    clock.now = 10 * MIN
    update(snap({ agents: [cpu('idle', clock.now)] }))
    expect(shown).toEqual([])
  })

  test('창이 앞에 있으면 알리지 않는다', () => {
    const { shown, clock, update } = setup({ focused: true })
    update(snap({ agents: [hooked(1, 'working', 0)] }))
    clock.now = 10 * MIN
    update(snap({ agents: [hooked(1, 'idle', clock.now)] }))
    expect(shown).toEqual([])
  })

  test('설정에서 끄면 알리지 않는다', () => {
    const { shown, clock, update } = setup({ notify: { agentDone: false } })
    update(snap({ agents: [hooked(1, 'working', 0)] }))
    clock.now = 10 * MIN
    update(snap({ agents: [hooked(1, 'idle', clock.now)] }))
    expect(shown).toEqual([])
  })

  test('여럿이 함께 끝나면 하나로 묶는다', () => {
    const { shown, clock, update } = setup()
    update(snap({ agents: [hooked(1, 'working', 0), hooked(2, 'working', 0, 'C:\\work\\api')] }))
    clock.now = 5 * MIN
    update(
      snap({
        agents: [hooked(1, 'idle', clock.now), hooked(2, 'idle', clock.now, 'C:\\work\\api')]
      })
    )
    expect(shown).toEqual([
      {
        title: '에이전트 2개가 작업을 끝냈어요',
        body: 'shop-web · develop, api · develop',
        target: null
      }
    ])
  })

  test('작업 중에서 권한 대기로 바뀐 것은 끝난 것이 아니다', () => {
    const { shown, clock, update } = setup({ notify: { claudeWaiting: false } })
    update(snap({ agents: [hooked(1, 'working', 0)] }))
    clock.now = 5 * MIN
    update(snap({ agents: [hooked(1, 'waiting', clock.now)] }))
    expect(shown).toEqual([])
  })
})

describe('권한 대기 본문·다시 알림(G3e)', () => {
  /** 훅으로 권한 대기인 에이전트(기다리는 도구와 그 명령 요약을 안다). */
  const waitingOn = (pid: number, since: number, root?: string): AgentRow => ({
    ...hooked(pid, 'waiting', since, root),
    activity: activity('Bash')
  })

  test('권한 대기 본문에 도구 이름은 있고 명령 요약은 없다', () => {
    const { shown, update } = setup()
    update(snap({ agents: [hooked(5000, 'working')] }))
    update(snap({ agents: [waitingOn(5000, 0)] }))
    expect(shown).toEqual([
      {
        title: 'Claude 가 권한을 기다려요',
        body: 'shop-web · develop — Bash',
        target: 'agent:5000:5000',
        focusAgentKey: 'agent:5000:5000'
      }
    ])
    // 기다리는 도구를 모르면(하는 일 보기를 끔) 폴더 · 브랜치만.
    const unknown = setup()
    unknown.update(snap({ agents: [hooked(5000, 'working')] }))
    unknown.update(snap({ agents: [{ ...hooked(5000, 'waiting'), activity: null }] }))
    expect(unknown.shown[0].body).toBe('shop-web · develop')
  })

  test('10분 넘게 계속 기다리면 다시 알리고, 0 이면 다시 알리지 않는다', () => {
    const { shown, clock, update } = setup()
    update(snap({ agents: [hooked(5000, 'working')] }))
    update(snap({ agents: [waitingOn(5000, 0)] }))
    clock.now = 10 * MIN - 1
    update(snap({ agents: [waitingOn(5000, 0)] }))
    expect(shown).toHaveLength(1)
    clock.now = 10 * MIN
    update(snap({ agents: [waitingOn(5000, 0)] }))
    expect(shown[1]).toEqual({
      title: 'Claude 가 10분째 권한을 기다려요',
      body: 'shop-web · develop — Bash',
      target: 'agent:5000:5000',
      focusAgentKey: 'agent:5000:5000'
    })
    // 계속 기다리면 마지막으로 알린 뒤 10분마다 또 알린다.
    clock.now = 15 * MIN
    update(snap({ agents: [waitingOn(5000, 0)] }))
    expect(shown).toHaveLength(2)
    clock.now = 20 * MIN
    update(snap({ agents: [waitingOn(5000, 0)] }))
    expect(shown.slice(2).map((n) => n.title)).toEqual(['Claude 가 20분째 권한을 기다려요'])
    // 풀렸다가 다시 기다리면 새 대기라 첫 알림부터 다시 센다.
    clock.now = 21 * MIN
    update(snap({ agents: [hooked(5000, 'working', 21 * MIN)] }))
    clock.now = 22 * MIN
    update(snap({ agents: [waitingOn(5000, 22 * MIN)] }))
    clock.now = 31 * MIN
    update(snap({ agents: [waitingOn(5000, 22 * MIN)] }))
    clock.now = 32 * MIN
    update(snap({ agents: [waitingOn(5000, 22 * MIN)] }))
    expect(shown.slice(3).map((n) => n.title)).toEqual([
      'Claude 가 권한을 기다려요',
      'Claude 가 10분째 권한을 기다려요'
    ])

    const never = setup({ reminderMs: 0 })
    never.update(snap({ agents: [hooked(5000, 'working')] }))
    never.update(snap({ agents: [waitingOn(5000, 0)] }))
    for (let m = 5; m <= 60; m += 5) {
      never.clock.now = m * MIN
      never.update(snap({ agents: [waitingOn(5000, 0)] }))
    }
    expect(never.shown).toHaveLength(1)
  })

  test('다시 알릴 때 창이 앞에 있으면 보내지 않고 다음 간격에 다시 본다, 권한 대기 알림을 끄면 다시 알리지도 않는다', () => {
    const { shown, clock, window, update } = setup()
    update(snap({ agents: [hooked(5000, 'working')] }))
    update(snap({ agents: [waitingOn(5000, 0)] }))
    window.focused = true
    clock.now = 10 * MIN
    update(snap({ agents: [waitingOn(5000, 0)] }))
    window.focused = false
    clock.now = 11 * MIN
    update(snap({ agents: [waitingOn(5000, 0)] }))
    expect(shown).toHaveLength(1)
    clock.now = 20 * MIN
    update(snap({ agents: [waitingOn(5000, 0)] }))
    expect(shown.map((n) => n.title)).toEqual([
      'Claude 가 권한을 기다려요',
      'Claude 가 20분째 권한을 기다려요'
    ])

    const off = setup({ notify: { claudeWaiting: false } })
    off.update(snap({ agents: [hooked(5000, 'working')] }))
    off.update(snap({ agents: [waitingOn(5000, 0)] }))
    off.clock.now = 30 * MIN
    off.update(snap({ agents: [waitingOn(5000, 0)] }))
    expect(off.shown).toEqual([])
  })

  test('시작할 때 이미 기다리던 세션은 바로 알리지 않고, 계속 기다리면 간격 뒤에 다시 알림으로 알린다', () => {
    const { shown, clock, update } = setup()
    clock.now = 30 * MIN
    update(snap({ agents: [waitingOn(5000, 0)] }))
    expect(shown).toEqual([])
    clock.now = 40 * MIN
    update(snap({ agents: [waitingOn(5000, 0)] }))
    expect(shown.map((n) => n.title)).toEqual(['Claude 가 40분째 권한을 기다려요'])
  })

  test('여럿이 함께 다시 알릴 때가 되면 하나로 묶는다', () => {
    const { shown, clock, update } = setup()
    const both = (): DashboardSnapshot =>
      snap({ agents: [waitingOn(5000, 0), waitingOn(5100, 0, 'C:\\work\\wt-a')] })
    update(
      snap({ agents: [hooked(5000, 'working'), hooked(5100, 'working', 0, 'C:\\work\\wt-a')] })
    )
    update(both())
    clock.now = 10 * MIN
    update(both())
    const many = {
      title: 'Claude 2개가 권한을 기다려요',
      body: 'shop-web · develop, wt-a · develop',
      target: null
    }
    expect(shown).toEqual([many, many])
  })
})

describe('조용함·꺼짐 알림(G3e)', () => {
  /** 훅으로 작업 중인 에이전트. quietSince 가 있으면 조용한 에이전트(G3c). */
  const quiet = (pid: number, quietSince: number | null, root?: string): AgentRow => ({
    ...hooked(pid, 'working', 0, root),
    quietSince,
    activity: activity()
  })

  test('조용함은 생길 때 한 번', () => {
    const { shown, clock, update } = setup()
    update(snap({ agents: [quiet(1, null)] }))
    clock.now = 16 * MIN
    update(snap({ agents: [quiet(1, MIN)] }))
    expect(shown).toEqual([
      {
        title: 'shop-web 의 Claude 가 조용해요',
        body: '15분째 이벤트가 없어요. 멈췄는지 확인해 보세요.',
        target: 'agent:1:1',
        focusAgentKey: 'agent:1:1'
      }
    ])
    clock.now = 40 * MIN
    update(snap({ agents: [quiet(1, MIN)] }))
    expect(shown).toHaveLength(1)
    // 이벤트가 와서 풀렸다가 다시 조용해지면 새로 알린다.
    update(snap({ agents: [quiet(1, null)] }))
    clock.now = 60 * MIN
    update(snap({ agents: [quiet(1, 41 * MIN)] }))
    expect(shown.slice(1).map((n) => n.body)).toEqual([
      '19분째 이벤트가 없어요. 멈췄는지 확인해 보세요.'
    ])
  })

  test('여럿이 함께 조용해지면 하나로, 시작할 때 이미 조용했거나 창이 앞에 있거나 설정에서 끄면 알리지 않는다', () => {
    const many = setup()
    many.update(snap({ agents: [quiet(1, null), quiet(2, null, 'C:\\work\\api')] }))
    many.clock.now = 16 * MIN
    many.update(snap({ agents: [quiet(1, MIN), quiet(2, MIN, 'C:\\work\\api')] }))
    expect(many.shown).toEqual([
      { title: '에이전트 2개가 조용해요', body: 'shop-web · develop, api · develop', target: null }
    ])

    const start = setup()
    start.update(snap({ agents: [quiet(1, 0)] }))
    start.update(snap({ agents: [quiet(1, 0)] }))
    expect(start.shown).toEqual([])

    for (const over of [{ focused: true }, { notify: { agentQuiet: false } }]) {
      const quietOff = setup(over)
      quietOff.update(snap({ agents: [quiet(1, null)] }))
      quietOff.clock.now = 16 * MIN
      quietOff.update(snap({ agents: [quiet(1, MIN)] }))
      expect(quietOff.shown).toEqual([])
    }
  })

  test('작업 중이던 에이전트가 사라지면 꺼짐 알림, CPU 추정이던 것은 알리지 않는다', () => {
    const { shown, update } = setup()
    const cpu: AgentRow = { ...agent(2, 'working', 'C:\\work\\api'), stateSource: 'cpu' }
    update(snap({ agents: [{ ...hooked(1, 'working'), activity: activity() }, cpu] }))
    // 지연된 스냅샷에서 빠진 것은 꺼진 것으로 보지 않는다.
    update({ ...snap({ agents: [] }), stale: true })
    expect(shown).toEqual([])
    update(snap({ agents: [] }))
    // 꺼진 에이전트는 목록 행도 창도 없어 누르면 한눈에 보기로 연다(창으로 가기 키 없음).
    expect(shown).toEqual([
      {
        title: 'shop-web 의 Claude 가 꺼졌어요',
        body: '작업 중이었어요.',
        target: null
      }
    ])

    // 권한을 기다리던 것, 세션 기록(rollout)·세션 파일로 안 정확한 상태도 알린다.
    const waiting = setup({ notify: { claudeWaiting: false } })
    waiting.update(snap({ agents: [hooked(1, 'waiting')] }))
    waiting.update(snap({ agents: [] }))
    expect(waiting.shown.map((n) => n.body)).toEqual(['권한을 기다리던 중이었어요.'])
    const codex = setup()
    codex.update(
      snap({ agents: [{ ...agent(3, 'working'), tool: 'codex', stateSource: 'rollout' }] })
    )
    codex.update(snap({ agents: [] }))
    expect(codex.shown.map((n) => n.title)).toEqual(['shop-web 의 Codex 가 꺼졌어요'])
    const file = setup()
    file.update(snap({ agents: [{ ...agent(4, 'working'), stateSource: 'file' }] }))
    file.update(snap({ agents: [] }))
    expect(file.shown).toHaveLength(1)
  })

  test('쉬는 중이던 에이전트가 사라지면 알리지 않는다', () => {
    const { shown, update } = setup()
    update(snap({ agents: [hooked(1, 'idle'), hooked(2, 'error'), hooked(3, 'unknown')] }))
    update(snap({ agents: [] }))
    expect(shown).toEqual([])
  })

  test('여럿이 함께 꺼지면 하나로, 창이 앞에 있거나 설정에서 끄면 알리지 않는다', () => {
    const many = setup()
    many.update(snap({ agents: [hooked(1, 'working'), hooked(2, 'waiting', 0, 'C:\\work\\api')] }))
    many.update(snap({ agents: [] }))
    expect(many.shown).toEqual([
      { title: '에이전트 2개가 꺼졌어요', body: 'shop-web · develop, api · develop', target: null }
    ])

    for (const over of [{ focused: true }, { notify: { agentGone: false } }]) {
      const goneOff = setup(over)
      goneOff.update(snap({ agents: [hooked(1, 'working')] }))
      goneOff.update(snap({ agents: [] }))
      expect(goneOff.shown).toEqual([])
    }
  })
})

test('어떤 알림에도 명령·요청·세션 제목이 들어가지 않는다(도구 이름까지만)', () => {
  const { shown, clock, update } = setup()
  interface Look {
    state: AgentRow['state']
    since?: number
    quietSince?: number
  }
  type Looks = Record<number, Look>
  /** 에이전트 1~9 의 모습(주지 않은 것은 처음부터 작업 중). */
  const all = (looks: Looks): Looks => ({
    ...Object.fromEntries([1, 2, 3, 4, 5, 6, 7, 8, 9].map((pid) => [pid, { state: 'working' }])),
    ...looks
  })
  const without = (looks: Looks, ...pids: number[]): Looks =>
    Object.fromEntries(Object.entries(all(looks)).filter(([pid]) => !pids.includes(Number(pid))))
  const at = (min: number, looks: Looks): void => {
    clock.now = min * MIN
    update(
      snap({
        agents: Object.entries(looks).map(([pid, look]) => ({
          ...hooked(Number(pid), look.state, look.since ?? 0, `C:\\work\\wt-${pid}`),
          quietSince: look.quietSince ?? null,
          activity: activity(look.state === 'waiting' ? 'Bash' : null)
        }))
      })
    )
  }
  const wait1: Looks = { 1: { state: 'waiting', since: MIN } }
  const wait3: Looks = {
    ...wait1,
    2: { state: 'waiting', since: 2 * MIN },
    3: { state: 'waiting', since: 2 * MIN }
  }
  const quiet1: Looks = { ...wait3, 4: { state: 'working', quietSince: 5 * MIN } }
  const quiet3: Looks = {
    ...quiet1,
    5: { state: 'working', quietSince: 6 * MIN },
    6: { state: 'working', quietSince: 6 * MIN }
  }
  const done1: Looks = { ...quiet3, 7: { state: 'idle', since: 22 * MIN } }
  const done3: Looks = {
    ...done1,
    8: { state: 'idle', since: 23 * MIN },
    9: { state: 'idle', since: 23 * MIN }
  }
  at(0, all({}))
  at(1, all(wait1)) // 권한 대기 하나
  at(2, all(wait3)) // 권한 대기 여럿
  at(11, all(wait3)) // 다시 알림 하나
  at(12, all(wait3)) // 다시 알림 여럿
  at(20, all(quiet1)) // 조용함 하나
  at(21, all(quiet3)) // 조용함 여럿
  at(22, all(done1)) // 작업 끝남 하나
  at(23, all(done3)) // 작업 끝남 여럿
  at(24, without(done3, 1)) // 꺼짐 하나
  at(25, without(done3, 1, 4, 5)) // 꺼짐 여럿
  expect(shown.map((n) => n.title)).toEqual(
    expect.arrayContaining([
      'Claude 가 권한을 기다려요',
      'Claude 2개가 권한을 기다려요',
      'Claude 가 10분째 권한을 기다려요',
      'wt-4 의 Claude 가 조용해요',
      '에이전트 2개가 조용해요',
      'wt-7 의 Claude 가 작업을 끝냈어요',
      '에이전트 2개가 작업을 끝냈어요',
      'wt-1 의 Claude 가 꺼졌어요',
      '에이전트 2개가 꺼졌어요'
    ])
  )
  expect(shown.some((n) => n.body.includes('Bash'))).toBe(true)
  for (const n of shown) {
    expect(n.title).not.toContain(SECRET)
    expect(n.body).not.toContain(SECRET)
    expect(`${n.title} ${n.body}`).not.toContain('배포')
  }
})
