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
    parked: false
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
  cpuPercent: null,
  memoryGrowth: null
} as ServerRow

function setup(over: { notify?: Partial<NotifySettings>; focused?: boolean } = {}): {
  shown: Notice[]
  clock: { now: number }
  update: (s: DashboardSnapshot) => void
} {
  const shown: Notice[] = []
  const clock = { now: 0 }
  const notifier = createNotifier({
    show: (n) => shown.push(n),
    settings: () => ({ ...DEFAULT_SETTINGS.notify, ...over.notify }),
    isFocused: () => over.focused ?? false,
    now: () => clock.now
  })
  return { shown, clock, update: notifier.update }
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
        target: 'agent:5000:5000'
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
  /** 정확한 상태(훅)를 아는 에이전트. */
  function hooked(
    pid: number,
    state: AgentRow['state'],
    stateSince: number,
    root = 'C:\\work\\shop-web'
  ): AgentRow {
    return { ...agent(pid, state, root), stateSource: 'hook', stateSince }
  }

  test('2분 넘게 일한 뒤 끝나면 알린다(그 에이전트로 가는 대상)', () => {
    const { shown, clock, update } = setup()
    update(snap({ agents: [hooked(1, 'working', 0)] }))
    clock.now = 12 * MIN
    update(snap({ agents: [hooked(1, 'idle', 12 * MIN)] }))
    expect(shown).toEqual([
      {
        title: 'shop-web 의 Claude 가 작업을 끝냈어요',
        body: '12분 동안 일했어요.',
        target: 'agent:1:1'
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
