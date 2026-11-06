import type {
  DashboardSnapshot,
  KillResult,
  LeftoverRow,
  Platform,
  PortRow,
  ProcessInfo,
  RawSample
} from '../shared/types'
import { worktreeLabel } from '../shared/format'
import { text } from '../shared/text'
import { classifyAgent, descendantsOf } from './processTree'

export type { KillResult }

export interface KillConfirm {
  title: string
  message: string
  detail: string
  buttons: string[]
  defaultId: number
  cancelId: number
}

/** 끌 대상(포트 행·남은 프로세스 행)에서 "같은 프로세스인지" 확인하는 데 쓰는 값. */
export type KillTarget = Pick<PortRow, 'pid' | 'processName' | 'commandLine' | 'startedAt'>

export type KillPlan =
  { ok: true; pids: number[] } | { ok: false; reason: 'gone' | 'changed' | 'agent' }

/** macOS 는 먼저 정상 종료(SIGTERM)를 요청하고, 이 시간 뒤에도 남아 있으면 강제 종료한다. */
const DARWIN_GRACE_MS = 3000

function isSameProcess(target: KillTarget, p: ProcessInfo): boolean {
  if (p.name !== target.processName || p.commandLine !== target.commandLine) return false
  if (target.startedAt != null && p.startedAt != null && target.startedAt !== p.startedAt)
    return false
  return true
}

/**
 * 종료 직전 최신 샘플로 "아직 그 프로세스가 맞는지"를 확인하고, 자손도 최신 샘플에서 다시 계산한다.
 * 스냅샷 이후 그 pid 가 다른 프로세스에 재사용됐으면 끄지 않는다.
 */
export function planKill(target: KillTarget, fresh: RawSample): KillPlan {
  const p = fresh.processes.find((x) => x.pid === target.pid)
  if (!p) return { ok: false, reason: 'gone' }
  if (!isSameProcess(target, p)) return { ok: false, reason: 'changed' }
  const descendants = descendantsOf(fresh.processes, target.pid)
  // 예: worktree 에서 띄운 IDE 를 내리면 그 터미널 안의 Claude·Codex 세션까지 같이 꺼진다.
  const byPid = new Map(fresh.processes.map((x) => [x.pid, x]))
  if (
    descendants.some((pid) => {
      const d = byPid.get(pid)
      return !!d && classifyAgent(d)
    })
  ) {
    return { ok: false, reason: 'agent' }
  }
  return { ok: true, pids: [target.pid, ...descendants] }
}

function planFailure(reason: 'gone' | 'changed' | 'agent'): KillResult {
  return reason === 'agent'
    ? { status: 'failed', message: text.killResult.agentInside }
    : { status: reason }
}

export function buildKillConfirm(row: PortRow): KillConfirm {
  return {
    title: text.kill.title,
    message: text.kill.message(row.port, worktreeLabel(row.worktree)),
    detail: [
      text.kill.detail(row.processName, row.pid, row.descendantPids.length),
      ...(row.agentInWorktree ? [text.kill.agentInWorktree] : [])
    ].join('\n'),
    buttons: [text.kill.confirm, text.kill.cancel],
    defaultId: 1,
    cancelId: 1
  }
}

export function buildLeftoverConfirm(row: LeftoverRow): KillConfirm {
  const where = row.worktree ? worktreeLabel(row.worktree) : text.leftoverKill.noWorktree
  return {
    title: text.leftoverKill.title,
    message: text.leftoverKill.message(row.label, where),
    detail: [
      text.kill.detail(row.processName, row.pid, row.descendantPids.length),
      ...(row.agentInWorktree ? [text.leftoverKill.agentInWorktree] : [])
    ].join('\n'),
    buttons: [text.leftoverKill.confirm, text.kill.cancel],
    defaultId: 1,
    cancelId: 1
  }
}

export interface KillDeps {
  latest: () => DashboardSnapshot | null
  resample: () => Promise<RawSample>
  confirm: (o: KillConfirm) => Promise<boolean>
  /** 기본은 process.kill. Windows 에서는 어떤 신호든 즉시 강제 종료(TerminateProcess)다. */
  signal: (pid: number, sig: NodeJS.Signals) => void
  wait: (ms: number) => Promise<void>
  platform: Platform
}

function errorCode(e: unknown): string | undefined {
  return typeof e === 'object' && e !== null && 'code' in e
    ? String((e as { code: unknown }).code)
    : undefined
}

function errorMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e)
}

function validId(n: number): boolean {
  return Number.isInteger(n) && n > 0
}

/**
 * 포트 내리기와 남은 프로세스 끄기. 둘 다 같은 절차를 거친다:
 * 최신 샘플로 같은 프로세스인지·하위에 에이전트가 없는지 확인 → 네이티브 확인 창 → 한 번 더 확인 → 루트와 자손 종료.
 * 같은 pid 를 동시에 처리하지 않는다(포트와 남은 프로세스 사이에서도).
 */
export function createKiller(deps: KillDeps): {
  killPort(port: number, pid: number): Promise<KillResult>
  killLeftover(pid: number): Promise<KillResult>
} {
  const busy = new Set<number>()

  async function freshPlan(target: KillTarget): Promise<{ plan: KillPlan; sample: RawSample }> {
    const sample = await deps.resample()
    return { plan: planKill(target, sample), sample }
  }

  async function escalateOnDarwin(pids: number[], planned: RawSample): Promise<void> {
    await deps.wait(DARWIN_GRACE_MS)
    let after: RawSample
    try {
      after = await deps.resample()
    } catch {
      return
    }
    const before = new Map(planned.processes.map((p) => [p.pid, p]))
    for (const pid of pids) {
      const was = before.get(pid)
      const now = after.processes.find((p) => p.pid === pid)
      // 3초 사이 pid 가 재사용됐을 수 있으므로 같은 프로세스로 남아 있는 것만 강제 종료한다.
      if (!was || !now || was.name !== now.name || was.commandLine !== now.commandLine) continue
      try {
        deps.signal(pid, 'SIGKILL')
      } catch {
        // 그 사이 끝났으면 됐다.
      }
    }
  }

  /** find 가 최신 스냅샷에서 대상을 찾아 돌려준다(없으면 gone, 문자열이면 그 이유로 실패). */
  async function run(
    pid: number,
    find: () => { target: KillTarget; confirm: KillConfirm } | 'gone' | KillResult
  ): Promise<KillResult> {
    if (busy.has(pid)) return { status: 'failed', message: text.killResult.busy }
    busy.add(pid)
    try {
      const found = find()
      if (found === 'gone') return { status: 'gone' }
      if ('status' in found) return found

      const before = await freshPlan(found.target)
      if (!before.plan.ok) return planFailure(before.plan.reason)
      if (!(await deps.confirm(found.confirm))) return { status: 'cancelled' }

      // 확인 창을 띄운 동안 시간이 지났으니 한 번 더 확인한다.
      const after = await freshPlan(found.target)
      if (!after.plan.ok) return planFailure(after.plan.reason)
      const [root, ...rest] = after.plan.pids

      try {
        deps.signal(root, 'SIGTERM')
      } catch (e) {
        const code = errorCode(e)
        if (code === 'ESRCH') return { status: 'gone' }
        if (code === 'EPERM') return { status: 'failed', message: text.killResult.permission }
        return { status: 'failed', message: errorMessage(e) }
      }
      for (const child of rest) {
        try {
          deps.signal(child, 'SIGTERM')
        } catch {
          // 자손이 이미 끝났거나 못 끄는 것은 루트 결과에 영향이 없다.
        }
      }
      if (deps.platform === 'darwin') await escalateOnDarwin(after.plan.pids, after.sample)
      return { status: 'killed' }
    } catch (e) {
      return { status: 'failed', message: errorMessage(e) }
    } finally {
      busy.delete(pid)
    }
  }

  function killPort(port: number, pid: number): Promise<KillResult> {
    if (!validId(port) || !validId(pid))
      return Promise.resolve({ status: 'failed', message: text.killResult.invalid })
    return run(pid, () => {
      const row = deps.latest()?.ports.find((r) => r.port === port && r.pid === pid)
      if (!row) return 'gone'
      if (row.unresolvable) return { status: 'failed', message: text.killResult.unresolvable }
      return { target: row, confirm: buildKillConfirm(row) }
    })
  }

  function killLeftover(pid: number): Promise<KillResult> {
    if (!validId(pid))
      return Promise.resolve({ status: 'failed', message: text.killResult.invalid })
    return run(pid, () => {
      const row = deps.latest()?.leftovers.find((r) => r.pid === pid)
      return row ? { target: row, confirm: buildLeftoverConfirm(row) } : 'gone'
    })
  }

  return { killPort, killLeftover }
}
