import { createKiller, type KillConfirm, type KillDeps } from './kill'
import { blankSnapshot } from '../shared/snapshot'
import type { LeftoverRow, PortRow, ProcessInfo, RawSample } from '../shared/types'

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

const candidate: PortRow = {
  port: 3000,
  pid: 4100,
  processName: 'node.exe',
  commandLine: 'node vite --port 3000',
  worktree: { root: 'C:\\work\\shop-web', branch: 'develop', isLinkedWorktree: false },
  unresolvable: false,
  memoryBytes: 800 * MB,
  descendantPids: [4101],
  clientCount: 0,
  startedAt: 200,
  judgement: 'candidate',
  idleSince: 0,
  agentInWorktree: false
}
const daemon: LeftoverRow = {
  pid: 7100,
  processName: 'java.exe',
  label: 'Gradle 데몬',
  commandLine: 'java GradleDaemon',
  worktree: { root: 'C:\\work\\api', branch: 'main', isLinkedWorktree: false },
  workspace: null,
  memoryBytes: 1100 * MB,
  descendantPids: [],
  startedAt: 50,
  agentInWorktree: false
}
const KEYS = ['port:3000:4100', 'leftover:7100:50']

function deps(over: Partial<KillDeps> = {}): KillDeps & {
  signal: ReturnType<typeof vi.fn>
  confirm: ReturnType<typeof vi.fn>
} {
  return {
    latest: () => ({ ...blankSnapshot(1), ports: [candidate], leftovers: [daemon] }),
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
  await expect(createKiller(d).killMany(['port:9999:1'])).resolves.toEqual({ status: 'gone' })
  expect(d.confirm).not.toHaveBeenCalled()
  await createKiller(d).killMany(['leftover:7100:50', 'port:9999:1'])
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
  await expect(k.killMany(Array.from({ length: 501 }, (_, i) => `port:${i}:1`))).resolves.toEqual(
    invalid
  )
  // 추천 항목이 많아도(51개) 거절하지 않는다(없는 키는 무시돼 gone).
  await expect(k.killMany(Array.from({ length: 51 }, (_, i) => `port:${i}:1`))).resolves.toEqual({
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
