import {
  parsePsOutput,
  parseLsofOutput,
  parseLsofCwd,
  lsofCwdArgv,
  sampleDarwin,
  PS_STATS_ARGV,
  PS_ARGS_ARGV,
  LSOF_ARGV
} from './darwin'

describe('작업 폴더(cwd)', () => {
  test('lsof -d cwd 출력 파싱', () => {
    const out = ['p4100', 'fcwd', 'n/Users/dev/My Projects/shop-web', 'p5200', 'fcwd', 'n/'].join('\n')
    expect(parseLsofCwd(out)).toEqual({ 4100: '/Users/dev/My Projects/shop-web', 5200: '/' })
  })

  test('포트를 연 pid 만 쉼표로 묶어 한 번에 묻는다', () => {
    expect(lsofCwdArgv([4100, 5200])).toEqual(['/usr/sbin/lsof', '-a', '-d', 'cwd', '-Fpn', '-w', '-p', '4100,5200'])
  })

  test('sampleDarwin: LISTEN pid 의 cwd 를 붙이고, 없으면 묻지 않는다', async () => {
    const lsof = ['p4100', 'f23', 'n*:3000', 'TST=LISTEN', 'p5200', 'f9', 'n127.0.0.1:5->127.0.0.1:3000', 'TST=ESTABLISHED'].join('\n')
    const run = vi.fn(async (argv: string[]) => {
      if (argv === LSOF_ARGV) return { stdout: lsof, stderr: '', exitCode: 0 }
      if (argv.includes('cwd')) return { stdout: 'p4100\nfcwd\nn/Users/dev/app\n', stderr: '', exitCode: 0 }
      return { stdout: '  4100 1 10 /usr/local/bin/node\n', stderr: '', exitCode: 0 }
    })
    const s = await sampleDarwin(run)
    expect(s.cwds).toEqual({ 4100: '/Users/dev/app' })
    expect(run.mock.calls.find((c) => c[0].includes('cwd'))?.[0]).toEqual(lsofCwdArgv([4100]))

    const quiet = vi.fn(async (argv: string[]) => ({ stdout: argv === LSOF_ARGV ? '' : '  1 0 1 /sbin/launchd\n', stderr: '', exitCode: argv === LSOF_ARGV ? 1 : 0 }))
    expect((await sampleDarwin(quiet)).cwds).toEqual({})
    expect(quiet.mock.calls.some((c) => c[0].includes('cwd'))).toBe(false)
  })

  test('cwd 조회가 실패해도 샘플은 성공(작업 폴더만 비움)', async () => {
    const run = vi.fn(async (argv: string[]) => {
      if (argv === LSOF_ARGV) return { stdout: 'p1\nf3\nn*:3000\nTST=LISTEN\n', stderr: '', exitCode: 0 }
      if (argv.includes('cwd')) throw new Error('timeout')
      return { stdout: '  1 0 1 /x\n', stderr: '', exitCode: 0 }
    })
    expect((await sampleDarwin(run)).cwds).toEqual({})
  })
})
import type { CommandResult } from './runCommand'

describe('parsePsOutput', () => {
  test('rss(KB)→바이트, 이름은 실행 파일 경로의 basename, 명령줄은 args', () => {
    const stats = '  4100  4000 1024000 /usr/local/bin/node\n'
    const args = '  4100 /usr/local/bin/node /Users/dev/work/shop-web/node_modules/.bin/vite --port 3000\n'
    expect(parsePsOutput(stats, args)).toEqual([
      {
        pid: 4100,
        ppid: 4000,
        name: 'node',
        memoryBytes: 1024000 * 1024,
        commandLine: '/usr/local/bin/node /Users/dev/work/shop-web/node_modules/.bin/vite --port 3000',
        startedAt: null
      }
    ])
  })

  test('실행 파일 경로에 공백이 있어도 이름이 맞다', () => {
    const exe = '/Applications/Visual Studio Code.app/Contents/Frameworks/Code Helper (Renderer).app/Contents/MacOS/Code Helper (Renderer)'
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
    expect(parsePsOutput(stats, '  10 -zsh\n').map((p) => [p.pid, p.name, p.commandLine])).toEqual([[10, 'zsh', '-zsh']])
  })
})

describe('parseLsofOutput', () => {
  test('LISTEN·ESTABLISHED·그 외 상태, IPv4·IPv6·와일드카드 주소', () => {
    const out = [
      'p4100', 'f23', 'n*:3000', 'TST=LISTEN', 'TQR=0', 'TQS=0',
      'f24', 'n[::1]:3000->[::1]:51234', 'TST=ESTABLISHED',
      'p5200', 'f30', 'n127.0.0.1:51234->127.0.0.1:3000', 'TST=CLOSE_WAIT'
    ].join('\n')
    expect(parseLsofOutput(out)).toEqual([
      { pid: 4100, localAddress: '*', localPort: 3000, remoteAddress: '', remotePort: 0, state: 'Listen' },
      { pid: 4100, localAddress: '::1', localPort: 3000, remoteAddress: '::1', remotePort: 51234, state: 'Established' },
      { pid: 5200, localAddress: '127.0.0.1', localPort: 51234, remoteAddress: '127.0.0.1', remotePort: 3000, state: 'Other' }
    ])
  })

  test('존(zone)이 붙은 IPv6 와 [::]:포트', () => {
    const out = ['p1', 'f3', 'n[fe80::1%lo0]:5173', 'TST=LISTEN', 'f4', 'n[::]:8080', 'TST=LISTEN'].join('\n')
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
    const run = vi.fn(async (argv: string[]) => (argv === LSOF_ARGV ? ok('', 2) : ok('  10 1 20 /bin/zsh\n')))
    await expect(sampleDarwin(run)).rejects.toThrow('lsof exited with 2')
  })
})
