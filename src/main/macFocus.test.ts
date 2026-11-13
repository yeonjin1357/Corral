import { selectTabArgv, tabTerminalOf, ttyArgv, ttyDeviceOf } from './macFocus'

test.each([
  ['/System/Applications/Utilities/Terminal.app', 'terminal'],
  ['/Applications/iTerm.app', 'iterm'],
  ['/Users/dev/Applications/iTerm.app', 'iterm'],
  // 탭을 고를 방법이 없는 앱, 이름만 비슷한 앱.
  ['/Applications/Visual Studio Code.app', null],
  ['/Applications/Warp.app', null],
  ['/Applications/MyTerminal.app', null],
  [null, null]
] as const)('탭을 고를 수 있는 터미널인지: %s → %s', (app, want) => {
  expect(tabTerminalOf(app)).toBe(want)
})

test.each([
  ['ttys003\n', '/dev/ttys003'],
  ['  ttys012  \n', '/dev/ttys012'],
  // 터미널에 붙어 있지 않은 프로세스.
  ['??\n', null],
  ['', null],
  // 기대한 모양이 아니면 쓰지 않는다.
  ['ttys003; rm -rf /\n', null],
  ['ttys003\nttys004\n', null],
  ['../../etc/passwd\n', null]
])('ps 의 tty 출력 %j → %s', (out, want) => {
  expect(ttyDeviceOf(out)).toBe(want)
})

test('ps 에는 그 pid 의 tty 만 묻는다', () => {
  expect(ttyArgv(5000)).toEqual(['/bin/ps', '-o', 'tty=', '-p', '5000'])
})

test.each(['terminal', 'iterm'] as const)(
  '%s: tty 는 스크립트 글자에 넣지 않고 인자로 넘긴다',
  (kind) => {
    const argv = selectTabArgv(kind, '/dev/ttys003')
    expect(argv[0]).toBe('/usr/bin/osascript')
    expect(argv[argv.length - 1]).toBe('/dev/ttys003')
    const script = argv.slice(1, -1)
    // -e <줄> 이 번갈아 나오고, 어느 줄에도 tty 글자가 없다.
    expect(script.length % 2).toBe(0)
    expect(script.filter((_, i) => i % 2 === 0).every((flag) => flag === '-e')).toBe(true)
    expect(script.join('\n')).not.toContain('ttys003')
  }
)

test('두 터미널은 서로 다른 앱에 묻는다', () => {
  expect(selectTabArgv('terminal', '/dev/ttys003').join('\n')).toContain('com.apple.Terminal')
  expect(selectTabArgv('iterm', '/dev/ttys003').join('\n')).toContain('com.googlecode.iterm2')
})
