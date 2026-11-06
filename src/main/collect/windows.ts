import type { ProcessInfo, RawSample, TcpEntry, TcpState } from '../../shared/types'
import { COMMAND_TIMEOUT_MS } from '../../shared/defaults'
import { runCommand } from './runCommand'

/**
 * 프로세스 목록과 TCP 연결을 PowerShell 한 번으로 JSON 으로 받는다.
 * - netstat 은 OS 언어에 따라 제목줄이 바뀌므로 쓰지 않는다. TCP 상태는 enum 이름(언어 무관)으로 낸다.
 * - 한글 등 비 ASCII 경로가 깨지지 않도록 출력 인코딩을 UTF-8 로 고정한다.
 */
/**
 * 다른 프로세스의 작업 폴더를 읽는 C# 코드. Windows 에는 이를 알려주는 기본 명령이 없어
 * 프로세스 메모리의 PEB → ProcessParameters → CurrentDirectory 를 읽는다(같은 사용자 프로세스만, 64비트만).
 * 오프셋: PEB.ProcessParameters = 0x20, RTL_USER_PROCESS_PARAMETERS.CurrentDirectory.DosPath = 0x38.
 */
const CWD_READER = `using System;
using System.Runtime.InteropServices;
public static class PitwallCwd {
  [DllImport("ntdll.dll")] static extern int NtQueryInformationProcess(IntPtr h, int cls, ref PBI info, int size, out int ret);
  [DllImport("kernel32.dll")] static extern IntPtr OpenProcess(int access, bool inherit, int pid);
  [DllImport("kernel32.dll")] static extern bool CloseHandle(IntPtr h);
  [DllImport("kernel32.dll")] static extern bool ReadProcessMemory(IntPtr h, IntPtr addr, byte[] buf, IntPtr size, out IntPtr read);
  [DllImport("kernel32.dll")] static extern bool IsWow64Process(IntPtr h, out bool wow);
  [StructLayout(LayoutKind.Sequential)] struct PBI { public IntPtr R1; public IntPtr Peb; public IntPtr R2a; public IntPtr R2b; public IntPtr Pid; public IntPtr R3; }
  static byte[] Read(IntPtr h, long addr, int n) { var b = new byte[n]; IntPtr r; return ReadProcessMemory(h, new IntPtr(addr), b, new IntPtr(n), out r) && r.ToInt64() == n ? b : null; }
  public static string Get(int pid) {
    if (IntPtr.Size != 8) return null;
    IntPtr h = OpenProcess(0x0400 | 0x0010, false, pid);
    if (h == IntPtr.Zero) return null;
    try {
      bool wow; if (IsWow64Process(h, out wow) && wow) return null;
      var pbi = new PBI(); int ret;
      if (NtQueryInformationProcess(h, 0, ref pbi, Marshal.SizeOf(pbi), out ret) != 0) return null;
      var p = Read(h, pbi.Peb.ToInt64() + 0x20, 8); if (p == null) return null;
      var us = Read(h, BitConverter.ToInt64(p, 0) + 0x38, 16); if (us == null) return null;
      int len = BitConverter.ToUInt16(us, 0);
      if (len <= 0 || len > 4096) return null;
      var s = Read(h, BitConverter.ToInt64(us, 8), len); if (s == null) return null;
      return System.Text.Encoding.Unicode.GetString(s);
    } catch { return null; } finally { CloseHandle(h); }
  }
}`

export const WINDOWS_SAMPLE_SCRIPT = [
  "$ProgressPreference = 'SilentlyContinue'",
  '[Console]::OutputEncoding = [System.Text.Encoding]::UTF8',
  "$p = @(Get-CimInstance Win32_Process | Select-Object ProcessId, ParentProcessId, Name, CommandLine, WorkingSetSize, @{ Name = 'StartedAt'; Expression = { if ($_.CreationDate) { [DateTimeOffset]::new($_.CreationDate).ToUnixTimeMilliseconds() } else { $null } } })",
  "$t = @(Get-NetTCPConnection -State Listen,Established,TimeWait -ErrorAction SilentlyContinue | Select-Object OwningProcess, LocalAddress, LocalPort, RemoteAddress, RemotePort, @{ Name = 'State'; Expression = { $_.State.ToString() } })",
  '$cwds = @{}',
  // 작업 폴더 읽기는 보조 정보다. 회사 정책 등으로 Add-Type 이 막혀도 나머지 샘플은 그대로 낸다.
  'try {',
  "Add-Type -ErrorAction Stop -TypeDefinition @'",
  CWD_READER,
  "'@",
  "$listening = @($t | Where-Object { $_.State -eq 'Listen' -and $_.LocalPort -ge 1024 } | ForEach-Object { $_.OwningProcess } | Sort-Object -Unique)",
  'foreach ($id in $listening) { $d = [PitwallCwd]::Get([int]$id); if ($d) { $cwds["$id"] = $d } }',
  '} catch {}',
  '@{ processes = $p; tcp = $t; cwds = $cwds } | ConvertTo-Json -Compress -Depth 3'
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

  const cwds: Record<number, string> = {}
  const rawCwds = data?.cwds
  if (rawCwds && typeof rawCwds === 'object' && !Array.isArray(rawCwds)) {
    for (const [key, value] of Object.entries(rawCwds as Record<string, unknown>)) {
      const pid = Number(key)
      if (Number.isInteger(pid) && typeof value === 'string' && value) cwds[pid] = value
    }
  }

  return { processes, tcp, cwds }
}

export async function sampleWindows(): Promise<RawSample> {
  const { stdout, exitCode } = await runCommand([powershellPath(), ...buildPowerShellArgs(WINDOWS_SAMPLE_SCRIPT)], {
    timeoutMs: COMMAND_TIMEOUT_MS
  })
  if (exitCode !== 0 && !stdout.trim()) throw new Error(`powershell exited with ${exitCode}`)
  return parseWindowsSample(stdout)
}
