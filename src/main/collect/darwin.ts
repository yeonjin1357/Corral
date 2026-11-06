import type { ProcessInfo, RawSample, TcpEntry, TcpState } from '../../shared/types'
import { COMMAND_TIMEOUT_MS } from '../../shared/defaults'
import { runCommand, type CommandResult } from './runCommand'

/**
 * macOS 는 실행 파일 경로에 공백이 흔하다(`/Applications/Visual Studio Code.app/...`).
 * 한 줄에 comm 과 args 를 같이 받으면 경계를 알 수 없으므로 두 번 받아 pid 로 합친다.
 * GUI 앱으로 실행되면 PATH 가 짧을 수 있어 전체 경로를 쓴다.
 */
export const PS_STATS_ARGV = ['/bin/ps', '-axww', '-o', 'pid=,ppid=,rss=,comm=']
export const PS_ARGS_ARGV = ['/bin/ps', '-axww', '-o', 'pid=,args=']
export const LSOF_ARGV = ['/usr/sbin/lsof', '-nP', '-iTCP', '-FpnT', '-w']

const STATS_LINE = /^\s*(\d+)\s+(\d+)\s+(\d+)\s+(.+?)\s*$/
const ARGS_LINE = /^\s*(\d+)\s+(.*?)\s*$/

function lines(text: string): string[] {
  return text.split(/\r?\n/)
}

function basename(path: string): string {
  const parts = path.split('/')
  return parts[parts.length - 1] || path
}

export function parsePsOutput(statsOut: string, argsOut: string): ProcessInfo[] {
  const argsByPid = new Map<number, string>()
  for (const line of lines(argsOut)) {
    const m = ARGS_LINE.exec(line)
    if (m && m[2]) argsByPid.set(Number(m[1]), m[2])
  }

  const result: ProcessInfo[] = []
  for (const line of lines(statsOut)) {
    const m = STATS_LINE.exec(line)
    if (!m) continue
    const pid = Number(m[1])
    const comm = m[4]
    result.push({
      pid,
      ppid: Number(m[2]),
      name: basename(comm),
      memoryBytes: Number(m[3]) * 1024,
      commandLine: argsByPid.get(pid) ?? comm,
      startedAt: null
    })
  }
  return result
}

function parseHostPort(text: string): { host: string; port: number } | null {
  const bracketed = /^\[(.+)\]:(\d+)$/.exec(text)
  if (bracketed) return { host: bracketed[1], port: Number(bracketed[2]) }
  const plain = /^([^:[\]]+):(\d+)$/.exec(text)
  if (plain) return { host: plain[1], port: Number(plain[2]) }
  return null
}

function toState(value: string): TcpState {
  if (value === 'LISTEN') return 'Listen'
  if (value === 'ESTABLISHED') return 'Established'
  return 'Other'
}

/** `lsof -F pnT` 출력: p<pid> 로 프로세스가, f<fd> 로 소켓이 시작되고 n<주소>, TST=<상태> 가 뒤따른다. */
export function parseLsofOutput(out: string): TcpEntry[] {
  const result: TcpEntry[] = []
  let pid = 0
  let name: string | null = null
  let state: string | null = null

  const flush = (): void => {
    if (pid && name && state) {
      const [localText, remoteText] = name.split('->')
      const local = parseHostPort(localText)
      const remote = remoteText === undefined ? { host: '', port: 0 } : parseHostPort(remoteText)
      if (local && remote) {
        result.push({
          pid,
          localAddress: local.host,
          localPort: local.port,
          remoteAddress: remote.host,
          remotePort: remote.port,
          state: toState(state)
        })
      }
    }
    name = null
    state = null
  }

  for (const line of lines(out)) {
    if (!line) continue
    const tag = line[0]
    const value = line.slice(1)
    if (tag === 'p') {
      flush()
      pid = Number(value) || 0
    } else if (tag === 'f') {
      flush()
    } else if (tag === 'n') {
      name = value
    } else if (tag === 'T' && value.startsWith('ST=')) {
      state = value.slice(3)
    }
  }
  flush()
  return result
}

/** 포트를 연 프로세스들의 작업 폴더를 한 번에 묻는다. */
export function lsofCwdArgv(pids: number[]): string[] {
  return ['/usr/sbin/lsof', '-a', '-d', 'cwd', '-Fpn', '-w', '-p', pids.join(',')]
}

export function parseLsofCwd(out: string): Record<number, string> {
  const result: Record<number, string> = {}
  let pid = 0
  for (const line of lines(out)) {
    if (line.startsWith('p')) pid = Number(line.slice(1)) || 0
    else if (line.startsWith('n') && pid) result[pid] = line.slice(1)
  }
  return result
}

const MIN_DEV_PORT = 1024

type Runner = (argv: string[], opts?: { timeoutMs?: number }) => Promise<CommandResult>

export async function sampleDarwin(run: Runner = runCommand): Promise<RawSample> {
  const opts = { timeoutMs: COMMAND_TIMEOUT_MS }
  const [stats, args, lsof] = await Promise.all([run(PS_STATS_ARGV, opts), run(PS_ARGS_ARGV, opts), run(LSOF_ARGV, opts)])
  if (stats.exitCode !== 0) throw new Error(`ps exited with ${stats.exitCode}`)
  if (args.exitCode !== 0) throw new Error(`ps exited with ${args.exitCode}`)
  // lsof 는 결과가 없을 때도 1 로 끝난다.
  if (lsof.exitCode !== 0 && lsof.exitCode !== 1) throw new Error(`lsof exited with ${lsof.exitCode}`)
  const tcp = parseLsofOutput(lsof.stdout)

  // 작업 폴더는 보조 정보라 실패해도 샘플은 성공으로 본다.
  const listening = [...new Set(tcp.filter((t) => t.state === 'Listen' && t.localPort >= MIN_DEV_PORT).map((t) => t.pid))]
  let cwds: Record<number, string> = {}
  if (listening.length) {
    try {
      cwds = parseLsofCwd((await run(lsofCwdArgv(listening), opts)).stdout)
    } catch {
      cwds = {}
    }
  }
  return { processes: parsePsOutput(stats.stdout, args.stdout), tcp, cwds }
}
