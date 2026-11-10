import type { LeftoverRow, Platform, ProcessInfo, RawSample, WorktreeInfo } from '../shared/types'
import { agentCovers } from '../shared/format'
import { buildTree, classifyAgent } from './processTree'
import { processLabel, summarizeProcesses } from './processSummary'

export { processLabel }

/** 주인(실행한 프로세스)이 끝나도 남기 쉬운 개발 도구. 명령줄은 `/` 로 바꿔 비교한다. */
const TOOL =
  /ms-playwright|playwright|--remote-debugging-pipe|--headless|vitest|jest-worker|esbuild|node_modules\/\.bin\/|webpack|tsserver|GradleDaemon|KotlinCompileDaemon/i

/** 셸·패키지 실행기. 이것 자체는 개발 도구가 아니지만, 아래에 개발 도구를 거느린 채 남으면 같이 정리 대상이다. */
const WRAPPER_NAME = /^(cmd|bash|sh|zsh|dash|powershell|pwsh)(\.exe)?$/i
const WRAPPER_COMMAND = /npm-cli\.js|npx-cli\.js|[\\/]pnpm|[\\/]yarn|[\\/]bun(\.exe)?\b/i

function normalized(p: ProcessInfo): string {
  return p.commandLine.replace(/\\/g, '/')
}

export function isLeftoverTool(p: ProcessInfo): boolean {
  return TOOL.test(normalized(p))
}

function isWrapper(p: ProcessInfo): boolean {
  return WRAPPER_NAME.test(p.name) || WRAPPER_COMMAND.test(p.commandLine)
}

/**
 * 주인 없이 남은 개발 도구 프로세스(스펙 §3-5).
 * - 부모가 없다: 목록에 없거나, 시작 시각상 가짜 부모(pid 재사용)이거나, macOS 에서 launchd(1)로 옮겨졌다.
 * - 그 자신이 개발 도구이거나, 셸·패키지 실행기인데 아래에 개발 도구가 있다(에이전트가 띄운 `bash -c "npm test"` 등).
 * - 제외 목록(개발 서버 포트·에이전트·pitwall 트리)과 겹치거나 아래에 에이전트가 있으면 올리지 않는다.
 * 자손을 포함한 한 행이며, 메모리가 큰 순서.
 */
/**
 * 이보다 덜 산 프로세스는 아직 남은 것으로 보지 않는다. 에이전트가 백그라운드로 띄운 타입 검사·빌드는
 * 실행한 셸이 먼저 끝나 부모가 없어 보이지만, 에이전트가 결과를 기다리는 중이다.
 */
export const LEFTOVER_MIN_AGE_MS = 10 * 60 * 1000

export function findLeftovers(
  sample: RawSample,
  worktrees: Map<number, WorktreeInfo>,
  opts: {
    exclude: Set<number>
    /** 에이전트가 실행 중인 워크트리(worktreeKey). 그 워크트리의 행에 표시한다. */
    agentRoots?: Set<string>
    platform?: Platform
    /** 지금 시각. 주면 LEFTOVER_MIN_AGE_MS 보다 덜 산 프로세스를 뺀다(시작 시각을 모르면 빼지 않는다). */
    now?: number
  }
): LeftoverRow[] {
  const tree = buildTree(sample.processes)
  const rows: LeftoverRow[] = []
  for (const p of sample.processes) {
    const orphan =
      !tree.parentOf(p.pid) || (opts.platform === 'darwin' && p.ppid === 1 && p.pid !== 1)
    if (!orphan || opts.exclude.has(p.pid)) continue
    if (opts.now != null && p.startedAt != null && opts.now - p.startedAt < LEFTOVER_MIN_AGE_MS)
      continue

    const descendants = tree.descendants(p.pid)
    const members = [p, ...descendants.map((d) => tree.byPid.get(d)!)]
    const firstTool = members.find(isLeftoverTool)
    if (!firstTool || (firstTool !== p && !isWrapper(p))) continue
    if (members.some((m) => opts.exclude.has(m.pid) || classifyAgent(m))) continue

    const worktree = members.map((m) => worktrees.get(m.pid)).find((w) => w) ?? null
    rows.push({
      pid: p.pid,
      processName: p.name,
      label: processLabel(firstTool),
      commandLine: p.commandLine,
      worktree,
      memoryBytes: members.reduce((sum, m) => sum + m.memoryBytes, 0),
      descendantPids: descendants,
      processes: summarizeProcesses(members),
      startedAt: p.startedAt,
      workspace: null,
      agentInWorktree: !!worktree && agentCovers(opts.agentRoots ?? [], worktree.root)
    })
  }
  return rows.sort((a, b) => b.memoryBytes - a.memoryBytes || a.pid - b.pid)
}
