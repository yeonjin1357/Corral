import { findHeavyJobs, heavyMatch } from './heavy'
import type { ProcessInfo, RawSample, WorktreeInfo } from '../shared/types'

const MB = 1024 * 1024
const W1: WorktreeInfo = { root: 'C:\\work\\shop-web', branch: 'develop', isLinkedWorktree: false }

function proc(
  pid: number,
  ppid: number,
  name: string,
  commandLine: string,
  mb = 10,
  startedAt = 100 + pid
): ProcessInfo {
  return { pid, ppid, name, commandLine, memoryBytes: mb * MB, startedAt }
}

describe('heavyMatch', () => {
  const DEFAULTS = ['tsc', 'vue-tsc', 'vite build', 'webpack', 'gradlew build', 'mvn']

  test.each([
    ['node C:\\p\\node_modules\\typescript\\bin\\tsc --noEmit -p tsconfig.json', 'tsc'],
    ['node --max-old-space-size=12288 ./node_modules/vue-tsc/bin/vue-tsc.js --noEmit', 'vue-tsc'],
    ['C:\\Windows\\system32\\cmd.exe /d /s /c "vue-tsc --noEmit"', 'vue-tsc'],
    ['node C:\\p\\node_modules\\vite\\bin\\vite.js build', 'vite build'],
    ['node C:\\p\\node_modules\\vite\\bin\\vite.js --mode production build', 'vite build'],
    ['/bin/sh ./gradlew build', 'gradlew build'],
    ['C:\\WINDOWS\\system32\\cmd.exe /c ""C:\\maven\\bin\\mvn.cmd" clean install"', 'mvn'],
    ['/usr/local/bin/mvn package', 'mvn'],
    ['NODE C:\\P\\NODE_MODULES\\VUE-TSC\\BIN\\VUE-TSC.JS', 'vue-tsc']
  ])('%s → %s', (commandLine, expected) => {
    expect(heavyMatch(commandLine, DEFAULTS)).toBe(expected)
  })

  test.each([
    // tsconfig.json·tsserver 는 tsc 가 아니다.
    'node x.js --project tsconfig.json',
    'node C:\\p\\node_modules\\typescript\\lib\\tsserver.js',
    // vite 는 build 가 있어야 한다.
    'node C:\\p\\node_modules\\vite\\bin\\vite.js serve',
    // 인자로 받은 폴더 이름(실행 파일이 아님)은 명령이 아니다.
    '"C:\\Program Files\\Microsoft VS Code\\Code.exe" C:\\repos\\webpack',
    '/Applications/Visual Studio Code.app/Contents/MacOS/Electron /Users/dev/tsc',
    'node --config=webpack x.js',
    ''
  ])('%s → 없음', (commandLine) => {
    expect(heavyMatch(commandLine, DEFAULTS)).toBeNull()
  })

  test('설정 순서대로 처음 맞는 패턴을 돌려주고, 패턴의 여분 공백·대소문자는 무시한다', () => {
    expect(heavyMatch('node vue-tsc.js --noEmit', ['  VUE-TSC  ', 'tsc'])).toBe('  VUE-TSC  ')
    expect(heavyMatch('node vite.js build', ['vite    build'])).toBe('vite    build')
    expect(heavyMatch('node vite.js build', [])).toBeNull()
    expect(heavyMatch('node vite.js build', ['   '])).toBeNull()
  })
})

describe('findHeavyJobs', () => {
  const patterns = ['tsc', 'vue-tsc', 'vite build', 'webpack']

  function sample(processes: ProcessInfo[]): RawSample {
    return { processes, tcp: [] }
  }

  test('npm → cmd → node 사슬은 맨 위 일치 프로세스 하나로, 자손 메모리를 더한다', () => {
    const rows = findHeavyJobs(
      sample([
        proc(100, 1, 'node.exe', 'node npm-cli.js run typecheck', 50),
        proc(101, 100, 'cmd.exe', 'C:\\Windows\\system32\\cmd.exe /d /s /c "vue-tsc --noEmit"', 5),
        proc(
          102,
          101,
          'node.exe',
          'node C:\\work\\shop-web\\node_modules\\vue-tsc\\bin\\vue-tsc.js --noEmit',
          8000
        )
      ]),
      new Map([[100, W1]]),
      { patterns, exclude: new Set() }
    )
    expect(rows).toEqual([
      {
        pid: 101,
        label: 'vue-tsc',
        processName: 'cmd.exe',
        commandLine: 'C:\\Windows\\system32\\cmd.exe /d /s /c "vue-tsc --noEmit"',
        worktree: W1,
        memoryBytes: 8005 * MB,
        descendantPids: [102],
        startedAt: 201
      }
    ])
  })

  test('에이전트가 띄운 작업은 무거운 작업이고, 에이전트 자체는 아니다', () => {
    const rows = findHeavyJobs(
      sample([
        proc(500, 1, 'claude.exe', 'claude.exe --append-system-prompt "run tsc"', 400),
        proc(501, 500, 'bash.exe', 'bash -c "npx tsc --noEmit"', 5),
        proc(
          502,
          501,
          'node.exe',
          'node C:\\work\\shop-web\\node_modules\\typescript\\bin\\tsc --noEmit',
          3000
        )
      ]),
      new Map([[500, W1]]),
      { patterns, exclude: new Set([500]) }
    )
    expect(rows.map((r) => [r.pid, r.label, r.worktree?.root])).toEqual([[501, 'tsc', W1.root]])
  })

  test('제외 목록(개발 서버 트리·pitwall)은 무거운 작업이 아니고, 그 아래도 보지 않는다', () => {
    const rows = findHeavyJobs(
      sample([
        proc(600, 1, 'node.exe', 'node webpack.js serve', 900),
        proc(601, 600, 'node.exe', 'node webpack.js --worker', 300)
      ]),
      new Map(),
      { patterns, exclude: new Set([600, 601]) }
    )
    expect(rows).toEqual([])
  })

  test('따로 도는 작업 둘은 두 행, 메모리 큰 순', () => {
    const rows = findHeavyJobs(
      sample([
        proc(700, 1, 'node.exe', 'node tsc --noEmit', 1000),
        proc(800, 1, 'node.exe', 'node vite.js build', 3000)
      ]),
      new Map(),
      { patterns, exclude: new Set() }
    )
    expect(rows.map((r) => [r.pid, r.label, r.worktree])).toEqual([
      [800, 'vite build', null],
      [700, 'tsc', null]
    ])
  })

  test('패턴이 없으면 아무것도 찾지 않는다', () => {
    expect(
      findHeavyJobs(sample([proc(700, 1, 'node.exe', 'node tsc')]), new Map(), {
        patterns: [],
        exclude: new Set()
      })
    ).toEqual([])
  })
})
