import type { ProcessInfo, RawSample, TcpEntry, TcpState } from '../../shared/types'
import { COMMAND_TIMEOUT_MS } from '../../shared/defaults'
import { runCommand } from './runCommand'

/**
 * 프로세스 목록과 TCP 연결을 PowerShell 한 번으로 JSON 으로 받는다.
 * - netstat 은 OS 언어에 따라 제목줄이 바뀌므로 쓰지 않는다. TCP 상태는 enum 이름(언어 무관)으로 낸다.
 * - 한글 등 비 ASCII 경로가 깨지지 않도록 출력 인코딩을 UTF-8 로 고정한다.
 */
export const WINDOWS_SAMPLE_SCRIPT = [
  "$ProgressPreference = 'SilentlyContinue'",
  '[Console]::OutputEncoding = [System.Text.Encoding]::UTF8',
  "$p = @(Get-CimInstance Win32_Process | Select-Object ProcessId, ParentProcessId, Name, CommandLine, WorkingSetSize, @{ Name = 'StartedAt'; Expression = { if ($_.CreationDate) { [DateTimeOffset]::new($_.CreationDate).ToUnixTimeMilliseconds() } else { $null } } })",
  "$t = @(Get-NetTCPConnection -State Listen,Established,TimeWait -ErrorAction SilentlyContinue | Select-Object OwningProcess, LocalAddress, LocalPort, RemoteAddress, RemotePort, @{ Name = 'State'; Expression = { $_.State.ToString() } })",
  '@{ processes = $p; tcp = $t } | ConvertTo-Json -Compress -Depth 3'
].join('\n')

/** PATH 에 의존하지 않도록 Windows PowerShell 5.1 의 전체 경로를 쓴다(모든 Windows 10/11 에 있음). */
export function powershellPath(env: Record<string, string | undefined> = process.env): string {
  const root = env.SystemRoot ?? 'C:\\Windows'
  return `${root}\\System32\\WindowsPowerShell\\v1.0\\powershell.exe`
}

/** 따옴표·`$`·줄바꿈이 인자 전달 중에 깨지지 않도록 스크립트를 UTF-16LE base64 로 넘긴다. */
export function buildPowerShellArgs(script: string): string[] {
  return [
    '-NoProfile',
    '-NonInteractive',
    '-ExecutionPolicy',
    'Bypass',
    '-EncodedCommand',
    Buffer.from(script, 'utf16le').toString('base64')
  ]
}

type Json = Record<string, unknown>

/** ConvertTo-Json 은 항목이 하나면 배열 대신 객체를, 없으면 null 을 낸다. */
function toArray(value: unknown): Json[] {
  if (value == null) return []
  return (Array.isArray(value) ? value : [value]) as Json[]
}

function toNumber(value: unknown): number {
  const n = Number(value)
  return Number.isFinite(n) ? n : 0
}

function toText(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

function toState(value: unknown): TcpState {
  if (value === 'Listen') return 'Listen'
  if (value === 'Established') return 'Established'
  return 'Other'
}

export function parseWindowsSample(raw: string): RawSample {
  const text = raw.replace(/^\uFEFF/, '').trim()
  if (!text) throw new Error('empty output')
  let data: Json
  try {
    data = JSON.parse(text) as Json
  } catch {
    throw new Error(`invalid JSON: ${text.slice(0, 120)}`)
  }

  const processes: ProcessInfo[] = toArray(data?.processes).map((p) => ({
    pid: toNumber(p.ProcessId),
    ppid: toNumber(p.ParentProcessId),
    name: toText(p.Name),
    commandLine: toText(p.CommandLine),
    memoryBytes: toNumber(p.WorkingSetSize),
    startedAt: typeof p.StartedAt === 'number' && Number.isFinite(p.StartedAt) ? p.StartedAt : null
  }))

  const tcp: TcpEntry[] = toArray(data?.tcp).map((t) => ({
    pid: toNumber(t.OwningProcess),
    localAddress: toText(t.LocalAddress),
    localPort: toNumber(t.LocalPort),
    remoteAddress: toText(t.RemoteAddress),
    remotePort: toNumber(t.RemotePort),
    state: toState(t.State)
  }))

  return { processes, tcp }
}

export async function sampleWindows(): Promise<RawSample> {
  const { stdout, exitCode } = await runCommand([powershellPath(), ...buildPowerShellArgs(WINDOWS_SAMPLE_SCRIPT)], {
    timeoutMs: COMMAND_TIMEOUT_MS
  })
  if (exitCode !== 0 && !stdout.trim()) throw new Error(`powershell exited with ${exitCode}`)
  return parseWindowsSample(stdout)
}
