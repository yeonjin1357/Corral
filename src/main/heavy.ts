import type { HeavyJobRow, RawSample, WorktreeInfo } from '../shared/types'
import { buildTree } from './processTree'

/** 실행 파일·스크립트로 보는 확장자(이름에서 떼고 비교한다). */
const EXEC_EXT = /\.(exe|cmd|bat|com|js|mjs|cjs|ps1|sh)$/i
const MAX_ANCESTOR_DEPTH = 3

function words(pattern: string): string[] {
  return pattern.trim().toLowerCase().split(/\s+/).filter(Boolean)
}

/** 경로의 마지막 이름(확장자 제외, 소문자). */
function baseName(token: string): string {
  const last = token.split(/[\\/]/).pop() ?? ''
  return last.replace(EXEC_EXT, '').toLowerCase()
}

/**
 * 이 토큰이 "실행한 명령"으로 볼 만한가. 경로가 없는 이름(`vue-tsc`)이나 실행 파일·스크립트 확장자,
 * `bin` 폴더 안, `./` 로 시작하는 것만. 인자로 넘긴 폴더(`code C:\repos\webpack`)를 명령으로 오해하지 않도록.
 */
function looksExecutable(token: string): boolean {
  if (!/[\\/]/.test(token)) return true
  if (EXEC_EXT.test(token) || /^\.{1,2}[\\/]/.test(token)) return true
  const parts = token.split(/[\\/]/)
  const parent = (parts[parts.length - 2] ?? '').toLowerCase()
  return parent === 'bin' || parent === '.bin'
}

/** 따옴표로 묶인 구간을 한 토큰으로 본다(`"C:\Program Files\nodejs\node.exe"`). */
const TOKEN = /(?:[^\s"]+|"[^"]*")+/g
/** 다음 명령을 실행하는 셸. 실행 옵션(-c·/c 등) 뒤 문자열이 명령이다. */
const SHELLS = new Set(['cmd', 'sh', 'bash', 'zsh', 'fish', 'dash', 'pwsh', 'powershell'])
const SHELL_RUN = new Set(['-c', '/c', '/k', '-command', '-lc', '-ic'])
/** 뒤따르는 첫 번째 옵션 아닌 토큰이 실행할 명령·스크립트인 실행기. */
const LAUNCHERS = new Set(['node', 'npx', 'bunx', 'env', 'nice', 'nohup', 'time', 'deno'])
/** 하위 명령(exec·dlx·x) 뒤가 실행할 명령인 패키지 관리자(run 뒤는 스크립트 이름이라 명령이 아니다). */
const PACKAGE_MANAGERS = new Set(['npm', 'pnpm', 'yarn', 'bun'])
const PM_EXEC = new Set(['exec', 'dlx', 'x'])

interface Token {
  text: string
  /** 실행되는 명령 자리(맨 앞, 셸 -c 뒤, node·npx 뒤 등). */
  command: boolean
}

/**
 * 명령줄을 토큰으로 나누고, 어느 토큰이 실제로 실행되는 명령 자리인지 표시한다.
 * 셸이 실행 옵션 뒤에 따옴표로 넘긴 명령(`cmd /c "vue-tsc --noEmit"`, `bash -c "npx tsc"`)은 안을 다시 나눈다.
 */
function commandTokens(commandLine: string): Token[] {
  const out: Token[] = []
  const walk = (raw: string[]): void => {
    type State = 'command' | 'shellString' | 'pmSub' | 'args'
    let state: State = 'command'
    let shell = false
    for (const piece of raw) {
      const text = piece.replace(/"/g, '')
      const lower = text.toLowerCase()
      if (!text) continue
      if (state === 'shellString') {
        state = 'args'
        if (/\s/.test(text)) {
          walk(text.match(TOKEN) ?? [])
          continue
        }
        out.push({ text, command: true })
        state = nextState(text)
        continue
      }
      if (state === 'pmSub') {
        out.push({ text, command: false })
        state = PM_EXEC.has(lower) ? 'command' : 'args'
        continue
      }
      if (state === 'command') {
        const isFlag = lower.startsWith('-') || /^\/[a-z?]{1,8}$/i.test(lower)
        if (isFlag) {
          out.push({ text, command: false })
          if (shell && SHELL_RUN.has(lower)) state = 'shellString'
          continue
        }
        // env 의 변수 지정(NAME=값)은 명령이 아니다.
        if (/^[A-Za-z_][A-Za-z0-9_]*=/.test(text)) {
          out.push({ text, command: false })
          continue
        }
        out.push({ text, command: true })
        shell = SHELLS.has(baseName(text))
        state = nextState(text)
        continue
      }
      out.push({ text, command: false })
    }
  }
  const nextState = (command: string): 'command' | 'pmSub' | 'args' => {
    const base = baseName(command)
    if (SHELLS.has(base) || LAUNCHERS.has(base)) return 'command'
    if (PACKAGE_MANAGERS.has(base)) return 'pmSub'
    return 'args'
  }
  walk(commandLine.match(TOKEN) ?? [])
  return out
}

/**
 * 명령줄이 무거운 명령 패턴("명령 이름 [인자…]") 중 하나에 맞으면 그 패턴(설정에 쓴 그대로), 아니면 null.
 * - 첫 단어: 실제로 실행되는 명령 자리의 토큰(맨 앞, 셸 -c·/c 뒤, node·npx·npm exec 뒤)의 파일 이름
 *   (경로·확장자 제외, 대소문자 무시)과 같아야 한다. `git commit -m "fix tsc"` 의 tsc, `tsconfig.json` 에는 안 걸린다.
 * - 나머지 단어: 그 뒤 토큰에 순서대로 나와야 한다(사이의 옵션은 건너뜀). 예: `vite --mode production build`.
 */
export function heavyMatch(commandLine: string, patterns: string[]): string | null {
  const tokens = commandTokens(commandLine)
  if (tokens.length === 0) return null
  const bases = tokens.map((t) => baseName(t.text))
  const lower = tokens.map((t) => t.text.toLowerCase())
  for (const pattern of patterns) {
    const [first, ...rest] = words(pattern)
    if (!first) continue
    for (let i = 0; i < tokens.length; i++) {
      if (!tokens[i].command || bases[i] !== first || !looksExecutable(tokens[i].text)) continue
      let j = i + 1
      const ok = rest.every((w) => {
        while (j < tokens.length && lower[j] !== w) j++
        if (j >= tokens.length) return false
        j++
        return true
      })
      if (ok) return pattern
    }
  }
  return null
}

/**
 * 무거운 작업(설정의 명령 패턴에 맞는 프로세스). 한 트리에서는 가장 위의 일치 프로세스 하나가 한 작업이고,
 * 그 자손은 그 작업의 일부다. 제외 목록(개발 서버 트리·에이전트 자체·pitwall)은 작업으로도, 작업의 조상으로도 보지 않는다.
 */
export function findHeavyJobs(
  sample: RawSample,
  worktrees: Map<number, WorktreeInfo>,
  o: { patterns: string[]; exclude: Set<number> }
): HeavyJobRow[] {
  if (o.patterns.length === 0) return []
  const tree = buildTree(sample.processes)
  const label = new Map<number, string>()
  for (const p of sample.processes) {
    if (o.exclude.has(p.pid)) continue
    const matched = heavyMatch(p.commandLine, o.patterns)
    // 아래에서 개발 서버·에이전트가 도는 래퍼(`cmd /c "webpack serve"`)는 무거운 작업이 아니다.
    if (matched && tree.descendants(p.pid).some((d) => o.exclude.has(d))) continue
    if (matched) label.set(p.pid, matched)
  }
  const rows: HeavyJobRow[] = []
  for (const [pid, matched] of label) {
    if (tree.ancestors(pid, Number.MAX_SAFE_INTEGER).some((a) => label.has(a.pid))) continue
    const p = tree.byPid.get(pid)!
    const descendantPids = tree.descendants(pid).filter((d) => !o.exclude.has(d))
    let memoryBytes = p.memoryBytes
    for (const d of descendantPids) memoryBytes += tree.byPid.get(d)?.memoryBytes ?? 0
    let worktree = worktrees.get(pid) ?? null
    if (!worktree)
      for (const a of tree.ancestors(pid, MAX_ANCESTOR_DEPTH)) {
        worktree = worktrees.get(a.pid) ?? null
        if (worktree) break
      }
    rows.push({
      pid,
      label: matched,
      processName: p.name,
      commandLine: p.commandLine,
      worktree,
      workspace: null,
      memoryBytes,
      descendantPids,
      startedAt: p.startedAt
    })
  }
  return rows.sort((a, b) => b.memoryBytes - a.memoryBytes || a.pid - b.pid)
}
