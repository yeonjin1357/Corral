import { createKiller, type KillConfirm, type KillDeps } from './kill'
import { blankSnapshot } from '../shared/snapshot'
import type {
  AgentRow,
  HeavyJobRow,
  LeftoverRow,
  ServerRow,
  ProcessInfo,
  RawSample,
  WorkspaceInfo
} from '../shared/types'

const MB = 1024 * 1024

function proc(
  pid: number,
  ppid: number,
  name: string,
  commandLine: string,
  startedAt: number
): ProcessInfo {
  return { pid, ppid, name, commandLine, memoryBytes: MB, startedAt }
}

const vite = proc(4100, 4000, 'node.exe', 'node vite --port 3000', 200)
const esbuild = proc(4101, 4100, 'esbuild.exe', 'esbuild --service', 300)
const gradle = proc(7100, 1, 'java.exe', 'java GradleDaemon', 50)
const fresh: RawSample = { processes: [vite, esbuild, gradle], tcp: [] }

const candidate: ServerRow = {
  ports: [3000],
  pid: 4100,
  processName: 'node.exe',
  commandLine: 'node vite --port 3000',
  worktree: { root: 'C:\\work\\shop-web', branch: 'develop', isLinkedWorktree: false },
  workspace: null,
  unresolvable: false,
  memoryBytes: 800 * MB,
  commitBytes: null,
  descendantPids: [4101],
  processes: [],
  clientCount: 0,
  startedAt: 200,
  judgement: 'candidate',
  idleSince: 0,
  agentInWorktree: false,
  cpuPercent: null,
  memoryGrowth: null
}
const daemon: LeftoverRow = {
  pid: 7100,
  processName: 'java.exe',
  label: 'Gradle 데몬',
  commandLine: 'java GradleDaemon',
  worktree: { root: 'C:\\work\\api', branch: 'main', isLinkedWorktree: false },
  workspace: null,
  memoryBytes: 1100 * MB,
  commitBytes: null,
  descendantPids: [],
  processes: [],
  startedAt: 50,
  agentInWorktree: false
}
const KEYS = ['server:4100:200', 'leftover:7100:50']

function deps(over: Partial<KillDeps> = {}): KillDeps & {
  signal: ReturnType<typeof vi.fn>
  confirm: ReturnType<typeof vi.fn>
} {
  return {
    latest: () => ({ ...blankSnapshot(1), servers: [candidate], leftovers: [daemon] }),
    resample: async () => fresh,
    confirm: vi.fn(async () => true),
    signal: vi.fn(),
    wait: async () => {},
    platform: 'win32',
    ...over
  } as KillDeps & { signal: ReturnType<typeof vi.fn>; confirm: ReturnType<typeof vi.fn> }
}

test('확인 창 하나에 목록과 합계를 보이고, 확인하면 모두(자손 포함) 끈다', async () => {
  const d = deps()
  const result = await createKiller(d).killMany(KEYS)
  expect(d.confirm).toHaveBeenCalledTimes(1)
  const box = d.confirm.mock.calls[0][0] as KillConfirm
  expect(box.title).toBe('메모리 정리')
  expect(box.message).toBe('2개를 끌까요? 약 1.9 GB 를 확보해요.')
  expect(box.detail).toContain('• Gradle 데몬 (api · main) — 1.1 GB')
  expect(box.detail).toContain('• :3000 (shop-web · develop) — 800 MB')
  expect(box.buttons).toEqual(['모두 끄기', '취소'])
  expect(box.cancelId).toBe(1)
  expect(d.signal.mock.calls).toEqual([
    [7100, 'SIGTERM'],
    [4100, 'SIGTERM'],
    [4101, 'SIGTERM']
  ])
  expect(result).toEqual({ status: 'killed', message: '2개를 껐어요. 약 1.9 GB 를 확보했어요.' })
})

test('추천에 없는 키는 무시하고, 남는 것이 없으면 확인 창 없이 gone', async () => {
  const d = deps()
  await expect(createKiller(d).killMany(['server:9999:1'])).resolves.toEqual({ status: 'gone' })
  expect(d.confirm).not.toHaveBeenCalled()
  await createKiller(d).killMany(['leftover:7100:50', 'server:9999:1'])
  expect((d.confirm.mock.calls[0][0] as KillConfirm).message).toBe(
    '1개를 끌까요? 약 1.1 GB 를 확보해요.'
  )
})

test('취소하면 아무것도 끄지 않는다', async () => {
  const d = deps({ confirm: vi.fn(async () => false) })
  await expect(createKiller(d).killMany(KEYS)).resolves.toEqual({ status: 'cancelled' })
  expect(d.signal).not.toHaveBeenCalled()
})

test('확인 창을 띄운 사이 바뀐 것은 건너뛰고 결과에 알린다', async () => {
  const changed: RawSample = {
    processes: [vite, esbuild, { ...gradle, commandLine: 'java Other' }],
    tcp: []
  }
  const samples = [fresh, changed]
  const d = deps({ resample: async () => samples.shift() ?? changed })
  const result = await createKiller(d).killMany(KEYS)
  expect(d.signal.mock.calls.map((c) => c[0])).toEqual([4100, 4101])
  expect(result).toEqual({
    status: 'killed',
    message: '1개를 껐어요. 약 800 MB 를 확보했어요. 1개는 그 사이 바뀌거나 끝나서 건너뛰었어요.'
  })
})

test('커밋을 알면 확인 창·결과에 RAM·커밋을 둘 다, 결과는 실제로 끈 것만 더한다', async () => {
  const latest = (): ReturnType<typeof blankSnapshot> => ({
    ...blankSnapshot(1),
    servers: [{ ...candidate, commitBytes: 3000 * MB }],
    leftovers: [{ ...daemon, commitBytes: 1000 * MB }]
  })
  const all = deps({ latest })
  const result = await createKiller(all).killMany(KEYS)
  expect((all.confirm.mock.calls[0][0] as KillConfirm).message).toBe(
    '2개를 끌까요? RAM 약 1.9 GB · 커밋 약 3.9 GB 를 확보해요.'
  )
  expect(result).toEqual({
    status: 'killed',
    message: '2개를 껐어요. RAM 약 1.9 GB · 커밋 약 3.9 GB 를 확보했어요.'
  })

  // Gradle 데몬이 확인 창 사이에 바뀌어 건너뛰면 서버의 몫만.
  const changed: RawSample = {
    processes: [vite, esbuild, { ...gradle, commandLine: 'java Other' }],
    tcp: []
  }
  const samples = [fresh, changed]
  const some = deps({ latest, resample: async () => samples.shift() ?? changed })
  expect((await createKiller(some).killMany(KEYS)).message).toBe(
    '1개를 껐어요. RAM 약 800 MB · 커밋 약 2.9 GB 를 확보했어요. 1개는 그 사이 바뀌거나 끝나서 건너뛰었어요.'
  )
})

test('처음 확인에서 모두 바뀌었거나 끝났으면 확인 창 없이 gone', async () => {
  const d = deps({ resample: async () => ({ processes: [], tcp: [] }) })
  await expect(createKiller(d).killMany(KEYS)).resolves.toEqual({ status: 'gone' })
  expect(d.confirm).not.toHaveBeenCalled()
})

test('하나도 못 끄면 failed 와 이유', async () => {
  const signal = vi.fn(() => {
    throw Object.assign(new Error('denied'), { code: 'EPERM' })
  })
  const d = deps({ signal })
  await expect(createKiller(d).killMany(KEYS)).resolves.toEqual({
    status: 'failed',
    message: '2개는 끄지 못했어요(권한이 없거나 이미 끝남).'
  })
})

test('잘못된 요청(배열 아님·500개 초과·문자열 아님)은 거절하고, 추천이 50개를 넘어도 한꺼번에 받는다', async () => {
  const k = createKiller(deps())
  const invalid = { status: 'failed', message: '잘못된 요청이에요.' }
  await expect(k.killMany('x' as unknown as string[])).resolves.toEqual(invalid)
  await expect(k.killMany(Array.from({ length: 501 }, (_, i) => `server:${i}:1`))).resolves.toEqual(
    invalid
  )
  // 추천 항목이 많아도(51개) 거절하지 않는다(없는 키는 무시돼 gone).
  await expect(k.killMany(Array.from({ length: 51 }, (_, i) => `server:${i}:1`))).resolves.toEqual({
    status: 'gone'
  })
  await expect(k.killMany([1 as unknown as string])).resolves.toEqual(invalid)
})

test('같은 pid 를 처리 중이면 그 항목은 건너뛴다', async () => {
  let release: (v: boolean) => void = () => {}
  const confirm = vi.fn(
    (box: KillConfirm) =>
      new Promise<boolean>((r) => {
        if (box.title === '메모리 정리') r(true)
        else release = r
      })
  )
  const d = deps({ confirm })
  const killer = createKiller(d)
  const single = killer.killLeftover(7100)
  await new Promise((r) => setTimeout(r, 0))
  const result = await killer.killMany(KEYS)
  expect(d.signal.mock.calls.map((c) => c[0])).toEqual([4100, 4101])
  expect(result.message).toContain('1개는 이미 처리 중이라 건너뛰었어요.')
  release(false)
  await single
})

describe('작업 공간 한 번에 정리(F2)', () => {
  const WS: WorkspaceInfo = { root: 'C:\\work', name: 'work', branch: 'main', outer: true }
  const OTHER: WorkspaceInfo = { root: 'C:\\other', name: 'other', branch: null, outer: false }
  const server = { ...candidate, judgement: null, workspace: WS }
  const left = { ...daemon, workspace: WS }
  const elsewhere: ServerRow = { ...candidate, pid: 4200, ports: [5173], workspace: OTHER }
  const heavy: HeavyJobRow = {
    pid: 8000,
    label: 'vue-tsc',
    processName: 'node.exe',
    commandLine: 'node vue-tsc',
    worktree: candidate.worktree,
    workspace: WS,
    memoryBytes: 4000 * MB,
    commitBytes: null,
    descendantPids: [],
    processes: [],
    startedAt: 1
  }
  const agent: AgentRow = {
    pid: 5000,
    tool: 'claude',
    worktree: { root: 'C:\\work', branch: 'main', isLinkedWorktree: false },
    workspace: WS,
    startedAt: 1,
    memoryBytes: 600 * MB,
    commitBytes: null,
    descendantCount: 2,
    processes: [],
    state: 'idle',
    stateSource: 'hook',
    stateSince: 1,
    cpuPercent: 0
  }
  const latest =
    (over: Partial<ReturnType<typeof blankSnapshot>> = {}) =>
    (): ReturnType<typeof blankSnapshot> => ({
      ...blankSnapshot(1),
      servers: [server, elsewhere],
      leftovers: [left],
      heavyJobs: [heavy],
      ...over
    })
  const node = proc(8000, 1, 'node.exe', 'node vue-tsc', 1)

  test('작업 공간의 서버와 남은 프로세스를 확인 창 한 번으로 끈다', async () => {
    const d = deps({ latest: latest() })
    const result = await createKiller(d).cleanupWorkspace('c:\\WORK\\')
    expect(d.confirm).toHaveBeenCalledTimes(1)
    const box = d.confirm.mock.calls[0][0] as KillConfirm
    expect(box.title).toBe('작업 공간 정리')
    expect(box.message).toBe('work 의 2개를 끌까요? 약 1.9 GB 를 확보해요.')
    expect(box.detail).toContain('• Gradle 데몬 (api · main) — 1.1 GB')
    expect(box.detail).toContain('• :3000 (shop-web · develop) — 800 MB')
    expect(box.buttons).toEqual(['모두 끄기', '취소'])
    expect(d.signal.mock.calls.map((c) => c[0])).toEqual([7100, 4100, 4101])
    expect(result).toEqual({ status: 'killed', message: '2개를 껐어요. 약 1.9 GB 를 확보했어요.' })
  })

  test('무거운 작업·에이전트·다른 작업 공간·숨긴 서버는 끄지 않는다', async () => {
    const hidden = { ...candidate, pid: 4300, ports: [9000], workspace: WS }
    const d = deps({
      latest: latest({ agents: [agent], hiddenServers: [hidden] }),
      resample: async () => ({ processes: [...fresh.processes, node], tcp: [] })
    })
    await createKiller(d).cleanupWorkspace('C:\\work')
    const box = d.confirm.mock.calls[0][0] as KillConfirm
    expect(box.detail).not.toContain('vue-tsc')
    expect(box.detail).not.toContain(':5173')
    expect(box.detail).not.toContain(':9000')
    const killed = d.signal.mock.calls.map((c) => c[0])
    expect(killed).not.toContain(8000)
    expect(killed).not.toContain(5000)
    expect(killed).not.toContain(4200)
  })

  test('에이전트가 있으면 확인 창에 경고', async () => {
    const d = deps({ latest: latest({ agents: [agent] }) })
    await createKiller(d).cleanupWorkspace('C:\\work')
    expect((d.confirm.mock.calls[0][0] as KillConfirm).detail).toContain(
      'Claude 가 이 작업 공간에서 실행 중(쉬는 중)이에요. 서버를 꺼도 에이전트는 그대로예요.'
    )
  })

  test('묶음 머리와 같은 기준: 정리할 서버를 감싸는 폴더에서 일하는 에이전트도 경고한다', async () => {
    // 작업 공간은 모르지만(판별 실패) 서버 워크트리의 상위 폴더에서 일하는 Codex.
    const covering: AgentRow = {
      ...agent,
      pid: 5100,
      tool: 'codex',
      workspace: null,
      worktree: { root: 'C:\\work', branch: 'main', isLinkedWorktree: false },
      state: 'working'
    }
    const d = deps({ latest: latest({ agents: [covering] }) })
    await createKiller(d).cleanupWorkspace('C:\\work')
    expect((d.confirm.mock.calls[0][0] as KillConfirm).detail).toContain(
      'Codex 가 이 작업 공간에서'
    )
  })

  test('확인 창 사이에 바뀐 항목은 건너뛴다', async () => {
    const changed: RawSample = {
      processes: [vite, esbuild, { ...gradle, commandLine: 'java Other' }],
      tcp: []
    }
    const samples = [fresh, changed]
    const d = deps({ latest: latest(), resample: async () => samples.shift() ?? changed })
    const result = await createKiller(d).cleanupWorkspace('C:\\work')
    expect(d.signal.mock.calls.map((c) => c[0])).toEqual([4100, 4101])
    expect(result.message).toContain('1개는 그 사이 바뀌거나 끝나서 건너뛰었어요.')
  })

  test('끌 것이 없으면 gone, 잘못된 값은 failed', async () => {
    const d = deps({ latest: latest() })
    await expect(createKiller(d).cleanupWorkspace('C:\\none')).resolves.toEqual({ status: 'gone' })
    expect(d.confirm).not.toHaveBeenCalled()
    expect((await createKiller(d).cleanupWorkspace(1 as never)).status).toBe('failed')
    expect((await createKiller(d).cleanupWorkspace('')).status).toBe('failed')
  })
})
