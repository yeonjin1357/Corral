import { spawn } from 'child_process'
import { parseWindowsSample, WINDOWS_SAMPLE_SCRIPT, buildPowerShellArgs, powershellPath, sampleWindows } from './windows'

const vite =
  '"C:\\Program Files\\nodejs\\node.exe" C:\\Users\\김개발\\work\\shop-web\\node_modules\\.bin/../vite/bin/vite.js --port 3000'
const json = JSON.stringify({
  processes: [
    {
      ProcessId: 4100,
      ParentProcessId: 4000,
      Name: 'node.exe',
      CommandLine: vite,
      WorkingSetSize: 1048576000,
      StartedAt: 1793945439824
    },
    { ProcessId: 8, ParentProcessId: 0, Name: 'System', CommandLine: null, WorkingSetSize: 8192, StartedAt: null }
  ],
  tcp: [
    { OwningProcess: 4100, LocalAddress: '0.0.0.0', LocalPort: 3000, RemoteAddress: '0.0.0.0', RemotePort: 0, State: 'Listen' },
    { OwningProcess: 4100, LocalAddress: '::1', LocalPort: 3000, RemoteAddress: '::1', RemotePort: 51234, State: 'Established' },
    { OwningProcess: 0, LocalAddress: '::1', LocalPort: 3000, RemoteAddress: '::1', RemotePort: 51000, State: 'TimeWait' }
  ]
})

test('픽스처의 경로는 역슬래시가 살아 있는 실제 Windows 경로다', () => {
  expect(vite).toContain('C:\\Users\\김개발\\work\\shop-web\\node_modules')
  expect(vite).not.toContain('\n')
})

test('프로세스·TCP 파싱, 한글 경로 보존, null 명령줄은 빈 문자열', () => {
  const s = parseWindowsSample(json)
  expect(s.processes[0]).toEqual({
    pid: 4100,
    ppid: 4000,
    name: 'node.exe',
    commandLine: vite,
    memoryBytes: 1048576000,
    startedAt: 1793945439824
  })
  expect(s.processes[1].commandLine).toBe('')
  expect(s.processes[1].startedAt).toBeNull()
  expect(s.tcp.map((t) => t.state)).toEqual(['Listen', 'Established', 'Other'])
  expect(s.tcp[1]).toEqual({
    pid: 4100,
    localAddress: '::1',
    localPort: 3000,
    remoteAddress: '::1',
    remotePort: 51234,
    state: 'Established'
  })
})

test('ConvertTo-Json 이 단일 객체를 내도 배열로 처리', () => {
  const one = JSON.stringify({
    processes: { ProcessId: 1, ParentProcessId: 0, Name: 'a', CommandLine: 'a', WorkingSetSize: 1 },
    tcp: null
  })
  const s = parseWindowsSample(one)
  expect(s.processes).toHaveLength(1)
  expect(s.tcp).toEqual([])
})

test('UTF-8 BOM 과 앞뒤 공백·줄바꿈이 있어도 파싱', () => {
  expect(parseWindowsSample('\uFEFF  ' + json + '\r\n').processes).toHaveLength(2)
})

test('이름·메모리가 null 인 프로세스는 빈 문자열·0 으로', () => {
  const s = parseWindowsSample(
    JSON.stringify({
      processes: [{ ProcessId: 9, ParentProcessId: 0, Name: null, CommandLine: null, WorkingSetSize: null }],
      tcp: []
    })
  )
  expect(s.processes[0]).toEqual({ pid: 9, ppid: 0, name: '', commandLine: '', memoryBytes: 0, startedAt: null })
})

test('스크립트는 프로세스 시작 시각을 유닉스 ms 로 낸다(부모 pid 재사용 판별용)', () => {
  expect(WINDOWS_SAMPLE_SCRIPT).toContain('ToUnixTimeMilliseconds()')
})

test('빈 출력이나 JSON 이 아닌 출력은 이유가 담긴 에러', () => {
  expect(() => parseWindowsSample('')).toThrow('empty output')
  expect(() => parseWindowsSample('Get-CimInstance : Access denied')).toThrow('invalid JSON')
})

test('스크립트는 UTF-8 출력을 강제하고 enum 을 문자열로 낸다', () => {
  expect(WINDOWS_SAMPLE_SCRIPT).toContain('[Console]::OutputEncoding = [System.Text.Encoding]::UTF8')
  expect(WINDOWS_SAMPLE_SCRIPT).toContain('Get-NetTCPConnection')
  expect(WINDOWS_SAMPLE_SCRIPT).toContain('.State.ToString()')
  expect(WINDOWS_SAMPLE_SCRIPT).toContain("$ProgressPreference = 'SilentlyContinue'")
})

test('스크립트는 따옴표 문제 없이 -EncodedCommand(UTF-16LE base64)로 넘긴다', () => {
  const args = buildPowerShellArgs('Write-Output "한글 $x"')
  expect(args.slice(0, 4)).toEqual(['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass'])
  expect(args[4]).toBe('-EncodedCommand')
  expect(Buffer.from(args[5], 'base64').toString('utf16le')).toBe('Write-Output "한글 $x"')
})

test('powershell.exe 는 SystemRoot 기준 전체 경로로 실행(PATH 에 의존하지 않음)', () => {
  expect(powershellPath({ SystemRoot: 'D:\\Win' })).toBe('D:\\Win\\System32\\WindowsPowerShell\\v1.0\\powershell.exe')
  expect(powershellPath({})).toBe('C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe')
})

describe.runIf(process.platform === 'win32')('실제 Windows 에서', () => {
  test('샘플에 자기 자신과 한글 인자를 가진 자식 프로세스가 그대로 보인다', async () => {
    const child = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 20000)', 'C:\\Users\\김개발\\work'], {
      windowsHide: true
    })
    try {
      await new Promise((r) => setTimeout(r, 300))
      const s = await sampleWindows()
      expect(s.processes.find((p) => p.pid === process.pid)?.commandLine).toContain('vitest')
      const childInfo = s.processes.find((p) => p.pid === child.pid)
      expect(childInfo?.commandLine).toContain('C:\\Users\\김개발\\work')
      expect(childInfo?.startedAt).toBeGreaterThan(Date.now() - 60000)
      expect(childInfo?.startedAt).toBeLessThanOrEqual(Date.now())
      expect(s.tcp.length).toBeGreaterThan(0)
    } finally {
      child.kill()
    }
  }, 30000)
})
