import type {
  AgentHost,
  AgentRow,
  AgentState,
  AgentTool,
  ProcessInfo,
  RawSample,
  WorktreeInfo
} from '../shared/types'
import { commitSum, worktreeFolder } from '../shared/format'
import { agentKey } from '../shared/keys'
import { agentToolOf, buildTree, topLevelAgentPids, type ProcessTree } from './processTree'
import { summarizeProcesses } from './processSummary'
import type { HookView } from './sessions'

/** 하위 트리 CPU 사용률이 코어 1개 기준 이 값(%) 이상이면 작업 중으로 본다. */
export const WORKING_CPU_PERCENT = 2

/**
 * 이보다 짧은 간격으로 다시 재면(지금 새로고침 등) CPU 사용률을 새로 계산하지 않는다.
 * 짧은 구간은 잠깐 튄 값(예: 0.3초 동안 60ms = 20%)이 그대로 작업 중으로 보인다.
 */
export const MIN_CPU_WINDOW_MS = 2000

/**
 * 프로세스별 지난 샘플의 누적 CPU 시간. 키는 `pid:시작 시각`(pid 재사용 구분).
 * 에이전트 자신의 기록에는 그때 계산한 사용률(percent)도 남겨, 짧은 간격으로 다시 잴 때 그대로 쓴다.
 */
export type CpuMemo = Map<string, { cpuMs: number; at: number; percent?: number | null }>

function cpuKey(p: ProcessInfo): string {
  return `${p.pid}:${p.startedAt ?? ''}`
}

/**
 * 지난 샘플 이후 하위 트리가 쓴 CPU(ms). 프로세스마다 변화량을 더해, 그사이 끝난 자식 때문에
 * 합이 줄어 음수가 되는 일을 막는다. 기록이 없는 프로세스는 지난 샘플 뒤에 시작한 경우에만
 * 누적값 전체를 그 사이에 쓴 것으로 센다.
 */
function cpuDelta(members: ProcessInfo[], previous: CpuMemo, since: number): number {
  let delta = 0
  for (const m of members) {
    if (m.cpuMs == null) continue
    const prev = previous.get(cpuKey(m))
    if (prev) delta += Math.max(0, m.cpuMs - prev.cpuMs)
    else if (m.startedAt != null && m.startedAt >= since) delta += m.cpuMs
  }
  return delta
}

/**
 * 맨 위 프로세스(self)와 그 트리(members, self 포함)의 CPU 사용률(코어 1개 = 100, 소수 1자리 내림).
 * 지난 기록(previous)과 비교하고 이번 기록을 next 에 쓴다. 지난 기록이 없으면 null.
 * 짧은 간격(MIN_CPU_WINDOW_MS 미만)으로 다시 재면 지난 값을 그대로 쓰고, 기준(지난 샘플)을 넘겨
 * 다음 샘플이 충분히 긴 구간으로 재게 한다. 에이전트와 서버가 같은 계산을 쓴다.
 */
export function measureTreeCpu(
  self: ProcessInfo,
  members: ProcessInfo[],
  previous: CpuMemo,
  now: number,
  next: CpuMemo
): number | null {
  const prevSelf = previous.get(cpuKey(self))
  if (prevSelf && now - prevSelf.at < MIN_CPU_WINDOW_MS) {
    for (const m of members) {
      const prev = previous.get(cpuKey(m))
      if (prev) next.set(cpuKey(m), prev)
      else if (m.cpuMs != null) next.set(cpuKey(m), { cpuMs: m.cpuMs, at: now })
    }
    return prevSelf.percent ?? null
  }
  let cpuPercent: number | null = null
  if (prevSelf && self.cpuMs != null && now > prevSelf.at) {
    const delta = cpuDelta(members, previous, prevSelf.at)
    // 표시값과 판단이 어긋나지 않게(1.98% 를 2.0% 로 보이며 쉬는 중이라 하지 않게) 내려서 쓴다.
    cpuPercent = Math.floor((delta * 1000) / (now - prevSelf.at)) / 10
  }
  for (const m of members) if (m.cpuMs != null) next.set(cpuKey(m), { cpuMs: m.cpuMs, at: now })
  if (self.cpuMs != null)
    next.set(cpuKey(self), { cpuMs: self.cpuMs, at: now, percent: cpuPercent })
  return cpuPercent
}

/** 창을 찾아볼 조상 수(가까운 것부터). */
const HOST_MAX_DEPTH = 12
/**
 * 창 후보 pid 수 상한(앞의 것을 남긴다). 창을 가진 본 프로세스가 같은 이름 보조 프로세스들 뒤에 올 수 있어 넉넉히 두되,
 * 창 찾기 스크립트의 명령줄 길이(32767자) 안에 들어가는 만큼(가장 긴 pid 64개로 테스트).
 */
export const HOST_CANDIDATE_LIMIT = 64

/**
 * Windows 셸. 시작 메뉴·작업 표시줄로 띄운 것은 모두 이 아래라 조상에 흔히 있지만, 그 창(바탕 화면·탐색기)은
 * 에이전트의 창이 아니다. 여기서 조상 따라가기를 멈춘다.
 */
const WINDOWS_SHELL = /^explorer\.exe$/i
/** 콘솔 창의 주인(클래식 콘솔은 conhost, Windows Terminal·ConPTY 는 OpenConsole). 셸·에이전트의 자식이다. */
const CONSOLE_HOST = /^(conhost|openconsole)\.exe$/i
/** 셸·런타임·콘솔 호스트: 창을 띄우는 앱이 아니다(같은 이름의 다른 프로세스로 찾아볼 앱에서 뺀다). */
const NOT_APP =
  /^(cmd|powershell|pwsh|bash|sh|zsh|fish|dash|wsl|node|conhost|openconsole)(\.exe)?$/i
const WINDOWS_TERMINAL_NAME = 'WindowsTerminal.exe'

/** 절대 경로의 `.app` 번들 실행 파일(`/…/<이름>.app/Contents/MacOS/…`)에서 앞의 `.app` 경로. */
const APP_BUNDLE = /^(\/.*?\.app)\/Contents\/MacOS\//

/**
 * 명령줄이 macOS 앱 번들의 실행 파일이면 그 `.app` 경로. 다른 `.app` 안의 보조 앱(VS Code 의 Code Helper.app 등)은
 * null 이다 — open 으로 열면 보조 앱이 따로 뜰 수 있고, 그 위 조상이 본 앱이다.
 */
export function appBundleOf(commandLine: string): string | null {
  const app = APP_BUNDLE.exec(commandLine)?.[1]
  return app && !app.includes('.app/') ? app : null
}

/**
 * 에이전트가 떠 있는 창을 찾을 단서를 만드는 함수(샘플 하나에 한 번 만들어 에이전트마다 쓴다).
 * pids 는 창 후보를 고를 순서대로 담는다(창 찾기는 이 순서에서 창을 가진 첫 pid 를 쓴다). 창의 주인은 조상이 아닐 때가 많다:
 * 1. 에이전트 자신과 조상(가까운 것부터, explorer.exe·pitwall 자신에서 멈춤)마다 그 자식 콘솔 호스트(conhost·OpenConsole —
 *    클래식 콘솔 창의 주인), 그다음 그 조상 자신. 에이전트 자신은 후보가 아니다.
 * 2. 조상 가운데 가장 바깥의 앱(셸·런타임·콘솔 호스트가 아닌 것) 이름과 같은 다른 프로세스(pid 오름차순) — 여러 에이전트
 *    도구는 창 없는 pty 데몬이 셸을 띄우고, 창은 같은 실행 파일의 다른 프로세스가 갖는다.
 * 3. 그런 앱 조상이 하나도 없으면 WindowsTerminal.exe(기본 터미널로 넘긴 콘솔은 셸의 부모가 explorer 다).
 * 중복 없이 앞의 HOST_CANDIDATE_LIMIT(64)개까지. app 은 조상 가운데 첫 `.app` 번들(macOS).
 */
export function hostFinder(
  processes: ProcessInfo[],
  tree: ProcessTree,
  selfPid?: number
): (pid: number) => AgentHost {
  const add = <K>(map: Map<K, number[]>, key: K, pid: number): void => {
    const list = map.get(key)
    if (list) list.push(pid)
    else map.set(key, [pid])
  }
  /** 부모 pid → 자식 콘솔 호스트 pid. */
  const consoleHostsOf = new Map<number, number[]>()
  /** 소문자 이름 → pid. */
  const byName = new Map<string, number[]>()
  for (const p of processes) {
    add(byName, p.name.toLowerCase(), p.pid)
    const parent = CONSOLE_HOST.test(p.name) ? tree.parentOf(p.pid) : undefined
    if (parent) add(consoleHostsOf, parent.pid, p.pid)
  }
  const named = (name: string): number[] =>
    [...(byName.get(name.toLowerCase()) ?? [])].sort((a, b) => a - b)

  return (pid) => {
    const ancestors: ProcessInfo[] = []
    for (const p of tree.ancestors(pid, HOST_MAX_DEPTH)) {
      if (WINDOWS_SHELL.test(p.name) || p.pid === selfPid) break
      ancestors.push(p)
    }
    const candidates = [...(consoleHostsOf.get(pid) ?? [])]
    for (const p of ancestors) candidates.push(...(consoleHostsOf.get(p.pid) ?? []), p.pid)
    const outerApp = ancestors.filter((p) => !NOT_APP.test(p.name)).pop()
    candidates.push(...named(outerApp ? outerApp.name : WINDOWS_TERMINAL_NAME))
    const app = ancestors.map((p) => appBundleOf(p.commandLine)).find((a) => a !== null) ?? null
    return { pids: [...new Set(candidates)].slice(0, HOST_CANDIDATE_LIMIT), app }
  }
}

/** 에이전트별 지금 상태와 그 상태를 처음 본 시각. 키는 agentKey. */
export type AgentStateMemo = Map<string, { state: AgentState; since: number }>

/**
 * 에이전트 상태가 시작된 시각(F3)을 채운다. 정확한 상태(훅·Codex 세션 기록)는 그 상태가 된 이벤트 시각(exactSince),
 * CPU 추정은 pitwall 이 그 상태를 처음 본 시각(memo). 아직 모르는 상태(unknown)는 시각 없음.
 * memo 에는 지금 있는 에이전트만 남긴다.
 */
export function withStateSince(
  agents: AgentRow[],
  previous: AgentStateMemo,
  now: number,
  exactSince: (agent: AgentRow) => number | null
): { agents: AgentRow[]; memo: AgentStateMemo } {
  const memo: AgentStateMemo = new Map()
  const rows = agents.map((a): AgentRow => {
    if (a.state === 'unknown') return { ...a, stateSince: null }
    const key = agentKey(a)
    const prev = previous.get(key)
    const exact = a.stateSource === 'cpu' ? null : exactSince(a)
    const since = exact ?? (prev && prev.state === a.state ? prev.since : now)
    memo.set(key, { state: a.state, since })
    return { ...a, stateSince: since }
  })
  return { agents: rows, memo }
}

/** CPU 사용률로 짐작한 상태. 모르면 unknown. */
export function cpuState(cpuPercent: number | null): AgentState {
  if (cpuPercent == null) return 'unknown'
  return cpuPercent >= WORKING_CPU_PERCENT ? 'working' : 'idle'
}

export function buildAgents(input: {
  sample: RawSample
  worktrees: Map<number, WorktreeInfo>
  /** 개발 서버 포트 행의 프로세스와 자손. 에이전트가 띄운 개발 서버는 에이전트 몫으로 세지 않는다. */
  devServerPids: Set<number>
  previousCpu: CpuMemo
  now: number
  /**
   * 그 에이전트 프로세스의 훅 상태(G3a — 그 프로세스와 짝지은 세션, 없으면 그 워크트리의 짝 없는 세션, 도구별).
   * 워크트리를 모르면 worktreeRoot 는 null. 없으면 null.
   */
  hookFor?: (agent: {
    key: string
    worktreeRoot: string | null
    tool: AgentTool
  }) => HookView | null
  /** pitwall 자신의 pid. 창 후보를 찾을 때 여기서 멈춘다(pitwall 창은 에이전트의 창이 아니다). */
  selfPid?: number
}): {
  agents: AgentRow[]
  cpu: CpuMemo
  /** agentKey → 자기와 센 자손(개발 서버가 아닌 것) pid. 메모리·커밋에 센 프로세스와 같다. */
  members: Map<string, number[]>
} {
  const { sample, worktrees, devServerPids, previousCpu, now } = input
  const tree = buildTree(sample.processes)
  const hostOf = hostFinder(sample.processes, tree, input.selfPid)
  const cpu: CpuMemo = new Map()
  const agents: AgentRow[] = []
  const memberPids = new Map<string, number[]>()

  for (const pid of topLevelAgentPids(sample.processes, tree)) {
    const self = tree.byPid.get(pid)
    const tool = self && agentToolOf(self)
    if (!self || !tool) continue
    const descendants = tree
      .descendants(pid)
      .filter((d) => !devServerPids.has(d))
      .map((d) => tree.byPid.get(d))
      .filter((p): p is ProcessInfo => p !== undefined)
    const members = [self, ...descendants]
    const cpuPercent = measureTreeCpu(self, members, previousCpu, now, cpu)

    const worktree = worktrees.get(pid) ?? null
    const key = agentKey({ pid, startedAt: self.startedAt })
    const hook = input.hookFor?.({ key, worktreeRoot: worktree?.root ?? null, tool }) ?? null
    const pids = members.map((m) => m.pid)
    memberPids.set(key, pids)

    agents.push({
      pid,
      tool,
      worktree,
      workspace: null,
      startedAt: self.startedAt,
      memoryBytes: members.reduce((sum, m) => sum + m.memoryBytes, 0),
      commitBytes: commitSum(members),
      descendantCount: descendants.length,
      processes: summarizeProcesses(members),
      state: hook?.state ?? cpuState(cpuPercent),
      stateSource: hook ? 'hook' : 'cpu',
      // 상태 시작 시각·마지막 활동·오래 쉬는 세션은 이전 것을 기억하는 수집기가 채운다.
      stateSince: null,
      cpuPercent,
      lastActiveAt: null,
      parked: false,
      // 하는 일(G3b)은 최종 상태·세션 파일·설정을 아는 수집기가 채운다.
      activity: null,
      // 조용함(G3c)은 조용한 조건이 이어진 시각을 기억하는 수집기가 채운다.
      quietSince: null,
      host: hostOf(pid)
    })
  }

  agents.sort((a, b) => {
    if (!a.worktree !== !b.worktree) return a.worktree ? -1 : 1
    return (
      worktreeFolder(a.worktree).localeCompare(worktreeFolder(b.worktree)) ||
      (a.worktree?.root ?? '').localeCompare(b.worktree?.root ?? '') ||
      a.pid - b.pid
    )
  })
  return { agents, cpu, members: memberPids }
}
