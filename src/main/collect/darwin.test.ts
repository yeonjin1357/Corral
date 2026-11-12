import {
  parsePsOutput,
  parseLsofOutput,
  parseLsofCwd,
  lsofCwdArgv,
  allCwdsDarwin,
  sampleDarwin,
  PS_STATS_ARGV,
  PS_ARGS_ARGV,
  LSOF_ARGV
} from './darwin'

describe('작업 폴더(cwd)', () => {
  test('lsof -d cwd 출력 파싱', () => {
    const out = ['p4100', 'fcwd', 'n/Users/dev/My Projects/shop-web', 'p5200', 'fcwd', 'n/'].join(
      '\n'
    )
    expect(parseLsofCwd(out)).toEqual({ 4100: '/Users/dev/My Projects/shop-web', 5200: '/' })
  })

  test('lsof 가 \\xNN 으로 바꿔 쓴 한글 경로를 되돌린다(그 외 역슬래시는 그대로)', () => {
    const out = [
      'p1',
      'fcwd',
      'n/Users/\\xea\\xb9\\x80\\xea\\xb0\\x9c\\xeb\\xb0\\x9c/app',
      'p2',
      'fcwd',
      'n/tmp/a\\b'
    ].join('\n')
    expect(parseLsofCwd(out)).toEqual({ 1: '/Users/김개발/app', 2: '/tmp/a\\b' })
  })

  test('ps·lsof 는 UTF-8 로케일(LC_ALL)로 실행한다(Finder 로 켠 앱은 LANG 이 없어 한글이 깨지므로)', async () => {
    const envs: unknown[] = []
    const run = vi.fn(async (argv: string[], opts?: { env?: Record<string, string> }) => {
      envs.push(opts?.env)
      if (argv === LSOF_ARGV)
        return { stdout: 'p1\nf3\nn*:3000\nTST=LISTEN\n', stderr: '', exitCode: 0 }
      return { stdout: '  1 0 1 /x\n', stderr: '', exitCode: 0 }
    })
    await sampleDarwin(run)
    expect(run).toHaveBeenCalledTimes(4)
    expect(envs).toEqual(Array(4).fill({ LC_ALL: 'en_US.UTF-8' }))
  })

  test('allCwdsDarwin: 지우기 직전 확인용으로 이 사용자의 모든 프로세스 작업 폴더를 한 번에 묻는다', async () => {
    const calls: string[][] = []
    const run = async (argv: string[]): Promise<CommandResult> => {
      calls.push(argv)
      return { stdout: 'p55\nfcwd\nn/Users/dev/wt-a/src\n', stderr: '', exitCode: 0 }
    }
    expect(await allCwdsDarwin(run, 501)).toEqual({ 55: '/Users/dev/wt-a/src' })
    expect(calls).toEqual([['/usr/sbin/lsof', '-a', '-d', 'cwd', '-Fpn', '-w', '-u', '501']])
    const failing = async (): Promise<CommandResult> => ({ stdout: '', stderr: 'x', exitCode: 2 })
    expect(await allCwdsDarwin(failing, 501)).toBeNull()
  })

  test('포트를 연 pid 만 쉼표로 묶어 한 번에 묻는다', () => {
    expect(lsofCwdArgv([4100, 5200])).toEqual([
      '/usr/sbin/lsof',
      '-a',
      '-d',
      'cwd',
      '-Fpn',
      '-w',
      '-p',
      '4100,5200'
    ])
  })

  test('sampleDarwin: LISTEN pid 의 cwd 를 붙이고, 없으면 묻지 않는다', async () => {
    const lsof = [
      'p4100',
      'f23',
      'n*:3000',
      'TST=LISTEN',
      'p5200',
      'f9',
      'n127.0.0.1:5->127.0.0.1:3000',
      'TST=ESTABLISHED'
    ].join('\n')
    const run = vi.fn(async (argv: string[]) => {
      if (argv === LSOF_ARGV) return { stdout: lsof, stderr: '', exitCode: 0 }
      if (argv.includes('cwd'))
        return { stdout: 'p4100\nfcwd\nn/Users/dev/app\n', stderr: '', exitCode: 0 }
      return { stdout: '  4100 1 10 /usr/local/bin/node\n', stderr: '', exitCode: 0 }
    })
    const s = await sampleDarwin(run)
    expect(s.cwds).toEqual({ 4100: '/Users/dev/app' })
    expect(s.collectMode).toBe('darwin')
    expect(run.mock.calls.find((c) => c[0].includes('cwd'))?.[0]).toEqual(lsofCwdArgv([4100]))

    const quiet = vi.fn(async (argv: string[]) => ({
      stdout: argv === LSOF_ARGV ? '' : '  1 0 1 /sbin/launchd\n',
      stderr: '',
      exitCode: argv === LSOF_ARGV ? 1 : 0
    }))
    expect((await sampleDarwin(quiet)).cwds).toEqual({})
    expect(quiet.mock.calls.some((c) => c[0].includes('cwd'))).toBe(false)
  })

  test('cwd 조회가 실패해도 샘플은 성공(작업 폴더만 비움)', async () => {
    const run = vi.fn(async (argv: string[]) => {
      if (argv === LSOF_ARGV)
        return { stdout: 'p1\nf3\nn*:3000\nTST=LISTEN\n', stderr: '', exitCode: 0 }
      if (argv.includes('cwd')) throw new Error('timeout')
      return { stdout: '  1 0 1 /x\n', stderr: '', exitCode: 0 }
    })
    expect((await sampleDarwin(run)).cwds).toEqual({})
  })
})
import type { CommandResult } from './runCommand'

describe('parsePsOutput', () => {
  test('lstart(시작 시각, 로컬 시간)를 읽어 startedAt 으로 쓴다(PID 재사용 확인용)', () => {
    const stats = '  4100  4000 1024000 Thu Nov  6 10:01:02 2026 /usr/local/bin/node\n'
    const [p] = parsePsOutput(stats, '  4100 node vite\n')
    expect(p.startedAt).toBe(new Date(2026, 10, 6, 10, 1, 2).getTime())
    expect(p.name).toBe('node')
    expect(p.memoryBytes).toBe(1024000 * 1024)
  })

  test('lstart 뒤의 실행 파일 경로에 공백이 있어도 된다', () => {
    const exe = '/Applications/Visual Studio Code.app/Contents/MacOS/Electron'
    const [p] = parsePsOutput(`  700     1   51200 Mon Jan 12 09:05:00 2026 ${exe}\n`, '')
    expect(p.name).toBe('Electron')
    expect(p.startedAt).toBe(new Date(2026, 0, 12, 9, 5, 0).getTime())
  })

  test('실행 파일 경로를 그대로 담는다(어느 앱의 프로세스인지 가리는 데 쓴다), 경로가 아니면 null', () => {
    const helper =
      '/Applications/Google Chrome.app/Contents/Frameworks/Google Chrome Framework.framework/Helpers/Google Chrome Helper (Renderer).app/Contents/MacOS/Google Chrome Helper (Renderer)'
    const [chrome, shell] = parsePsOutput(
      [
        `  700     1   51200 Mon Jan 12 09:05:00 2026 ${helper}`,
        '  701   700     900 Mon Jan 12 09:05:01 2026 -zsh',
        ''
      ].join('\n'),
      [`  700 ${helper} --type=renderer`, '  701 -zsh', ''].join('\n')
    )
    expect(chrome.exePath).toBe(helper)
    expect(chrome.name).toBe('Google Chrome Helper (Renderer)')
    expect(shell.exePath).toBeNull()
  })

  test('ps 가 CPU 시간(time)과 lstart 를 요청받는다', () => {
    expect(PS_STATS_ARGV).toEqual(['/bin/ps', '-axww', '-o', 'pid=,ppid=,rss=,time=,lstart=,comm='])
  })

  test('CPU 시간 형식 4가지를 ms 로 읽는다', () => {
    const line = (time: string): string => `  1 0 10 ${time} Thu Nov  6 10:01:02 2026 /bin/x\n`
    expect(parsePsOutput(line('0:01.50'), '')[0].cpuMs).toBe(1500)
    expect(parsePsOutput(line('12:03.00'), '')[0].cpuMs).toBe(723000)
    expect(parsePsOutput(line('1:02:03'), '')[0].cpuMs).toBe(3723000)
    expect(parsePsOutput(line('2-01:00:00'), '')[0].cpuMs).toBe(176400000)
    expect(parsePsOutput('  1 0 10 /bin/x\n', '')[0].cpuMs).toBeNull()
  })

  test('작업 폴더는 포트를 연 프로세스와 에이전트 프로세스 둘 다 묻는다', async () => {
    const run = vi.fn(async (argv: string[]) => {
      if (argv === LSOF_ARGV)
        return { stdout: 'p4100\nf3\nn*:3000\nTST=LISTEN\n', stderr: '', exitCode: 0 }
      if (argv.includes('cwd')) return { stdout: '', stderr: '', exitCode: 0 }
      if (argv === PS_ARGS_ARGV)
        return { stdout: '  5000 /Users/a/.local/bin/claude\n', stderr: '', exitCode: 0 }
      return {
        stdout: '  5000 1 10 0:01.00 Thu Nov  6 10:01:02 2026 /Users/a/.local/bin/claude\n',
        stderr: '',
        exitCode: 0
      }
    })
    await sampleDarwin(run)
    expect(run.mock.calls.find((c) => c[0].includes('cwd'))?.[0]).toEqual(lsofCwdArgv([4100, 5000]))
  })

  test('rss(KB)→바이트, 이름은 실행 파일 경로의 basename, 명령줄은 args', () => {
    const stats = '  4100  4000 1024000 /usr/local/bin/node\n'
    const args =
      '  4100 /usr/local/bin/node /Users/dev/work/shop-web/node_modules/.bin/vite --port 3000\n'
    expect(parsePsOutput(stats, args)).toEqual([
      {
        pid: 4100,
        ppid: 4000,
        name: 'node',
        memoryBytes: 1024000 * 1024,
        commandLine:
          '/usr/local/bin/node /Users/dev/work/shop-web/node_modules/.bin/vite --port 3000',
        startedAt: null,
        cpuMs: null,
        exePath: '/usr/local/bin/node'
      }
    ])
  })

  test('실행 파일 경로에 공백이 있어도 이름이 맞다', () => {
    const exe =
      '/Applications/Visual Studio Code.app/Contents/Frameworks/Code Helper (Renderer).app/Contents/MacOS/Code Helper (Renderer)'
    const stats = `  700     1   51200 ${exe}\n`
    const args = `  700 ${exe} --type=renderer\n`
    const [p] = parsePsOutput(stats, args)
    expect(p.name).toBe('Code Helper (Renderer)')
    expect(p.commandLine).toBe(`${exe} --type=renderer`)
  })

  test('args 쪽에 없는 pid 는 실행 파일 경로를 명령줄로 쓴다', () => {
    expect(parsePsOutput('  9 1 10 /sbin/launchd\n', '')[0].commandLine).toBe('/sbin/launchd')
  })

  test('빈 줄·형식이 틀린 줄은 건너뛴다', () => {
    const stats = '\n  abc def\n  10 1 20 /bin/zsh\n   \n'
    expect(parsePsOutput(stats, '  10 -zsh\n').map((p) => [p.pid, p.name, p.commandLine])).toEqual([
      [10, 'zsh', '-zsh']
    ])
  })
})

describe('parseLsofOutput', () => {
  test('LISTEN·ESTABLISHED·그 외 상태, IPv4·IPv6·와일드카드 주소', () => {
    const out = [
      'p4100',
      'f23',
      'n*:3000',
      'TST=LISTEN',
      'TQR=0',
      'TQS=0',
      'f24',
      'n[::1]:3000->[::1]:51234',
      'TST=ESTABLISHED',
      'p5200',
      'f30',
      'n127.0.0.1:51234->127.0.0.1:3000',
      'TST=CLOSE_WAIT'
    ].join('\n')
    expect(parseLsofOutput(out)).toEqual([
      {
        pid: 4100,
        localAddress: '*',
        localPort: 3000,
        remoteAddress: '',
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
        pid: 5200,
        localAddress: '127.0.0.1',
        localPort: 51234,
        remoteAddress: '127.0.0.1',
        remotePort: 3000,
        state: 'Other'
      }
    ])
  })

  test('존(zone)이 붙은 IPv6 와 [::]:포트', () => {
    const out = [
      'p1',
      'f3',
      'n[fe80::1%lo0]:5173',
      'TST=LISTEN',
      'f4',
      'n[::]:8080',
      'TST=LISTEN'
    ].join('\n')
    expect(parseLsofOutput(out).map((t) => [t.localAddress, t.localPort])).toEqual([
      ['fe80::1%lo0', 5173],
      ['::', 8080]
    ])
  })

  test('주소를 못 읽는 항목과 상태가 없는 항목은 버린다', () => {
    const out = ['p1', 'f3', 'nsomething-weird', 'TST=LISTEN', 'f4', 'n*:4000'].join('\n')
    expect(parseLsofOutput(out)).toEqual([])
  })

  test('CRLF 줄바꿈도 처리', () => {
    expect(parseLsofOutput('p7\r\nf1\r\nn*:3000\r\nTST=LISTEN\r\n')).toHaveLength(1)
  })
})

describe('sampleDarwin', () => {
  const ok = (stdout: string, exitCode = 0): CommandResult => ({ stdout, stderr: '', exitCode })

  test('명령은 PATH 에 의존하지 않는 전체 경로로 실행한다', () => {
    expect(PS_STATS_ARGV[0]).toBe('/bin/ps')
    expect(PS_ARGS_ARGV[0]).toBe('/bin/ps')
    expect(LSOF_ARGV.slice(0, 1)).toEqual(['/usr/sbin/lsof'])
    expect(LSOF_ARGV).toEqual(expect.arrayContaining(['-nP', '-iTCP', '-FpnT', '-w']))
  })

  test('lsof 종료 코드 1(결과 없음)은 빈 TCP 목록', async () => {
    const run = vi.fn(async (argv: string[]) => {
      if (argv === LSOF_ARGV) return ok('', 1)
      if (argv === PS_STATS_ARGV) return ok('  10 1 20 /bin/zsh\n')
      return ok('  10 -zsh\n')
    })
    const s = await sampleDarwin(run)
    expect(s.tcp).toEqual([])
    expect(s.processes).toHaveLength(1)
    expect(run).toHaveBeenCalledTimes(3)
  })

  test('ps 가 실패하면 이유가 담긴 에러', async () => {
    const run = vi.fn(async (argv: string[]) => (argv === PS_STATS_ARGV ? ok('', 1) : ok('')))
    await expect(sampleDarwin(run)).rejects.toThrow('ps exited with 1')
  })

  test('lsof 가 1 이 아닌 코드로 실패하면 에러', async () => {
    const run = vi.fn(async (argv: string[]) =>
      argv === LSOF_ARGV ? ok('', 2) : ok('  10 1 20 /bin/zsh\n')
    )
    await expect(sampleDarwin(run)).rejects.toThrow('lsof exited with 2')
  })
})
