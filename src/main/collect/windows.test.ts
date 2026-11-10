import { spawn } from 'child_process'
import { mkdtemp, rm } from 'fs/promises'
import { tmpdir, totalmem } from 'os'
import { join } from 'path'
import { existsSync, writeFileSync } from 'fs'
import { runCommand, type CommandResult } from './runCommand'
import { buildTree, classifyAgent } from '../processTree'
import { hostFinder } from '../agents'
import { createFocuser, focusScript } from '../focusWindow'
import { blankSnapshot } from '../../shared/snapshot'
import { selectionKey } from '../../shared/keys'
import type { AgentRow } from '../../shared/types'
import {
  parseWindowsSample,
  WINDOWS_SAMPLE_SCRIPT,
  windowsSampleScript,
  windowsSafeScript,
  resetWindowsSamplerMode,
  parseNetstatLines,
  nativeHelperDllName,
  buildPowerShellArgs,
  powershellPath,
  sampleWindows,
  configureWindowsSampler
} from './windows'

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
    {
      ProcessId: 8,
      ParentProcessId: 0,
      Name: 'System',
      CommandLine: null,
      WorkingSetSize: 8192,
      StartedAt: null
    }
  ],
  tcp: [
    {
      OwningProcess: 4100,
      LocalAddress: '0.0.0.0',
      LocalPort: 3000,
      RemoteAddress: '0.0.0.0',
      RemotePort: 0,
      State: 'Listen'
    },
    {
      OwningProcess: 4100,
      LocalAddress: '::1',
      LocalPort: 3000,
      RemoteAddress: '::1',
      RemotePort: 51234,
      State: 'Established'
    },
    {
      OwningProcess: 0,
      LocalAddress: '::1',
      LocalPort: 3000,
      RemoteAddress: '::1',
      RemotePort: 51000,
      State: 'TimeWait'
    }
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
    startedAt: 1793945439824,
    cpuMs: null,
    commitBytes: null
  })
  expect(s.processes[1].commandLine).toBe('')
  expect(s.processes[1].startedAt).toBeNull()
  expect(s.tcp.map((t) => t.state)).toEqual(['Listen', 'Established', 'TimeWait'])
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
      processes: [
        { ProcessId: 9, ParentProcessId: 0, Name: null, CommandLine: null, WorkingSetSize: null }
      ],
      tcp: []
    })
  )
  expect(s.processes[0]).toEqual({
    pid: 9,
    ppid: 0,
    name: '',
    commandLine: '',
    memoryBytes: 0,
    startedAt: null,
    cpuMs: null,
    commitBytes: null
  })
})

test('누적 CPU 시간(CpuMs)을 읽고, 없으면 null', () => {
  const s = parseWindowsSample(
    JSON.stringify({
      processes: [
        {
          ProcessId: 1,
          ParentProcessId: 0,
          Name: 'a',
          CommandLine: 'a',
          WorkingSetSize: 1,
          CpuMs: 1530
        },
        { ProcessId: 2, ParentProcessId: 0, Name: 'b', CommandLine: 'b', WorkingSetSize: 1 }
      ],
      tcp: []
    })
  )
  expect(s.processes.map((p) => p.cpuMs)).toEqual([1530, null])
})

test('두 스크립트 모두 CPU 시간을 내고, 기본 스크립트는 모든 프로세스의 작업 폴더를 읽는다', () => {
  for (const script of [WINDOWS_SAMPLE_SCRIPT, windowsSafeScript('C:\\t\\o.json')]) {
    expect(script).toContain('KernelModeTime + $_.UserModeTime')
  }
  expect(WINDOWS_SAMPLE_SCRIPT).toContain(
    'foreach ($id in @($p | ForEach-Object { $_.ProcessId }))'
  )
})

test('스크립트는 프로세스 시작 시각을 유닉스 ms 로 낸다(부모 pid 재사용 판별용)', () => {
  expect(WINDOWS_SAMPLE_SCRIPT).toContain('ToUnixTimeMilliseconds()')
})

test('빈 출력이나 JSON 이 아닌 출력은 이유가 담긴 에러', () => {
  expect(() => parseWindowsSample('')).toThrow('empty output')
  expect(() => parseWindowsSample('Get-CimInstance : Access denied')).toThrow('invalid JSON')
})

test('스크립트는 JSON 을 UTF-8 바이트로 표준 출력에 직접 쓰고(콘솔 인코딩·호스트 출력 우회) enum 을 문자열로 낸다', () => {
  expect(WINDOWS_SAMPLE_SCRIPT).toContain('[Console]::OpenStandardOutput()')
  expect(WINDOWS_SAMPLE_SCRIPT).toContain('New-Object System.Text.UTF8Encoding($false)')
  expect(WINDOWS_SAMPLE_SCRIPT).toContain('Get-NetTCPConnection')
  expect(WINDOWS_SAMPLE_SCRIPT).toContain('.State.ToString()')
  expect(WINDOWS_SAMPLE_SCRIPT).toContain("$ProgressPreference = 'SilentlyContinue'")
})

test('스크립트는 따옴표 문제 없이 -EncodedCommand(UTF-16LE base64)로 넘기고, 효과 없는 -ExecutionPolicy Bypass 는 쓰지 않는다', () => {
  const args = buildPowerShellArgs('Write-Output "한글 $x"')
  expect(args.slice(0, 2)).toEqual(['-NoProfile', '-NonInteractive'])
  expect(args).not.toContain('-ExecutionPolicy')
  expect(args[2]).toBe('-EncodedCommand')
  expect(Buffer.from(args[3], 'base64').toString('utf16le')).toBe('Write-Output "한글 $x"')
})

test('TIME_WAIT 은 TimeWait 상태로 읽는다', () => {
  // 최근 닫힌 연결(사용 흔적). Windows 는 소유 pid 가 0 이라 로컬 포트로 서버와 맞춘다.
  expect(parseWindowsSample(json).tcp[2]).toMatchObject({
    pid: 0,
    localPort: 3000,
    state: 'TimeWait'
  })
  expect(
    parseNetstatLines(['  TCP    [::1]:3000             [::1]:51000            TIME_WAIT       0'])
  ).toEqual([
    {
      pid: 0,
      localAddress: '::1',
      localPort: 3000,
      remoteAddress: '::1',
      remotePort: 51000,
      state: 'TimeWait'
    }
  ])
})

describe('보안 정책으로 기본 스크립트가 막힌 PC(ConstrainedLanguage 등)', () => {
  const decode = (argv: string[]): string =>
    Buffer.from(argv[argv.length - 1], 'base64').toString('utf16le')

  test('대체 스크립트는 제한 모드에서 막히는 것(Add-Type·.NET 정적 호출·New-Object)을 쓰지 않고 결과를 UTF-8 파일로 쓴다', () => {
    const script = windowsSafeScript("C:\\Users\\김'개발\\AppData\\Local\\Temp\\pitwall-1.json")
    for (const blocked of ['Add-Type', '[Console]', '::new', 'New-Object', '.ToString()']) {
      expect(script).not.toContain(blocked)
    }
    expect(script).toContain(
      "Out-File -LiteralPath 'C:\\Users\\김''개발\\AppData\\Local\\Temp\\pitwall-1.json' -Encoding utf8"
    )
    expect(script).toContain('CreationDate')
  })

  test('대체 스크립트는 Get-NetTCPConnection 이 없거나 막히면 netstat -ano 출력을 함께 낸다', () => {
    const script = windowsSafeScript('C:\\t\\o.json')
    expect(script).toMatch(/try \{ \$t = @\(Get-NetTCPConnection[\s\S]*\} catch \{\}/)
    expect(script).toContain('if ($t.Count -eq 0) { $ns = @(netstat -ano) }')
    expect(script).toContain('netstat = $ns')
  })

  test('netstat 출력 해석: 한글 제목줄·UDP 무시, IPv6·스코프, 언어가 다른 상태는 상대 포트 0 이면 LISTEN', () => {
    const lines = [
      '',
      '활성 연결',
      '',
      '  프로토콜  로컬 주소              외부 주소              상태            PID',
      '  TCP    0.0.0.0:3000           0.0.0.0:0              LISTENING       4100',
      '  TCP    [::]:3000              [::]:0                 LISTENING       4100',
      '  TCP    [::1]:3000             [::1]:51234            ESTABLISHED     4100',
      '  TCP    [fe80::1%5]:5040       [::]:0                 LISTENING       6848',
      '  TCP    [::1]:3000             [::1]:51000            TIME_WAIT       0',
      '  TCP    0.0.0.0:8080           0.0.0.0:0              ABHÖREN         6000',
      '  UDP    0.0.0.0:5353           *:*                                    1234'
    ]
    expect(parseNetstatLines(lines)).toEqual([
      {
        pid: 4100,
        localAddress: '0.0.0.0',
        localPort: 3000,
        remoteAddress: '0.0.0.0',
        remotePort: 0,
        state: 'Listen'
      },
      {
        pid: 4100,
        localAddress: '::',
        localPort: 3000,
        remoteAddress: '::',
        remotePort: 0,
        state: 'Listen'
      },
      {
        pid: 4100,
        localAddress: '::1',
        localPort: 3000,
        remoteAddress: '::1',
        remotePort: 51234,
        state: 'Established'
      },
      {
        pid: 6848,
        localAddress: 'fe80::1%5',
        localPort: 5040,
        remoteAddress: '::',
        remotePort: 0,
        state: 'Listen'
      },
      {
        pid: 0,
        localAddress: '::1',
        localPort: 3000,
        remoteAddress: '::1',
        remotePort: 51000,
        state: 'TimeWait'
      },
      {
        pid: 6000,
        localAddress: '0.0.0.0',
        localPort: 8080,
        remoteAddress: '0.0.0.0',
        remotePort: 0,
        state: 'Listen'
      }
    ])
  })

  test('TCP 목록이 비어 있고 netstat 줄이 있으면 그것으로 채운다', () => {
    const s = parseWindowsSample(
      JSON.stringify({
        processes: [],
        tcp: [],
        netstat: ['  TCP    0.0.0.0:3000   0.0.0.0:0   LISTENING   4100']
      })
    )
    expect(s.tcp.map((t) => [t.localPort, t.state])).toEqual([[3000, 'Listen']])
  })

  test('CreationDate 의 /Date(ms)/ 문자열·객체 형식을 시작 시각으로 읽는다', () => {
    const s = parseWindowsSample(
      JSON.stringify({
        processes: [
          {
            ProcessId: 1,
            ParentProcessId: 0,
            Name: 'a',
            CommandLine: 'a',
            WorkingSetSize: 1,
            CreationDate: '/Date(1793945439824)/'
          },
          {
            ProcessId: 2,
            ParentProcessId: 0,
            Name: 'b',
            CommandLine: 'b',
            WorkingSetSize: 1,
            CreationDate: { value: '/Date(1793945439000)/', DisplayHint: 2 }
          },
          {
            ProcessId: 3,
            ParentProcessId: 0,
            Name: 'c',
            CommandLine: 'c',
            WorkingSetSize: 1,
            CreationDate: null
          }
        ],
        tcp: []
      })
    )
    expect(s.processes.map((p) => p.startedAt)).toEqual([1793945439824, 1793945439000, null])
  })

  test('기본 스크립트가 실패하면 대체 스크립트로 다시 수집하고, 그 뒤로는 바로 대체 스크립트를 쓴다', async () => {
    resetWindowsSamplerMode()
    const calls: string[] = []
    const run = vi.fn(async (argv: string[]) => {
      const script = decode(argv)
      if (script.includes('PitwallTcp')) {
        calls.push('full')
        return {
          stdout: '',
          stderr:
            'Cannot invoke method. Method invocation is supported only on core types in this language mode.',
          exitCode: 1
        }
      }
      calls.push('safe')
      const out = /Out-File -LiteralPath '(.+?)'/.exec(script)![1].replace(/''/g, "'")
      writeFileSync(out, '\uFEFF' + json, 'utf8')
      return { stdout: '', stderr: '', exitCode: 0 }
    })
    expect((await sampleWindows({ run })).processes).toHaveLength(2)
    expect((await sampleWindows({ run })).processes).toHaveLength(2)
    expect(calls).toEqual(['full', 'safe', 'safe'])
    resetWindowsSamplerMode()
  })

  test('대체 스크립트로 바뀐 뒤에도 20번에 한 번은 기본 스크립트를 다시 시도한다', async () => {
    resetWindowsSamplerMode()
    const calls: string[] = []
    const run = vi.fn(async (argv: string[]) => {
      const script = decode(argv)
      if (script.includes('PitwallTcp')) {
        calls.push('full')
        return { stdout: '', stderr: 'blocked', exitCode: 1 }
      }
      calls.push('safe')
      writeFileSync(/Out-File -LiteralPath '(.+?)'/.exec(script)![1], json, 'utf8')
      return { stdout: '', stderr: '', exitCode: 0 }
    })
    for (let i = 0; i < 21; i++) await sampleWindows({ run })
    expect(calls).toEqual(['full', 'safe', ...Array(19).fill('safe'), 'full', 'safe'])
    resetWindowsSamplerMode()
  })

  test('둘 다 실패하면 PowerShell 이 남긴 이유를 담은 한국어 에러', async () => {
    resetWindowsSamplerMode()
    const run = vi.fn(async () => ({ stdout: '', stderr: 'Access is denied.', exitCode: 1 }))
    await expect(sampleWindows({ run })).rejects.toThrow(
      'Windows 정보를 가져오지 못했어요 (PowerShell 종료 코드 1): Access is denied.'
    )
    resetWindowsSamplerMode()
  })

  test('시간 초과는 모드를 바꾸지 않고 그대로 실패로 알린다(일시적일 수 있으므로)', async () => {
    resetWindowsSamplerMode()
    const run = vi.fn(async () => {
      throw new Error('timeout')
    })
    await expect(sampleWindows({ run })).rejects.toThrow('timeout')
    expect(run).toHaveBeenCalledTimes(1)
    resetWindowsSamplerMode()
  })
})

test('포트를 연 프로세스의 작업 폴더(cwds)를 pid → 경로로 읽고, 없으면 빈 객체', () => {
  const withCwds = JSON.stringify({
    processes: [],
    tcp: [],
    cwds: { '4100': 'C:\\Users\\김개발\\work\\shop-web\\', '7': '' }
  })
  expect(parseWindowsSample(withCwds).cwds).toEqual({ 4100: 'C:\\Users\\김개발\\work\\shop-web\\' })
  expect(parseWindowsSample(json).cwds).toEqual({})
})

describe('수집 방식(collectMode)', () => {
  const sampleJson = (helperMode?: string): string =>
    JSON.stringify({ processes: [], tcp: [], ...(helperMode ? { helperMode } : {}) })

  test('보조 코드를 어떻게 불러왔는지 수집 방식으로 남긴다', () => {
    expect(parseWindowsSample(sampleJson('dll')).collectMode).toBe('helper-dll')
    expect(parseWindowsSample(sampleJson('memory')).collectMode).toBe('helper-memory')
    expect(parseWindowsSample(sampleJson('none')).collectMode).toBe('basic')
    expect(parseWindowsSample(sampleJson()).collectMode).toBe('safe')
  })

  test('스크립트는 helperMode 를 낸다(DLL 성공 dll, 메모리 컴파일 memory, 실패 none)', () => {
    const withDll = windowsSampleScript('C:\\x\\pitwall-native-1.dll')
    expect(withDll).toContain("$helperMode = 'none'")
    expect(withDll).toContain("$helperMode = 'dll'")
    expect(withDll).toContain("$helperMode = 'memory'")
    expect(withDll).toContain('helperMode = $helperMode')
  })

  test('DLL 로 못 불러와 메모리 컴파일로 넘어간 PC 는 그 세션 동안 DLL 을 다시 시도하지 않는다', async () => {
    resetWindowsSamplerMode()
    configureWindowsSampler({ helperDllPath: 'C:\\x\\pitwall-native-1.dll' })
    const scripts: string[] = []
    const run = vi.fn(async (argv: string[]) => {
      scripts.push(Buffer.from(argv[argv.length - 1], 'base64').toString('utf16le'))
      return { stdout: sampleJson('memory'), stderr: '', exitCode: 0 }
    })
    await sampleWindows({ run })
    await sampleWindows({ run })
    expect(scripts[0]).toContain('$dll =')
    expect(scripts[1]).not.toContain('$dll =')
    configureWindowsSampler({ helperDllPath: null })
    resetWindowsSamplerMode()
  })
})

test('메모리는 작업 관리자와 같은 전용 작업 세트(privateWs), 열 수 없는 프로세스는 0(시스템 몫으로), 보조 코드가 없으면 작업 세트', () => {
  const processes = [
    { ProcessId: 1, ParentProcessId: 0, Name: 'a', CommandLine: 'a', WorkingSetSize: 900 },
    { ProcessId: 2, ParentProcessId: 0, Name: 'b', CommandLine: 'b', WorkingSetSize: 800 }
  ]
  // 2 는 보안 프로그램·다른 사용자 프로세스처럼 열 수 없었다. 작업 세트(공유 메모리 포함)로 채우면 부풀려진다.
  const helper = parseWindowsSample(
    JSON.stringify({ processes, tcp: [], privateWs: { '1': 300, '9': 5 } })
  )
  expect(helper.processes.map((p) => p.memoryBytes)).toEqual([300, 0])
  const basic = parseWindowsSample(JSON.stringify({ processes, tcp: [], privateWs: {} }))
  expect(basic.processes.map((p) => p.memoryBytes)).toEqual([900, 800])
})

test('스크립트는 GetProcessMemoryInfo(PROCESS_MEMORY_COUNTERS_EX2)로 전용 작업 세트를 읽는다', () => {
  expect(WINDOWS_SAMPLE_SCRIPT).toContain('GetProcessMemoryInfo')
  expect(WINDOWS_SAMPLE_SCRIPT).toContain('[PitwallMem]::Read()')
  expect(WINDOWS_SAMPLE_SCRIPT).toContain('privateWs = $privateWs')
})

test('커밋 크기(commit)를 프로세스마다 읽고, 없거나 숫자가 아니면 null', () => {
  const processes = [10, 11, 12].map((id) => ({
    ProcessId: id,
    ParentProcessId: 0,
    Name: 'a',
    CommandLine: 'a',
    WorkingSetSize: 900
  }))
  const s = parseWindowsSample(
    JSON.stringify({
      processes,
      tcp: [],
      privateWs: { '10': 300 },
      commit: { '10': 4096, '12': '4096' }
    })
  )
  expect(s.processes.map((p) => p.commitBytes)).toEqual([4096, null, null])
  // 보조 코드가 없는 샘플(제한 모드 대체 스크립트 등)은 커밋을 모른다.
  const safe = parseWindowsSample(JSON.stringify({ processes, tcp: [] }))
  expect(safe.processes.map((p) => p.commitBytes)).toEqual([null, null, null])
})

test('시스템 커밋·커널을 읽고, 한도가 0 이하·값이 없으면 null', () => {
  const withSystem = (system: unknown): string => JSON.stringify({ processes: [], tcp: [], system })
  expect(
    parseWindowsSample(withSystem({ commitTotal: 100, commitLimit: 200, kernel: 5 })).system
  ).toEqual({
    commitUsedBytes: 100,
    commitLimitBytes: 200,
    kernelBytes: 5
  })
  expect(parseWindowsSample(withSystem(null)).system).toBeNull()
  expect(
    parseWindowsSample(withSystem({ commitTotal: 100, commitLimit: 0, kernel: 5 })).system
  ).toBeNull()
  expect(parseWindowsSample(withSystem({ commitTotal: 100, commitLimit: 200 })).system).toBeNull()
  expect(parseWindowsSample(JSON.stringify({ processes: [], tcp: [] })).system).toBeNull()
})

test('스크립트는 PrivateUsage(72)와 GetPerformanceInfo 를 읽는다', () => {
  expect(WINDOWS_SAMPLE_SCRIPT).toContain('ReadInt64(buf, 72)')
  expect(WINDOWS_SAMPLE_SCRIPT).toContain('GetPerformanceInfo')
  expect(WINDOWS_SAMPLE_SCRIPT).toContain('commit = $commit')
  expect(WINDOWS_SAMPLE_SCRIPT).toContain('system = $system')
})

test('TCP 목록은 빠른 OS API(GetExtendedTcpTable)로 읽고, 막히면 Get-NetTCPConnection 으로 대신한다', () => {
  expect(WINDOWS_SAMPLE_SCRIPT).toContain('GetExtendedTcpTable')
  expect(WINDOWS_SAMPLE_SCRIPT).toMatch(/if \(\$t -eq \$null\) \{[\s\S]*Get-NetTCPConnection/)
})

test('읽는 사이 목록이 커지면(오류 122) 다시 읽고, IPv4·IPv6 가 모두 실패하면 예외를 던져 대체 경로로 넘긴다', () => {
  expect(WINDOWS_SAMPLE_SCRIPT).toContain('ERROR_INSUFFICIENT_BUFFER = 122')
  expect(WINDOWS_SAMPLE_SCRIPT).toMatch(/for \(int attempt = 0; attempt < 5; attempt\+\+\)/)
  expect(WINDOWS_SAMPLE_SCRIPT).toContain('if (!v4 && !v6) throw new InvalidOperationException')
})

test('스크립트는 프로세스마다 작업 폴더를 읽고, 실패해도 나머지는 낸다', () => {
  expect(WINDOWS_SAMPLE_SCRIPT).toContain('ReadProcessMemory')
  expect(WINDOWS_SAMPLE_SCRIPT).toContain('[PitwallCwd]::Get(')
  expect(WINDOWS_SAMPLE_SCRIPT).toMatch(/try\s*\{[\s\S]*Add-Type[\s\S]*\}\s*catch/)
})

test('보조 코드 DLL 경로를 주면 한 번만 컴파일해 재사용하고, 경로의 작은따옴표는 이스케이프한다', () => {
  const script = windowsSampleScript(
    "C:\\Users\\김'개발\\AppData\\Roaming\\pitwall\\pitwall-native-1.dll"
  )
  expect(script).toContain(
    "$dll = 'C:\\Users\\김''개발\\AppData\\Roaming\\pitwall\\pitwall-native-1.dll'"
  )
  expect(script).toContain('Add-Type -Path $dll')
  expect(script).toContain('-OutputAssembly $dll')
  expect(windowsSampleScript(null)).not.toContain('$dll')
  expect(nativeHelperDllName()).toMatch(/^pitwall-native-[0-9a-f]{12}\.dll$/)
})

test('보조 코드에 창 찾기·앞으로 가져오기(PitwallWindow)가 있고, 수집 스크립트는 그것을 부르지 않는다', () => {
  for (const api of [
    'EnumWindows',
    'GetWindowThreadProcessId',
    'IsWindowVisible',
    'GetWindow(h, 4) == IntPtr.Zero',
    'GetWindowText(h, title, 256) > 0',
    'IsIconic(h)) ShowWindowAsync(h, 9)',
    'SetForegroundWindow(h)',
    'GetForegroundWindow() == h'
  ])
    expect(WINDOWS_SAMPLE_SCRIPT).toContain(api)
  expect(WINDOWS_SAMPLE_SCRIPT).not.toContain('[PitwallWindow]::')
})

test('명령줄 길이 제한(32767자) 안에 들어간다', () => {
  const longPath =
    'C:\\Users\\' + '가'.repeat(60) + '\\AppData\\Roaming\\pitwall\\' + nativeHelperDllName()
  const args = buildPowerShellArgs(windowsSampleScript(longPath))
  expect([powershellPath(), ...args].join(' ').length).toBeLessThan(30000)
})

test('powershell.exe 는 SystemRoot 기준 전체 경로로 실행(PATH 에 의존하지 않음)', () => {
  expect(powershellPath({ SystemRoot: 'D:\\Win' })).toBe(
    'D:\\Win\\System32\\WindowsPowerShell\\v1.0\\powershell.exe'
  )
  expect(powershellPath({})).toBe('C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe')
})

describe.runIf(process.platform === 'win32')('실제 Windows 에서', () => {
  test('npm 으로 설치한 Claude Code(node …\\@anthropic-ai\\claude-code\\cli.js)의 작업 폴더를 읽는다', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'pitwall-npm-agent-'))
    const pkg = join(dir, 'npm', 'node_modules', '@anthropic-ai', 'claude-code')
    const work = join(dir, 'work')
    const { mkdir } = await import('fs/promises')
    await mkdir(pkg, { recursive: true })
    await mkdir(work)
    writeFileSync(join(pkg, 'cli.js'), 'setTimeout(() => {}, 20000)')
    const child = spawn(process.execPath, [join(pkg, 'cli.js')], { cwd: work, windowsHide: true })
    const exited = new Promise<void>((r) => child.once('exit', () => r()))
    try {
      await new Promise((r) => setTimeout(r, 300))
      const s = await sampleWindows()
      expect(s.processes.find((p) => p.pid === child.pid)?.name).toBe('node.exe')
      expect(s.cwds?.[child.pid!]?.replace(/\\$/, '').toLowerCase()).toBe(work.toLowerCase())
    } finally {
      child.kill()
      await exited
      await rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })
    }
  }, 30000)

  test('포트도 없고 에이전트도 아닌 프로세스(타입 검사·빌드 등)의 작업 폴더도 읽는다', async () => {
    const work = await mkdtemp(join(tmpdir(), 'pitwall-plain-cwd-'))
    const child = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 20000)'], {
      cwd: work,
      windowsHide: true
    })
    const exited = new Promise<void>((r) => child.once('exit', () => r()))
    try {
      await new Promise((r) => setTimeout(r, 300))
      const s = await sampleWindows()
      expect(s.cwds?.[child.pid!]?.replace(/\\$/, '').toLowerCase()).toBe(work.toLowerCase())
    } finally {
      child.kill()
      await exited
      await rm(work, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })
    }
  }, 30000)

  test('샘플에 자기 자신과 한글 인자를 가진 자식 프로세스가 그대로 보인다', async () => {
    const child = spawn(
      process.execPath,
      ['-e', 'setTimeout(() => {}, 20000)', 'C:\\Users\\김개발\\work'],
      {
        windowsHide: true
      }
    )
    try {
      await new Promise((r) => setTimeout(r, 300))
      const s = await sampleWindows()
      expect(s.processes.find((p) => p.pid === process.pid)?.commandLine).toContain('vitest')
      const childInfo = s.processes.find((p) => p.pid === child.pid)
      expect(childInfo?.commandLine).toContain('C:\\Users\\김개발\\work')
      expect(childInfo?.startedAt).toBeGreaterThan(Date.now() - 60000)
      expect(childInfo?.startedAt).toBeLessThanOrEqual(Date.now())
      expect(s.tcp.length).toBeGreaterThan(0)
      expect(s.processes.find((p) => p.pid === process.pid)?.cpuMs).toBeGreaterThan(0)
    } finally {
      child.kill()
    }
  }, 30000)

  test('실제 스크립트가 대부분의 프로세스에 대해 전용 작업 세트를 내고, 그 값은 작업 세트보다 작다', async () => {
    const r = await runCommand([powershellPath(), ...buildPowerShellArgs(WINDOWS_SAMPLE_SCRIPT)])
    const data = JSON.parse(r.stdout.replace(/^\uFEFF/, '')) as {
      processes: { ProcessId: number; WorkingSetSize: number }[]
      privateWs: Record<string, number>
    }
    const entries = Object.entries(data.privateWs)
    expect(entries.length).toBeGreaterThan(data.processes.length / 3)
    const self = data.processes.find((p) => p.ProcessId === process.pid)!
    expect(data.privateWs[String(process.pid)]).toBeGreaterThan(0)
    expect(data.privateWs[String(process.pid)]).toBeLessThan(self.WorkingSetSize)
  }, 30000)

  test('실제 스크립트가 커밋과 시스템 커밋을 낸다', async () => {
    const s = await sampleWindows()
    const known = s.processes.filter((p) => (p.commitBytes ?? 0) > 0)
    expect(known.length).toBeGreaterThanOrEqual(s.processes.length / 2)
    const self = s.processes.find((p) => p.pid === process.pid)!
    expect(self.commitBytes).toBeGreaterThanOrEqual(self.memoryBytes * 0.5)
    expect(s.system?.commitLimitBytes).toBeGreaterThanOrEqual(totalmem())
    expect(s.system?.commitUsedBytes).toBeGreaterThan(0)
    expect(s.system!.commitUsedBytes).toBeLessThanOrEqual(s.system!.commitLimitBytes)
    expect(s.system?.kernelBytes).toBeGreaterThan(0)
  }, 30000)

  test('제한 모드(ConstrainedLanguage)에서도 대체 스크립트로 수집되고 한글 인자가 보존된다', async () => {
    resetWindowsSamplerMode()
    const child = spawn(
      process.execPath,
      ['-e', 'setTimeout(() => {}, 20000)', 'C:\\Users\\김개발\\clm'],
      {
        windowsHide: true
      }
    )
    try {
      await new Promise((r) => setTimeout(r, 300))
      const s = await sampleWindows({ languageModeForTest: 'ConstrainedLanguage' })
      const info = s.processes.find((p) => p.pid === child.pid)
      expect(info?.commandLine).toContain('C:\\Users\\김개발\\clm')
      expect(info?.startedAt).toBeGreaterThan(Date.now() - 60000)
      expect(s.tcp.some((t) => t.state === 'Listen')).toBe(true)
    } finally {
      child.kill()
      resetWindowsSamplerMode()
    }
  }, 60000)

  test('DLL 캐시: 첫 실행에 만들고 다음 실행부터 재사용, 결과는 같다', async () => {
    const dir = await mkdtemp(join(tmpdir(), '김개발-dll-'))
    const dll = join(dir, nativeHelperDllName())
    try {
      const first = await sampleWindows({ helperDllPath: dll })
      expect(existsSync(dll)).toBe(true)
      const second = await sampleWindows({ helperDllPath: dll })
      expect(first.tcp.length).toBeGreaterThan(0)
      expect(second.tcp.some((t) => t.state === 'Listen')).toBe(true)
      expect(Object.keys(second.cwds ?? {}).length).toBeGreaterThan(0)
    } finally {
      await rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })
    }
  }, 60000)

  // 읽기 전용: find 만 실제로 돌린다(focus 는 사용자의 앞 창을 가져가므로 실제 창에 실행하지 않는다).
  test('find 는 이 테스트 프로세스의 조상 가운데 창을 가진 프로세스를 찾거나 null 을 돌려주고 예외를 내지 않는다', async () => {
    const s = await sampleWindows()
    const tree = buildTree(s.processes)
    // 이 테스트를 띄운 에이전트(Claude Code 등)가 조상에 있으면 그것의, 없으면 이 프로세스의 창 후보.
    const agent =
      tree.ancestors(process.pid, 64).find(classifyAgent) ?? tree.byPid.get(process.pid)!
    const host = hostFinder(s.processes, tree)(agent.pid)
    const row: AgentRow = {
      pid: agent.pid,
      tool: 'claude',
      worktree: null,
      workspace: null,
      startedAt: agent.startedAt,
      memoryBytes: agent.memoryBytes,
      commitBytes: null,
      descendantCount: 0,
      processes: [],
      state: 'idle',
      stateSource: 'cpu',
      stateSince: null,
      cpuPercent: null,
      lastActiveAt: null,
      parked: false,
      activity: null,
      quietSince: null,
      host
    }
    const scripts: string[] = []
    const results: CommandResult[] = []
    const focuser = createFocuser({
      platform: 'win32',
      latest: () => ({
        ...blankSnapshot(1),
        platform: 'win32',
        collectMode: s.collectMode,
        agents: [row]
      }),
      run: async (argv, opts) => {
        scripts.push(Buffer.from(argv[argv.length - 1], 'base64').toString('utf16le'))
        const result = await runCommand(argv, opts)
        results.push(result)
        return result
      },
      helperDllPath: () => null,
      isDirectory: async () => false
    })
    const found = await focuser.findHost(selectionKey.agent(row))
    if (found) {
      expect(host.pids).toContain(found.pid)
      expect(found.title.length).toBeGreaterThan(0)
    } else expect(found).toBeNull()
    // 후보가 없으면 실행하지 않는다.
    expect(scripts).toHaveLength(host.pids.length > 0 ? 1 : 0)
    for (const script of scripts) expect(script).not.toContain('[PitwallWindow]::Focus(')
    // 못 찾았을 때도 오류 없이 JSON 한 줄(null)을 낸다.
    for (const result of results) {
      expect(result).toMatchObject({ exitCode: 0, stderr: '' })
      expect(() => JSON.parse(result.stdout)).not.toThrow()
    }
  }, 60000)

  test('find 는 실제 샘플의 모든 pid 가운데 보이는 창이 하나라도 있으면 찾는다(보조 코드를 불러와 Find 가 동작한다)', async () => {
    const s = await sampleWindows()
    // 따로 세는 기준: .NET 의 MainWindowTitle(보이고 소유자 없는 최상위 창의 제목)이 있는 프로세스 수.
    const titled = await runCommand(
      [
        powershellPath(),
        ...buildPowerShellArgs('@(Get-Process | Where-Object { $_.MainWindowTitle }).Count')
      ],
      { timeoutMs: 30000 }
    )
    const anyWindow = Number(titled.stdout.trim()) > 0
    const pids = s.processes.map((p) => p.pid).filter((pid) => pid > 0)
    // 명령줄 길이 제한 때문에 나눠서 찾는다(앱의 창 후보는 24개까지라 한 번이면 된다).
    let found: { pid: number; title: string; focused: boolean } | null = null
    for (let i = 0; i < pids.length && !found; i += 200) {
      const script = focusScript(null, pids.slice(i, i + 200), 'find')
      expect(script).not.toContain('[PitwallWindow]::Focus(')
      const r = await runCommand([powershellPath(), ...buildPowerShellArgs(script)], {
        timeoutMs: 30000
      })
      expect(r).toMatchObject({ exitCode: 0, stderr: '' })
      found = JSON.parse(r.stdout)
    }
    if (anyWindow) {
      expect(found).not.toBeNull()
      expect(pids).toContain(found!.pid)
      expect(found!.title.length).toBeGreaterThan(0)
      expect(found!.focused).toBe(false)
    }
  }, 120000)

  test('상대 경로로 띄운 서버도 작업 폴더(한글 포함)를 읽는다', async () => {
    const dir = await mkdtemp(join(tmpdir(), '김개발-cwd-'))
    const child = spawn(
      process.execPath,
      ['-e', "require('http').createServer().listen(0, () => console.log('ok'))"],
      { cwd: dir, windowsHide: true }
    )
    const exited = new Promise<void>((r) => child.once('exit', () => r()))
    try {
      await new Promise((r) => child.stdout.once('data', r))
      const s = await sampleWindows()
      expect(s.cwds?.[child.pid!]?.replace(/\\$/, '').toLowerCase()).toBe(dir.toLowerCase())
      const listen = s.tcp.filter((t) => t.pid === child.pid && t.state === 'Listen')
      expect(listen.length).toBeGreaterThan(0)
      expect(listen[0].localPort).toBeGreaterThan(1023)
      expect(['::', '0.0.0.0']).toContain(listen[0].localAddress)
    } finally {
      // Windows 는 프로세스가 작업 폴더로 쓰는 동안 그 폴더를 지울 수 없다.
      child.kill()
      await exited
      await rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })
    }
  }, 30000)
})
