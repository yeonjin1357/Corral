import { createHash, randomBytes } from 'crypto'
import { readFile, rm } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import type { CollectMode, ProcessInfo, RawSample, TcpEntry, TcpState } from '../../shared/types'
import { COMMAND_TIMEOUT_MS } from '../../shared/defaults'
import { runCommand, type CommandOptions, type CommandResult } from './runCommand'

/**
 * 프로세스 목록과 TCP 연결을 PowerShell 한 번으로 JSON 으로 받는다.
 * - netstat 은 OS 언어에 따라 제목줄이 바뀌므로 쓰지 않는다. TCP 상태는 이름(언어 무관)으로 낸다.
 * - 한글 등 비 ASCII 경로가 깨지지 않도록 결과를 UTF-8 바이트로 직접 쓴다.
 */
/**
 * PowerShell 안에서 컴파일해 쓰는 C# 보조 코드(PowerShell 5.1 = C# 5 문법만).
 * - PitwallTcp: netstat -ano 와 같은 OS API(GetExtendedTcpTable)로 TCP 목록을 읽는다.
 *   Get-NetTCPConnection 은 이 PC 에서 약 2초 걸려 수집 시간의 절반을 차지했다. 상태는 숫자라 OS 언어와 무관하다.
 * - PitwallCwd: 다른 프로세스의 작업 폴더. Windows 에는 이를 알려주는 기본 명령이 없어
 *   프로세스 메모리의 PEB → ProcessParameters → CurrentDirectory 를 읽는다(같은 사용자 프로세스만, 64비트만).
 *   오프셋: PEB.ProcessParameters = 0x20, RTL_USER_PROCESS_PARAMETERS.CurrentDirectory.DosPath = 0x38.
 */
const NATIVE_HELPERS = `using System;
using System.Collections.Generic;
using System.Net;
using System.Runtime.InteropServices;
public class PitwallTcpRow {
  public int OwningProcess { get; set; }
  public string LocalAddress { get; set; }
  public int LocalPort { get; set; }
  public string RemoteAddress { get; set; }
  public int RemotePort { get; set; }
  public string State { get; set; }
}
public static class PitwallTcp {
  [DllImport("iphlpapi.dll")] static extern uint GetExtendedTcpTable(IntPtr table, ref int size, bool order, int af, int tableClass, uint reserved);
  static int Port(int raw) { return ((raw & 0xFF) << 8) | ((raw >> 8) & 0xFF); }
  static string State(int s) { return s == 2 ? "Listen" : s == 5 ? "Established" : s == 11 ? "TimeWait" : "Other"; }
  static byte[] Bytes(IntPtr p, int n) { var b = new byte[n]; Marshal.Copy(p, b, 0, n); return b; }
  const uint ERROR_INSUFFICIENT_BUFFER = 122;
  static bool Add(int af, List<PitwallTcpRow> rows) {
    // 크기를 잰 뒤 읽기 전 사이에 연결이 늘면 122 가 온다. 다시 재서 읽는다(여유 4KB).
    for (int attempt = 0; attempt < 5; attempt++) {
    int size = 0;
    GetExtendedTcpTable(IntPtr.Zero, ref size, false, af, 5, 0);
    if (size <= 0) return false;
    size += 4096;
    IntPtr buf = Marshal.AllocHGlobal(size);
    try {
      uint rc = GetExtendedTcpTable(buf, ref size, false, af, 5, 0);
      if (rc == ERROR_INSUFFICIENT_BUFFER) continue;
      if (rc != 0) return false;
      int n = Marshal.ReadInt32(buf);
      var found = new List<PitwallTcpRow>();
      for (int i = 0; i < n; i++) {
        var row = new PitwallTcpRow();
        if (af == 2) {
          IntPtr r = IntPtr.Add(buf, 4 + i * 24);
          row.State = State(Marshal.ReadInt32(r, 0));
          row.LocalAddress = new IPAddress(Bytes(IntPtr.Add(r, 4), 4)).ToString();
          row.LocalPort = Port(Marshal.ReadInt32(r, 8));
          row.RemoteAddress = new IPAddress(Bytes(IntPtr.Add(r, 12), 4)).ToString();
          row.RemotePort = Port(Marshal.ReadInt32(r, 16));
          row.OwningProcess = Marshal.ReadInt32(r, 20);
        } else {
          IntPtr r = IntPtr.Add(buf, 4 + i * 56);
          row.LocalAddress = new IPAddress(Bytes(r, 16)).ToString();
          row.LocalPort = Port(Marshal.ReadInt32(r, 20));
          row.RemoteAddress = new IPAddress(Bytes(IntPtr.Add(r, 24), 16)).ToString();
          row.RemotePort = Port(Marshal.ReadInt32(r, 44));
          row.State = State(Marshal.ReadInt32(r, 48));
          row.OwningProcess = Marshal.ReadInt32(r, 52);
        }
        found.Add(row);
      }
      rows.AddRange(found);
      return true;
    } finally { Marshal.FreeHGlobal(buf); }
    }
    return false;
  }
  public static PitwallTcpRow[] Read() {
    var rows = new List<PitwallTcpRow>();
    bool v4 = Add(2, rows);
    bool v6 = Add(23, rows);
    // 둘 다 못 읽었으면 빈 목록을 정상처럼 내지 않고 실패로 알려 Get-NetTCPConnection 경로로 넘긴다.
    if (!v4 && !v6) throw new InvalidOperationException("GetExtendedTcpTable failed");
    return rows.ToArray();
  }
}
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
}
public class PitwallMemRow {
  public int Pid { get; set; }
  public long PrivateWs { get; set; }
}
public static class PitwallMem {
  [DllImport("kernel32.dll")] static extern IntPtr OpenProcess(int access, bool inherit, int pid);
  [DllImport("kernel32.dll")] static extern bool CloseHandle(IntPtr h);
  [DllImport("psapi.dll")] static extern bool GetProcessMemoryInfo(IntPtr h, IntPtr counters, int cb);
  // PROCESS_MEMORY_COUNTERS_EX2(Windows 10 1809+): 96 바이트, PrivateWorkingSetSize 는 80 번째 바이트부터.
  // 작업 관리자 "메모리" 열과 같은 값이라, 여러 프로세스가 같이 쓰는 메모리가 합계에 겹치지 않는다.
  public static PitwallMemRow[] Read() {
    var rows = new List<PitwallMemRow>();
    IntPtr buf = Marshal.AllocHGlobal(96);
    try {
      foreach (var proc in System.Diagnostics.Process.GetProcesses()) {
        int pid = proc.Id;
        proc.Dispose();
        IntPtr h = OpenProcess(0x1000 | 0x0010, false, pid);
        if (h == IntPtr.Zero) h = OpenProcess(0x1000, false, pid);
        if (h == IntPtr.Zero) continue;
        try {
          Marshal.WriteInt32(buf, 0, 96);
          if (GetProcessMemoryInfo(h, buf, 96)) rows.Add(new PitwallMemRow { Pid = pid, PrivateWs = Marshal.ReadInt64(buf, 80) });
        } finally { CloseHandle(h); }
      }
    } finally { Marshal.FreeHGlobal(buf); }
    return rows.ToArray();
  }
}`

/** 보조 코드가 바뀌면 이름도 바뀌어 새로 컴파일된다. */
export function nativeHelperDllName(): string {
  return `pitwall-native-${createHash('sha256').update(NATIVE_HELPERS).digest('hex').slice(0, 12)}.dll`
}

/**
 * 보조 코드를 불러오는 줄들. DLL 경로가 있으면 처음 한 번만 컴파일해 두고 다음부터는 불러오기만 한다
 * (매번 컴파일하면 csc.exe 가 뜬다). DLL 이 깨졌거나 쓸 수 없으면 지우고 메모리에서 컴파일한다.
 */
function helperLoadLines(dllPath: string | null): string[] {
  // $helperMode: 불러오기에 성공한 방법을 남긴다(없으면 'none'). Node 는 이것을 보고 DLL 재시도를 그만둔다.
  const inMemory = ['Add-Type -ErrorAction Stop -TypeDefinition $src', "$helperMode = 'memory'"]
  if (!dllPath) return inMemory
  return [
    `$dll = '${dllPath.replace(/'/g, "''")}'`,
    'try {',
    '  if (-not (Test-Path -LiteralPath $dll)) { Add-Type -ErrorAction Stop -OutputType Library -OutputAssembly $dll -TypeDefinition $src }',
    '  Add-Type -Path $dll -ErrorAction Stop',
    "  $helperMode = 'dll'",
    '} catch {',
    '  Remove-Item -LiteralPath $dll -Force -ErrorAction SilentlyContinue',
    ...inMemory.map((line) => `  ${line}`),
    '}'
  ]
}

export function windowsSampleScript(helperDllPath: string | null): string {
  return [
    "$ProgressPreference = 'SilentlyContinue'",
    "$p = @(Get-CimInstance Win32_Process | Select-Object ProcessId, ParentProcessId, Name, CommandLine, WorkingSetSize, @{ Name = 'CpuMs'; Expression = { [math]::Round(($_.KernelModeTime + $_.UserModeTime) / 10000) } }, @{ Name = 'StartedAt'; Expression = { if ($_.CreationDate) { [DateTimeOffset]::new($_.CreationDate).ToUnixTimeMilliseconds() } else { $null } } })",
    '$t = $null',
    '$cwds = @{}',
    "$helperMode = 'none'",
    "$src = @'",
    NATIVE_HELPERS,
    "'@",
    // 보조 코드는 회사 정책 등으로 Add-Type 이 막힐 수 있다. 그래도 아래 대체 경로로 샘플은 그대로 낸다.
    'try {',
    ...helperLoadLines(helperDllPath),
    '$t = @([PitwallTcp]::Read())',
    '} catch {}',
    "if ($t -eq $null) { $t = @(Get-NetTCPConnection -State Listen,Established,TimeWait -ErrorAction SilentlyContinue | Select-Object OwningProcess, LocalAddress, LocalPort, RemoteAddress, RemotePort, @{ Name = 'State'; Expression = { $_.State.ToString() } }) }",
    // 모든 프로세스의 작업 폴더를 읽는다(이 PC 에서 560여 개에 약 35ms). 포트를 연 서버·에이전트뿐 아니라
    // 상대 경로로 실행한 타입 검사·빌드·남은 프로세스의 워크트리, 지우기 직전 그 워크트리를 쓰는 프로세스를 알아낸다.
    // 다른 사용자·보호된 프로세스는 열 수 없어 건너뛴다.
    "if ('PitwallCwd' -as [type]) {",
    'foreach ($id in @($p | ForEach-Object { $_.ProcessId })) { if ($id -le 4) { continue }; try { $d = [PitwallCwd]::Get([int]$id); if ($d) { $cwds["$id"] = $d } } catch {} }',
    '}',
    '$privateWs = @{}',
    'if (\'PitwallMem\' -as [type]) { try { foreach ($m in [PitwallMem]::Read()) { $privateWs["$($m.Pid)"] = $m.PrivateWs } } catch {} }',
    '$json = @{ processes = $p; tcp = $t; cwds = $cwds; privateWs = $privateWs; helperMode = $helperMode } | ConvertTo-Json -Compress -Depth 3',
    // PowerShell 호스트 출력(Write-Output)으로 600KB 가 넘는 한 줄을 내면 2초 가까이 걸린다.
    // UTF-8 바이트를 표준 출력 스트림에 직접 써서 그 시간을 없애고, 콘솔 인코딩(한글 경로)에도 의존하지 않는다.
    '$bytes = (New-Object System.Text.UTF8Encoding($false)).GetBytes($json)',
    '$out = [Console]::OpenStandardOutput()',
    '$out.Write($bytes, 0, $bytes.Length)',
    '$out.Flush()'
  ].join('\n')
}

export const WINDOWS_SAMPLE_SCRIPT = windowsSampleScript(null)

let configuredHelperDllPath: string | null = null

/** 앱 시작 시 보조 코드 DLL 을 둘 경로(앱 데이터 폴더)를 정한다. */
export function configureWindowsSampler(options: { helperDllPath: string | null }): void {
  configuredHelperDllPath = options.helperDllPath
}

/** PATH 에 의존하지 않도록 Windows PowerShell 5.1 의 전체 경로를 쓴다(모든 Windows 10/11 에 있음). */
export function powershellPath(env: Record<string, string | undefined> = process.env): string {
  const root = env.SystemRoot ?? 'C:\\Windows'
  return `${root}\\System32\\WindowsPowerShell\\v1.0\\powershell.exe`
}

/**
 * 따옴표·`$`·줄바꿈이 인자 전달 중에 깨지지 않도록 스크립트를 UTF-16LE base64 로 넘긴다.
 * 실행 정책은 -EncodedCommand 에 적용되지 않아 -ExecutionPolicy Bypass 는 쓰지 않는다(효과는 없고 보안 프로그램 의심만 산다).
 */
export function buildPowerShellArgs(script: string): string[] {
  return [
    '-NoProfile',
    '-NonInteractive',
    '-EncodedCommand',
    Buffer.from(script, 'utf16le').toString('base64')
  ]
}

/**
 * 보안 정책(ConstrainedLanguage·AppLocker 등)으로 기본 스크립트가 막힌 PC 용.
 * 제한 모드에서도 허용되는 cmdlet 만 쓰고, 콘솔 인코딩에 기대지 않도록 결과를 UTF-8 파일로 쓴다.
 * 작업 폴더(cwd)는 읽지 못해 명령줄에 절대 경로가 없는 서버는 판별되지 않는다.
 */
export function windowsSafeScript(outFile: string): string {
  return [
    "$ProgressPreference = 'SilentlyContinue'",
    "$p = @(Get-CimInstance Win32_Process | Select-Object ProcessId, ParentProcessId, Name, CommandLine, WorkingSetSize, CreationDate, @{ Name = 'CpuMs'; Expression = { [math]::Round(($_.KernelModeTime + $_.UserModeTime) / 10000) } })",
    '$t = @()',
    'try { $t = @(Get-NetTCPConnection -State Listen,Established,TimeWait -ErrorAction SilentlyContinue | Select-Object OwningProcess, LocalAddress, LocalPort, RemoteAddress, RemotePort, @{ Name = \'State\'; Expression = { "$($_.State)" } }) } catch {}',
    // 제한 모드에서는 NetTCPIP 모듈을 못 불러올 수 있다. 그때는 netstat 출력을 그대로 넘겨 Node 에서 해석한다.
    '$ns = @()',
    'if ($t.Count -eq 0) { $ns = @(netstat -ano) }',
    `@{ processes = $p; tcp = $t; cwds = @{}; netstat = $ns } | ConvertTo-Json -Compress -Depth 3 | Out-File -LiteralPath '${outFile.replace(/'/g, "''")}' -Encoding utf8`
  ].join('\n')
}

function parseNetstatAddress(text: string): { host: string; port: number } | null {
  const bracketed = /^\[(.+)\]:(\d+)$/.exec(text)
  if (bracketed) return { host: bracketed[1], port: Number(bracketed[2]) }
  const plain = /^([^:[\]]+):(\d+)$/.exec(text)
  if (plain) return { host: plain[1], port: Number(plain[2]) }
  return null
}

/**
 * `netstat -ano` 의 TCP 줄. 제목줄은 OS 언어로 나오므로 'TCP' 로 시작하는 줄만 본다.
 * 상태 이름이 영어가 아닌 OS 도 있어, 모르는 상태라도 상대 포트가 0 이면 LISTEN 으로 본다.
 */
export function parseNetstatLines(lines: string[]): TcpEntry[] {
  const result: TcpEntry[] = []
  for (const line of lines) {
    const parts = line.trim().split(/\s+/)
    if (parts[0] !== 'TCP' || parts.length < 5) continue
    const local = parseNetstatAddress(parts[1])
    const remote = parseNetstatAddress(parts[2])
    const pid = Number(parts[parts.length - 1])
    if (!local || !remote || !Number.isInteger(pid)) continue
    const stateText = parts[3]
    const state: TcpState =
      stateText === 'LISTENING' ||
      (stateText !== 'ESTABLISHED' && stateText !== 'TIME_WAIT' && remote.port === 0)
        ? 'Listen'
        : stateText === 'ESTABLISHED'
          ? 'Established'
          : 'Other'
    result.push({
      pid,
      localAddress: local.host,
      localPort: local.port,
      remoteAddress: remote.host,
      remotePort: remote.port,
      state
    })
  }
  return result
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

/** PowerShell 5.1 ConvertTo-Json 의 날짜: "/Date(ms)/" 문자열, 또는 { value: "/Date(ms)/", DisplayHint } 객체. */
function parseCimDate(value: unknown): number | null {
  if (typeof value === 'string') {
    const m = /\/Date\((-?\d+)\)\//.exec(value)
    return m ? Number(m[1]) : null
  }
  if (value && typeof value === 'object' && 'value' in value)
    return parseCimDate((value as { value: unknown }).value)
  return null
}

/** 기본 스크립트는 helperMode 를 내고, 제한 모드 대체 스크립트는 내지 않는다. */
function collectModeOf(helperMode: unknown): CollectMode {
  if (helperMode === 'dll') return 'helper-dll'
  if (helperMode === 'memory') return 'helper-memory'
  if (helperMode === 'none') return 'basic'
  return 'safe'
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

  // 전용 작업 세트(작업 관리자 "메모리" 열)가 있으면 그것을, 없으면(보조 코드 없음·오래된 Windows) 작업 세트를 쓴다.
  const privateWs =
    data?.privateWs && typeof data.privateWs === 'object' && !Array.isArray(data.privateWs)
      ? (data.privateWs as Record<string, unknown>)
      : {}
  const memoryOf = (p: Json): number => {
    const own = privateWs[String(toNumber(p.ProcessId))]
    return typeof own === 'number' && Number.isFinite(own) && own >= 0
      ? own
      : toNumber(p.WorkingSetSize)
  }

  const processes: ProcessInfo[] = toArray(data?.processes).map((p) => ({
    pid: toNumber(p.ProcessId),
    ppid: toNumber(p.ParentProcessId),
    name: toText(p.Name),
    commandLine: toText(p.CommandLine),
    memoryBytes: memoryOf(p),
    cpuMs: typeof p.CpuMs === 'number' && Number.isFinite(p.CpuMs) ? p.CpuMs : null,
    startedAt:
      typeof p.StartedAt === 'number' && Number.isFinite(p.StartedAt)
        ? p.StartedAt
        : parseCimDate(p.CreationDate)
  }))

  let tcp: TcpEntry[] = toArray(data?.tcp).map((t) => ({
    pid: toNumber(t.OwningProcess),
    localAddress: toText(t.LocalAddress),
    localPort: toNumber(t.LocalPort),
    remoteAddress: toText(t.RemoteAddress),
    remotePort: toNumber(t.RemotePort),
    state: toState(t.State)
  }))
  if (tcp.length === 0 && Array.isArray(data?.netstat)) {
    tcp = parseNetstatLines(
      (data.netstat as unknown[]).filter((l): l is string => typeof l === 'string')
    )
  }

  const cwds: Record<number, string> = {}
  const rawCwds = data?.cwds
  if (rawCwds && typeof rawCwds === 'object' && !Array.isArray(rawCwds)) {
    for (const [key, value] of Object.entries(rawCwds as Record<string, unknown>)) {
      const pid = Number(key)
      if (Number.isInteger(pid) && typeof value === 'string' && value) cwds[pid] = value
    }
  }

  return { processes, tcp, cwds, collectMode: collectModeOf(data?.helperMode) }
}

type Runner = (argv: string[], opts?: CommandOptions) => Promise<CommandResult>

/** 'full' = 기본 스크립트(보조 C# 포함), 'safe' = 제한 모드용 대체 스크립트. */
let mode: 'full' | 'safe' = 'full'
let safeSamplesSinceSwitch = 0
/** 대체 스크립트로 바뀐 뒤에도 이만큼에 한 번은 기본 스크립트를 다시 시도한다(일시적 실패였을 수 있으므로). */
export const FULL_RETRY_EVERY = 20

export function resetWindowsSamplerMode(): void {
  mode = 'full'
  safeSamplesSinceSwitch = 0
}

function failureMessage(result: CommandResult): string {
  const reason = result.stderr.replace(/\s+/g, ' ').trim().slice(0, 200)
  return `Windows 정보를 가져오지 못했어요 (PowerShell 종료 코드 ${result.exitCode})${reason ? `: ${reason}` : ''}`
}

async function sampleSafe(run: Runner, prefix: string): Promise<RawSample> {
  const outFile = join(
    tmpdir(),
    `pitwall-sample-${process.pid}-${Date.now()}-${randomBytes(4).toString('hex')}.json`
  )
  try {
    const result = await run(
      [powershellPath(), ...buildPowerShellArgs(prefix + windowsSafeScript(outFile))],
      {
        timeoutMs: COMMAND_TIMEOUT_MS
      }
    )
    const text = await readFile(outFile, 'utf8').catch(() => '')
    try {
      return parseWindowsSample(text)
    } catch {
      throw new Error(failureMessage(result))
    }
  } finally {
    await rm(outFile, { force: true }).catch(() => {})
  }
}

export async function sampleWindows(
  options: {
    helperDllPath?: string | null
    run?: Runner
    /** 테스트 전용: 이 언어 모드(예: ConstrainedLanguage)로 바꾼 뒤 스크립트를 실행한다. */
    languageModeForTest?: string
  } = {}
): Promise<RawSample> {
  const run = options.run ?? runCommand
  const prefix = options.languageModeForTest
    ? `$ExecutionContext.SessionState.LanguageMode = '${options.languageModeForTest}'\n`
    : ''

  const tryFull = mode === 'full' || safeSamplesSinceSwitch >= FULL_RETRY_EVERY
  if (tryFull) {
    const dllPath = options.helperDllPath ?? configuredHelperDllPath
    const script = prefix + windowsSampleScript(dllPath)
    // 시간 초과는 일시적일 수 있어 모드를 바꾸지 않고 그대로 실패로 알린다.
    const result = await run([powershellPath(), ...buildPowerShellArgs(script)], {
      timeoutMs: COMMAND_TIMEOUT_MS
    })
    if (result.exitCode === 0 || result.stdout.trim()) {
      try {
        const sample = parseWindowsSample(result.stdout)
        resetWindowsSamplerMode()
        // DLL 을 주었는데 메모리 컴파일로 넘어갔다면 DLL 이 막힌 PC(보안 정책 등)다.
        // 매번 DLL 을 만들었다 지우며 두 번 컴파일하지 않도록 이 세션에서는 DLL 을 더 시도하지 않는다.
        if (dllPath && !options.helperDllPath && sample.collectMode === 'helper-memory') {
          configuredHelperDllPath = null
        }
        return sample
      } catch {
        // 아래 대체 스크립트로 넘어간다.
      }
    }
  }

  const sample = await sampleSafe(run, prefix)
  safeSamplesSinceSwitch = mode === 'safe' && !tryFull ? safeSamplesSinceSwitch + 1 : 1
  mode = 'safe'
  return sample
}
