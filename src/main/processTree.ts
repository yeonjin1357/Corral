import type { AgentTool, ProcessInfo } from '../shared/types'

/* 프로세스 부모·자식 관계와 에이전트(Claude Code·Codex) 판별. 여러 모듈이 같이 쓴다. */

const AGENT_NAME =
  /^(claude(\.exe)?|codex(-(x86_64|aarch64|arm64|x64|universal)[\w.-]*)?(\.exe)?)$/i
const AGENT_PACKAGE = /@anthropic-ai\/claude-code|@openai\/codex/i
const CLAUDE_NAME = /^claude(\.exe)?$/i
const CLAUDE_PACKAGE = /@anthropic-ai\/claude-code/i
/** Claude 데스크톱 앱(이름이 같은 claude.exe / Claude)과 Electron 보조 프로세스는 에이전트가 아니다. */
const NOT_AGENT = /AnthropicClaude|Claude\.app\/|--type=/i

/** 에이전트면 도구 이름, 아니면 null. */
export function agentToolOf(p: ProcessInfo): AgentTool | null {
  const commandLine = p.commandLine.replace(/\\/g, '/')
  if (NOT_AGENT.test(commandLine)) return null
  if (!AGENT_NAME.test(p.name) && !AGENT_PACKAGE.test(commandLine)) return null
  return CLAUDE_NAME.test(p.name) || CLAUDE_PACKAGE.test(commandLine) ? 'claude' : 'codex'
}

export function classifyAgent(p: ProcessInfo): boolean {
  return agentToolOf(p) !== null
}

/**
 * Windows 는 부모가 끝나도 자식의 ppid 가 남고, 그 pid 가 나중에 다른 프로세스에 재사용될 수 있다.
 * 부모보다 먼저 시작한 "자식"은 진짜 자식이 아니다.
 */
function isPlausibleChild(child: ProcessInfo, parent: ProcessInfo): boolean {
  if (child.pid === parent.pid) return false
  if (child.startedAt == null || parent.startedAt == null) return true
  return child.startedAt >= parent.startedAt
}

export interface ProcessTree {
  byPid: Map<number, ProcessInfo>
  parentOf(pid: number): ProcessInfo | undefined
  descendants(pid: number): number[]
  ancestors(pid: number, maxDepth: number): ProcessInfo[]
}

export function buildTree(processes: ProcessInfo[]): ProcessTree {
  const byPid = new Map(processes.map((p) => [p.pid, p]))
  const children = new Map<number, number[]>()
  for (const p of processes) {
    const parent = byPid.get(p.ppid)
    if (!parent || !isPlausibleChild(p, parent)) continue
    const list = children.get(parent.pid)
    if (list) list.push(p.pid)
    else children.set(parent.pid, [p.pid])
  }

  const parentOf = (pid: number): ProcessInfo | undefined => {
    const p = byPid.get(pid)
    const parent = p && byPid.get(p.ppid)
    return p && parent && isPlausibleChild(p, parent) ? parent : undefined
  }

  // ppid 가 서로를 가리키는 고리가 있을 수 있어 방문 표시로 끊는다.
  const descendants = (pid: number): number[] => {
    const result: number[] = []
    const visited = new Set([pid])
    const queue = [...(children.get(pid) ?? [])]
    while (queue.length) {
      const next = queue.shift()!
      if (visited.has(next)) continue
      visited.add(next)
      result.push(next)
      queue.push(...(children.get(next) ?? []))
    }
    return result
  }

  const ancestors = (pid: number, maxDepth: number): ProcessInfo[] => {
    const result: ProcessInfo[] = []
    const visited = new Set([pid])
    let current = parentOf(pid)
    while (current && result.length < maxDepth && !visited.has(current.pid)) {
      visited.add(current.pid)
      result.push(current)
      current = parentOf(current.pid)
    }
    return result
  }

  return { byPid, parentOf, descendants, ancestors }
}

/** 에이전트 조상이 없는(같은 세션의 하위가 아닌) 에이전트 pid. */
export function topLevelAgentPids(
  processes: ProcessInfo[],
  tree: ProcessTree = buildTree(processes)
): number[] {
  const agentSet = new Set(processes.filter(classifyAgent).map((p) => p.pid))
  return [...agentSet].filter(
    (pid) => !tree.ancestors(pid, Number.MAX_SAFE_INTEGER).some((a) => agentSet.has(a.pid))
  )
}

/** 시작 시각으로 pid 재사용을 걸러낸 자손 pid 목록(종료 직전 최신 샘플로 다시 계산할 때 쓴다). */
export function descendantsOf(processes: ProcessInfo[], pid: number): number[] {
  return buildTree(processes).descendants(pid)
}
