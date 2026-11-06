import { spawn } from 'child_process'
import { mkdtemp, mkdir, writeFile, rm } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import { planKill, buildKillConfirm, createPortKiller, type KillDeps } from './kill'
import { buildSnapshot } from './snapshot'
import { sampleWindows } from './collect/windows'
import { createWorktreeResolver } from './collect/worktree'
import type { DashboardSnapshot, PortRow, ProcessInfo, RawSample } from '../shared/types'

describe.runIf(process.platform === 'win32')('실제 Windows 에서', () => {
  test('임시 git 저장소에서 띄운 서버를 찾아 확인 후 실제로 내린다', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'pitwall-kill-'))
    await mkdir(join(dir, '.git'))
    await writeFile(join(dir, '.git', 'HEAD'), 'ref: refs/heads/main\n')
    const script = join(dir, 'server.js')
    await writeFile(
      script,
      "const s = require('http').createServer((q, r) => r.end('ok')); s.listen(0, () => console.log(s.address().port))"
    )
    const child = spawn(process.execPath, [script], { windowsHide: true })
    const exited = new Promise<void>((r) => child.once('exit', () => r()))
    try {
      const port = await new Promise<number>((resolve) =>
        child.stdout.once('data', (d) => resolve(Number(String(d).trim())))
      )
      const raw = await sampleWindows()
      const worktrees = await createWorktreeResolver().resolveProcessWorktrees(raw.processes)
      const snapshot = buildSnapshot({
        sample: raw,
        worktrees,
        totalBytes: 1,
        freeBytes: 1,
        thresholds: { ramWarnPercent: 80, ramDangerPercent: 90 },
        now: Date.now()
      })
      const row = snapshot.ports.find((p) => p.port === port && p.pid === child.pid)
      expect(row?.worktree?.root.toLowerCase()).toBe(dir.toLowerCase())
      const killer = createPortKiller({
        latest: () => snapshot,
        resample: sampleWindows,
        confirm: async () => true,
        signal: (pid, sig) => {
          process.kill(pid, sig)
        },
        wait: async () => {},
        platform: 'win32'
      })
      await expect(killer.killPort(port, child.pid!)).resolves.toEqual({ status: 'killed' })
      await exited
      expect(child.exitCode !== null || child.signalCode !== null).toBe(true)
    } finally {
      child.kill()
      await rm(dir, { recursive: true, force: true })
    }
  }, 60000)
})

const MB = 1024 * 1024

function proc(
  pid: number,
  ppid: number,
  name: string,
  commandLine: string,
  startedAt: number | null
): ProcessInfo {
  return { pid, ppid, name, commandLine, memoryBytes: MB, startedAt }
}

const vite = proc(4100, 4000, 'node.exe', 'node vite --port 3000', 200)
const esbuild = proc(4101, 4100, 'esbuild.exe', 'esbuild --service', 300)
const row: PortRow = {
  port: 3000,
  pid: 4100,
  processName: 'node.exe',
  commandLine: 'node vite --port 3000',
  worktree: { root: 'C:\\work\\shop-web', branch: 'develop', isLinkedWorktree: false },
  unresolvable: false,
  memoryBytes: 2 * MB,
  descendantPids: [4101],
  clientCount: 0,
  startedAt: 200,
  judgement: null,
  idleSince: null,
  agentInWorktree: false
}
const freshSample: RawSample = {
  processes: [proc(4000, 1, 'cmd.exe', 'cmd', 100), vite, esbuild],
  tcp: []
}

function snapshotWith(ports: PortRow[]): DashboardSnapshot {
  return {
    takenAt: 1,
    memory: { totalBytes: 1, usedBytes: 0, usedPercent: 0, level: 'normal' },
    ports,
    groups: [],
    agentProcessCount: 0,
    stale: false,
    error: null
  }
}

describe('planKill', () => {
  test('최신 샘플에 없으면 gone', () => {
    expect(planKill(row, { processes: [], tcp: [] })).toEqual({ ok: false, reason: 'gone' })
  })

  test('이름·명령줄·시작 시각이 다르면 changed(pid 재사용)', () => {
    const swap = (p: Partial<ProcessInfo>): RawSample => ({
      processes: [{ ...vite, ...p }],
      tcp: []
    })
    expect(planKill(row, swap({ commandLine: 'other' }))).toEqual({ ok: false, reason: 'changed' })
    expect(planKill(row, swap({ name: 'python.exe' }))).toEqual({ ok: false, reason: 'changed' })
    expect(planKill(row, swap({ startedAt: 999 }))).toEqual({ ok: false, reason: 'changed' })
  })

  test('하위에 에이전트(Claude·Codex)가 돌고 있으면 내리지 않는다(세션이 같이 꺼지므로)', () => {
    const claude = proc(4200, 4100, 'claude.exe', '"C:\\Users\\a\\.local\\bin\\claude.exe"', 500)
    expect(planKill(row, { processes: [vite, esbuild, claude], tcp: [] })).toEqual({
      ok: false,
      reason: 'agent'
    })
  })

  test('자손은 오래된 스냅샷이 아니라 최신 샘플에서 다시 계산한다', () => {
    const newChild = proc(4102, 4100, 'node.exe', 'worker', 400)
    const stalePpid = proc(9000, 4100, 'unrelated.exe', 'x', 50)
    expect(planKill(row, { processes: [vite, esbuild, newChild, stalePpid], tcp: [] })).toEqual({
      ok: true,
      pids: [4100, 4101, 4102]
    })
  })
})

test('확인 창 문구', () => {
  expect(buildKillConfirm(row)).toEqual({
    title: '포트 내리기',
    message: ':3000 (shop-web · develop) 을(를) 내릴까요?',
    detail: 'node.exe (PID 4100) 와 하위 프로세스 1개가 종료돼요.',
    buttons: ['내리기', '취소'],
    defaultId: 1,
    cancelId: 1
  })
  expect(buildKillConfirm({ ...row, descendantPids: [] }).detail).toBe(
    'node.exe (PID 4100) 가 종료돼요.'
  )
})

test('같은 워크트리에 에이전트가 있으면 확인 창에 한 줄 더 알린다', () => {
  expect(buildKillConfirm({ ...row, agentInWorktree: true }).detail).toBe(
    'node.exe (PID 4100) 와 하위 프로세스 1개가 종료돼요.\n' +
      '이 워크트리에서 에이전트가 실행 중이에요. 에이전트가 이 서버를 쓰고 있을 수 있어요.'
  )
})

describe('killPort', () => {
  function deps(over: Partial<KillDeps> = {}): KillDeps & { signal: ReturnType<typeof vi.fn> } {
    const signal = vi.fn()
    return {
      latest: () => snapshotWith([row]),
      resample: async () => freshSample,
      confirm: async () => true,
      signal,
      wait: async () => {},
      platform: 'win32',
      ...over
    } as KillDeps & { signal: ReturnType<typeof vi.fn> }
  }

  test('Windows: 확인 후 루트와 자손을 각각 종료', async () => {
    const d = deps()
    await expect(createPortKiller(d).killPort(3000, 4100)).resolves.toEqual({ status: 'killed' })
    expect(d.signal.mock.calls).toEqual([
      [4100, 'SIGTERM'],
      [4101, 'SIGTERM']
    ])
  })

  test('macOS: SIGTERM 후 3초 기다려 같은 프로세스로 남아 있는 것만 SIGKILL', async () => {
    const wait = vi.fn(async () => {})
    const samples: RawSample[] = [freshSample, freshSample, { processes: [vite], tcp: [] }]
    let call = 0
    const resample = vi.fn(async () => samples[Math.min(call++, 2)])
    const d = deps({ platform: 'darwin', wait, resample })
    await expect(createPortKiller(d).killPort(3000, 4100)).resolves.toEqual({ status: 'killed' })
    expect(wait).toHaveBeenCalledWith(3000)
    expect(d.signal.mock.calls).toEqual([
      [4100, 'SIGTERM'],
      [4101, 'SIGTERM'],
      [4100, 'SIGKILL']
    ])
  })

  test('판별 불가 행·확인 취소·스냅샷에 없는 포트·잘못된 인자는 아무것도 종료하지 않는다', async () => {
    const unresolvable = deps({
      latest: () => snapshotWith([{ ...row, unresolvable: true, worktree: null }])
    })
    expect((await createPortKiller(unresolvable).killPort(3000, 4100)).status).toBe('failed')
    const cancel = deps({ confirm: async () => false })
    expect(await createPortKiller(cancel).killPort(3000, 4100)).toEqual({ status: 'cancelled' })
    const missing = deps({ latest: () => snapshotWith([]) })
    expect(await createPortKiller(missing).killPort(3000, 4100)).toEqual({ status: 'gone' })
    const nothing = deps({ latest: () => null })
    expect(await createPortKiller(nothing).killPort(3000, 4100)).toEqual({ status: 'gone' })
    const bad = deps()
    expect((await createPortKiller(bad).killPort(Number.NaN, -1)).status).toBe('failed')
    for (const d of [unresolvable, cancel, missing, nothing, bad])
      expect(d.signal).not.toHaveBeenCalled()
  })

  test('확인 창을 띄운 사이 프로세스가 바뀌면 종료하지 않는다', async () => {
    let call = 0
    const d = deps({
      resample: async () =>
        call++ === 0 ? freshSample : { processes: [{ ...vite, commandLine: 'other' }], tcp: [] }
    })
    expect(await createPortKiller(d).killPort(3000, 4100)).toEqual({ status: 'changed' })
    expect(d.signal).not.toHaveBeenCalled()
  })

  test('하위에 에이전트가 있으면 확인 창 없이 이유와 함께 거절', async () => {
    const claude = proc(4200, 4100, 'claude.exe', '"C:\\Users\\a\\.local\\bin\\claude.exe"', 500)
    const confirm = vi.fn(async () => true)
    const d = deps({
      confirm,
      resample: async () => ({ processes: [vite, esbuild, claude], tcp: [] })
    })
    expect(await createPortKiller(d).killPort(3000, 4100)).toEqual({
      status: 'failed',
      message:
        '이 프로세스 아래에서 에이전트(Claude·Codex)가 돌고 있어 내리지 않았어요. 에이전트를 먼저 끝내 주세요.'
    })
    expect(confirm).not.toHaveBeenCalled()
    expect(d.signal).not.toHaveBeenCalled()
  })

  test('재샘플이 실패하면 failed', async () => {
    const d = deps({
      resample: async () => {
        throw new Error('timeout')
      }
    })
    expect(await createPortKiller(d).killPort(3000, 4100)).toEqual({
      status: 'failed',
      message: 'timeout'
    })
  })

  test('루트가 이미 없으면(ESRCH) gone, 권한이 없으면(EPERM) failed + 안내', async () => {
    const esrch = deps({
      signal: vi.fn(() => {
        throw Object.assign(new Error('x'), { code: 'ESRCH' })
      })
    })
    expect(await createPortKiller(esrch).killPort(3000, 4100)).toEqual({ status: 'gone' })
    const eperm = deps({
      signal: vi.fn(() => {
        throw Object.assign(new Error('x'), { code: 'EPERM' })
      })
    })
    expect(await createPortKiller(eperm).killPort(3000, 4100)).toEqual({
      status: 'failed',
      message: '권한이 없어 내리지 못했어요. 관리자 권한으로 실행된 프로세스일 수 있어요.'
    })
  })

  test('자손 종료 실패는 무시하고 루트 결과로 판단', async () => {
    const d = deps({
      signal: vi.fn((pid: number) => {
        if (pid === 4101) throw Object.assign(new Error('x'), { code: 'ESRCH' })
      })
    })
    expect(await createPortKiller(d).killPort(3000, 4100)).toEqual({ status: 'killed' })
  })

  test('같은 pid 를 두 번 동시에 누르면 두 번째는 확인 창 없이 거절', async () => {
    let release: (v: boolean) => void = () => {}
    const confirm = vi.fn(() => new Promise<boolean>((r) => (release = r)))
    const killer = createPortKiller(deps({ confirm }))
    const first = killer.killPort(3000, 4100)
    const second = await killer.killPort(3000, 4100)
    expect(second).toEqual({ status: 'failed', message: '이미 처리 중이에요.' })
    await vi.waitFor(() => expect(confirm).toHaveBeenCalled())
    release(true)
    expect(await first).toEqual({ status: 'killed' })
    expect(confirm).toHaveBeenCalledTimes(1)
  })
})
