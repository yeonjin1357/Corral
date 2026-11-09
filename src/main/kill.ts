import type {
  DashboardSnapshot,
  KillResult,
  LeftoverRow,
  Platform,
  PortRow,
  ProcessInfo,
  RawSample
} from '../shared/types'
import { formatBytes, worktreeLabel } from '../shared/format'
import { selectionKey } from '../shared/keys'
import { cleanupRecommendation, type RecommendItem } from '../shared/recommend'
import { text } from '../shared/text'
import { classifyAgent, descendantsOf } from './processTree'

/** 한꺼번에 끄기 요청이 담을 수 있는 최대 항목 수(잘못된 요청을 막는 한도, 추천 항목은 이보다 훨씬 적다). */
const MAX_BATCH = 500
/** 확인 창에 한 줄씩 보일 최대 항목 수. */
const CONFIRM_LINES = 10

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
/** 정리 추천을 한꺼번에 끌 때의 확인 창: 항목 목록(최대 10줄)과 합계. */
export function buildManyConfirm(items: RecommendItem[]): KillConfirm {
  const total = items.reduce((sum, i) => sum + i.memoryBytes, 0)
  const lines = items
    .slice(0, CONFIRM_LINES)
    .map((i) => text.killMany.item(i.title, i.where, formatBytes(i.memoryBytes)))
  if (items.length > CONFIRM_LINES) lines.push(text.killMany.more(items.length - CONFIRM_LINES))
  return {
    title: text.killMany.title,
    message: text.killMany.message(items.length, formatBytes(total)),
    detail: [...lines, '', text.killMany.note].join('\n'),
    buttons: [text.killMany.confirm, text.kill.cancel],
    defaultId: 1,
    cancelId: 1
  }
}

export function createKiller(deps: KillDeps): {
  killPort(port: number, pid: number): Promise<KillResult>
  killLeftover(pid: number): Promise<KillResult>
  /** 정리 추천 중 고른 것들을 확인 창 하나로 끈다. 항목마다 최신 샘플로 다시 확인한다. */
  killMany(keys: string[]): Promise<KillResult>
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

  /** 루트에 종료를 보내고 자손에도 보낸다(자손 실패는 결과에 영향 없음). */
  function terminate(pids: number[]): KillResult {
    const [root, ...rest] = pids
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
    return { status: 'killed' }
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
      const result = terminate(after.plan.pids)
      if (result.status === 'killed' && deps.platform === 'darwin')
        await escalateOnDarwin(after.plan.pids, after.sample)
      return result
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

  async function killMany(keys: string[]): Promise<KillResult> {
    if (!Array.isArray(keys) || keys.length > MAX_BATCH || keys.some((k) => typeof k !== 'string'))
      return { status: 'failed', message: text.killResult.invalid }
    const latest = deps.latest()
    if (!latest) return { status: 'gone' }
    const wanted = new Set(keys)
    const targets = cleanupRecommendation(latest).items.flatMap((item) => {
      if (!wanted.has(item.key)) return []
      const row =
        item.kind === 'port'
          ? latest.ports.find((r) => selectionKey.port(r) === item.key)
          : latest.leftovers.find((r) => selectionKey.leftover(r) === item.key)
      return row ? [{ item, target: row as KillTarget }] : []
    })
    const busyCount = targets.filter((t) => busy.has(t.item.pid)).length
    const mine = targets.filter((t) => !busy.has(t.item.pid))
    if (mine.length === 0)
      return busyCount > 0
        ? { status: 'failed', message: text.killResult.busy }
        : { status: 'gone' }

    for (const t of mine) busy.add(t.item.pid)
    try {
      const before = await deps.resample()
      const ready = mine.filter((t) => planKill(t.target, before).ok)
      if (ready.length === 0) return { status: 'gone' }
      if (!(await deps.confirm(buildManyConfirm(ready.map((t) => t.item)))))
        return { status: 'cancelled' }

      // 확인 창을 띄운 동안 시간이 지났으니 항목마다 한 번 더 확인한다.
      const after = await deps.resample()
      let killed = 0
      let killedBytes = 0
      let failed = 0
      let skipped = mine.length - ready.length
      const killedPids: number[] = []
      for (const t of ready) {
        const plan = planKill(t.target, after)
        if (!plan.ok) {
          skipped++
          continue
        }
        if (terminate(plan.pids).status === 'killed') {
          killed++
          killedBytes += t.item.memoryBytes
          killedPids.push(...plan.pids)
        } else failed++
      }
      if (killedPids.length > 0 && deps.platform === 'darwin')
        await escalateOnDarwin(killedPids, after)

      const parts: string[] = []
      if (killed > 0) parts.push(text.killMany.killed(killed, formatBytes(killedBytes)))
      if (skipped > 0) parts.push(text.killMany.skipped(skipped))
      if (busyCount > 0) parts.push(text.killMany.busy(busyCount))
      if (failed > 0) parts.push(text.killMany.failed(failed))
      const message = parts.join(' ')
      if (killed > 0) return { status: 'killed', message }
      if (failed > 0) return { status: 'failed', message }
      return { status: 'changed' }
    } catch (e) {
      return { status: 'failed', message: errorMessage(e) }
    } finally {
      for (const t of mine) busy.delete(t.item.pid)
    }
  }

  return { killPort, killLeftover, killMany }
}
