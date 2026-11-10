import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { blankSnapshot } from '../shared/snapshot'
import { DEFAULT_SETTINGS, REFRESH_INTERVALS, type Settings } from '../shared/settings'
import type { ClaudeHookActionResult } from '../shared/ipc'
import type { PitEvent } from '../shared/events'
import type {
  ClaudeHookState,
  CommitSummary,
  DashboardSnapshot,
  HeavyJobRow,
  MemoryLevel
} from '../shared/types'
import {
  commandSegments,
  createGuardAnswerer,
  createHeavyGuard,
  cwdFolder,
  guardMaxAgeMs,
  guardResponse,
  readPackageScripts,
  settleHeavyGuard,
  splitShell
} from './heavyGuard'

const MIN = 60_000
const NOW = 1_800_000_000_000
const MAX_AGE = 65_000
const PATTERNS = DEFAULT_SETTINGS.heavyPatterns
const CWD = 'C:\\work\\shop-web'
const GB = 1024 ** 3

/** 도는 무거운 작업 한 줄. 명령줄·경로는 에이전트에게 보이면 안 되는 값이라 일부러 눈에 띄게 둔다. */
function job(label: string, pid = 8000): HeavyJobRow {
  return {
    pid,
    label,
    processName: 'node.exe',
    commandLine: `node C:\\work\\secret-repo\\node_modules\\${label}\\bin.js --project private`,
    worktree: { root: 'C:\\work\\secret-repo', branch: 'feat/secret', isLinkedWorktree: false },
    workspace: null,
    memoryBytes: 2 * GB,
    commitBytes: null,
    descendantPids: [],
    processes: [],
    startedAt: 0
  }
}

function snap(
  o: {
    level?: MemoryLevel
    jobs?: HeavyJobRow[]
    takenAt?: number
    stale?: boolean
    commit?: CommitSummary | null
  } = {}
): DashboardSnapshot {
  const level = o.level ?? 'warn'
  const usedPercent = { normal: 50.4, warn: 85.7, danger: 93.6 }[level]
  return {
    ...blankSnapshot(o.takenAt ?? NOW),
    memory: {
      totalBytes: 32 * GB,
      usedBytes: (32 * GB * usedPercent) / 100,
      usedPercent,
      availableBytes: 32 * GB * (1 - usedPercent / 100),
      level: o.commit && o.commit.level === 'danger' ? 'danger' : level,
      ramLevel: level,
      commit: o.commit ?? null,
      kernelBytes: null
    },
    heavyJobs: o.jobs ?? [job('vite build')],
    stale: o.stale ?? false
  }
}

function bash(command: unknown, over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    session_id: 's1',
    transcript_path: 'C:\\Users\\dev\\.claude\\projects\\x.jsonl',
    cwd: CWD,
    hook_event_name: 'PreToolUse',
    tool_name: 'Bash',
    tool_input: { command, description: 'Type check' },
    ...over
  }
}

type Guard = ReturnType<typeof createHeavyGuard>

function ask(
  guard: Guard,
  event: Record<string, unknown>,
  snapshot: DashboardSnapshot | null = snap(),
  now = NOW
): ReturnType<Guard['decide']> {
  return guard.decide({ event, snapshot, patterns: PATTERNS, now, maxAgeMs: MAX_AGE })
}

const noScripts = (): null => null

const deferText = (running: string, percent: number): string =>
  `pitwall: 지금 다른 무거운 작업(${running})이 돌고 있고 메모리 사용률이 ${percent}% 예요. 이 명령은 지금 실행하지 말고 1분쯤 뒤에 같은 명령을 다시 실행해 주세요. 그동안 다른 일을 먼저 해도 돼요. 검사를 건너뛰지는 마세요.`

describe('셸 명령 나누기', () => {
  test('따옴표 밖의 &&·||·;·|·줄바꿈으로 나누고, 빈 조각은 버린다', () => {
    expect(
      splitShell('cd web && npx vue-tsc --noEmit || echo fail; npm test | tee out\nnpx tsc')
    ).toEqual(['cd web', 'npx vue-tsc --noEmit', 'echo fail', 'npm test', 'tee out', 'npx tsc'])
    expect(splitShell('  ;; && ')).toEqual([])
    expect(splitShell('')).toEqual([])
  })

  test('따옴표 안의 연산자·줄바꿈은 나누지 않는다(\\" 이스케이프 포함)', () => {
    expect(splitShell('echo "a && tsc; b" && git commit -m \'x | y\'')).toEqual([
      'echo "a && tsc; b"',
      "git commit -m 'x | y'"
    ])
    expect(splitShell('git commit -m "say \\"hi && tsc\\"" ; ls')).toEqual([
      'git commit -m "say \\"hi && tsc\\""',
      'ls'
    ])
    expect(splitShell('git commit -m "$(cat <<\'EOF\'\ntsc fix\nEOF\n)"')).toHaveLength(1)
  })

  test('히어독 본문은 명령이 아니다(조각에 넣지 않는다)', () => {
    expect(
      splitShell("cat > notes.md <<'EOF'\ntsc --noEmit\nvite build\nEOF\nnpx eslint .")
    ).toEqual(["cat > notes.md <<'EOF'", 'npx eslint .'])
    expect(splitShell('cat <<-END\n\ttsc\n\tEND\nls')).toEqual(['cat <<-END', 'ls'])
    // 끝 표시가 없으면 끝까지 본문.
    expect(splitShell('cat <<EOF\ntsc')).toEqual(['cat <<EOF'])
  })

  test('히어독은 따옴표 안에서도 알아보고(<<\\EOF·<<-EOF·따옴표 끝 표시), 본문 줄은 조각이 아니다', () => {
    // Claude 의 커밋 모양: 큰따옴표 안 명령 치환 안의 히어독. 본문에 " 가 홀수 개여도 본문은 명령이 아니다.
    const commit =
      'git commit -m "$(cat <<\'EOF\'\nfix: 27" 모니터 지원\ntsc --noEmit 오류를 고침\n\nCo-Authored-By: dev\nEOF\n)"'
    const pieces = splitShell(commit)
    expect(pieces).toHaveLength(1)
    expect(pieces[0]).not.toContain('tsc')
    expect(splitShell('cat <<\\EOF\ntsc\nEOF\nls')).toEqual(['cat <<\\EOF', 'ls'])
    expect(splitShell('cat <<"END"\nvite build\nEND\nls')).toEqual(['cat <<"END"', 'ls'])
    expect(splitShell("echo '<<EOF'\ntsc\nEOF\nls")).toEqual(["echo '<<EOF'", 'ls'])
    // 따옴표 안에서 끝 표시가 나오지 않으면 나머지를 모두 건너뛴다(놓칠 뿐, 잘못 알아보지 않는다).
    const open = splitShell('git commit -m "$(cat <<\'EOF\'\nnpx tsc\n)" && npx vue-tsc')
    expect(open).toHaveLength(1)
    expect(open[0]).not.toContain('tsc')
  })

  test('명령 치환($(…)·`…`) 안은 나누지도 보지도 않는다(알려진 놓침)', () => {
    expect(splitShell('x=$(cd web && npx tsc --noEmit) && echo $x')).toEqual([
      'x=$(cd web && npx tsc --noEmit)',
      'echo $x'
    ])
    expect(splitShell('echo `npx tsc; vite build` | tee out')).toEqual([
      'echo `npx tsc; vite build`',
      'tee out'
    ])
    expect(splitShell('echo "$(a ")" b; c)" ; ls')).toEqual(['echo "$(a ")" b; c)"', 'ls'])
  })
})

describe('무거운 작업 겹침 판단', () => {
  test('무거운 작업이 돌고 있고 메모리가 경고면 미루게 한다', () => {
    const guard = createHeavyGuard({ readScripts: noScripts })
    expect(ask(guard, bash('npx vue-tsc --noEmit'))).toEqual({
      kind: 'defer',
      pattern: 'vue-tsc',
      reason: deferText('vite build', 85)
    })
    // PowerShell 도구도 같다.
    expect(ask(guard, bash('npx tsc -b', { tool_name: 'PowerShell', session_id: 's2' }))).toEqual({
      kind: 'defer',
      pattern: 'tsc',
      reason: deferText('vite build', 85)
    })
  })

  test('알리는 것은 도는 작업의 패턴 이름(셋까지, 나머지는 개수)과 숫자 하나뿐이다', () => {
    const guard = createHeavyGuard({ readScripts: noScripts })
    const jobs = ['vite build', 'tsc', 'webpack', 'vite build', 'next build', 'mvn'].map((l, i) =>
      job(l, 9000 + i)
    )
    const v = ask(guard, bash('npx vue-tsc --noEmit'), snap({ jobs }))
    expect(v).toEqual({
      kind: 'defer',
      pattern: 'vue-tsc',
      reason: deferText('vite build, tsc, webpack 외 2개', 85)
    })
    const reason = v.kind === 'defer' ? v.reason : ''
    for (const leak of ['secret', 'node_modules', 'node.exe', 'private', 'shop-web', 'Type check'])
      expect(reason).not.toContain(leak)
  })

  test('커밋 단계가 RAM 보다 높으면 커밋 사용률을 알린다', () => {
    const guard = createHeavyGuard({ readScripts: noScripts })
    const commit: CommitSummary = { usedBytes: 1, limitBytes: 1, percent: 96.4, level: 'danger' }
    expect(ask(guard, bash('npx tsc'), snap({ level: 'normal', commit }))).toMatchObject({
      kind: 'defer',
      reason: deferText('vite build', 96)
    })
  })

  test('메모리가 정상이면 끼어들지 않는다', () => {
    const guard = createHeavyGuard({ readScripts: noScripts })
    expect(ask(guard, bash('npx vue-tsc --noEmit'), snap({ level: 'normal' }))).toEqual({
      kind: 'none'
    })
  })

  test('도는 무거운 작업이 없으면 끼어들지 않는다', () => {
    const guard = createHeavyGuard({ readScripts: noScripts })
    expect(ask(guard, bash('npx vue-tsc --noEmit'), snap({ level: 'danger', jobs: [] }))).toEqual({
      kind: 'none'
    })
  })

  test('스냅샷이 없거나 stale 이거나 오래됐으면 끼어들지 않는다', () => {
    const guard = createHeavyGuard({ readScripts: noScripts })
    const event = bash('npx vue-tsc --noEmit')
    expect(ask(guard, event, null)).toEqual({ kind: 'none' })
    expect(ask(guard, event, snap({ stale: true }))).toEqual({ kind: 'none' })
    expect(ask(guard, event, snap({ takenAt: NOW - MAX_AGE - 1 }))).toEqual({ kind: 'none' })
    // 딱 기준 나이까지는 쓴다.
    expect(ask(guard, event, snap({ takenAt: NOW - MAX_AGE })).kind).toBe('defer')
  })

  test('cd shop-web && npx vue-tsc --noEmit 도 알아본다', () => {
    const guard = createHeavyGuard({ readScripts: noScripts })
    expect(ask(guard, bash('cd shop-web && npx vue-tsc --noEmit'))).toMatchObject({
      kind: 'defer',
      pattern: 'vue-tsc'
    })
    expect(
      ask(guard, bash('cd shop-web; npx vue-tsc --noEmit', { tool_name: 'PowerShell' }))
    ).toMatchObject({ kind: 'defer', pattern: 'vue-tsc' })
  })

  test('git commit -m "fix tsc" 는 무거운 명령이 아니다', () => {
    const guard = createHeavyGuard({ readScripts: noScripts })
    for (const command of [
      'git commit -m "fix tsc"',
      'echo "a && tsc --noEmit"',
      "cat > notes.md <<'EOF'\ntsc --noEmit\nEOF",
      'code tsconfig.json'
    ])
      expect({ command, verdict: ask(guard, bash(command)) }).toEqual({
        command,
        verdict: { kind: 'none' }
      })
  })

  test('Claude 의 커밋 모양(본문에 " 가 홀수 개, 패턴 이름으로 시작하는 줄)은 무거운 명령이 아니다', () => {
    const guard = createHeavyGuard({ readScripts: noScripts })
    const commit =
      'git commit -m "$(cat <<\'EOF\'\nfix: 27" 모니터 지원\ntsc --noEmit 오류를 고침\nvite build 도 확인\n\nCo-Authored-By: dev\nEOF\n)"'
    expect(ask(guard, bash(commit))).toEqual({ kind: 'none' })
  })

  test('따옴표 안의 명령 이름·검색어·파일 이름은 무거운 명령이 아니다', () => {
    const guard = createHeavyGuard({ readScripts: () => ({ build: 'vite build' }) })
    for (const command of ['echo "npm run build"', 'grep -r "vite build" .', 'cat package.json'])
      expect({ command, verdict: ask(guard, bash(command)) }).toEqual({
        command,
        verdict: { kind: 'none' }
      })
  })

  test('환경 변수를 앞에 둔 명령(CI=1 npx tsc)도 알아본다', () => {
    const guard = createHeavyGuard({ readScripts: noScripts })
    expect(ask(guard, bash('CI=1 npx tsc'))).toMatchObject({ kind: 'defer', pattern: 'tsc' })
  })

  test('명령 치환 안의 무거운 명령은 알아보지 않는다(알려진 놓침 — 끼어들지 않는 쪽)', () => {
    const guard = createHeavyGuard({ readScripts: noScripts })
    for (const command of [
      'x=$(cd web && npx tsc --noEmit)',
      'echo "$(npx vue-tsc --noEmit)"',
      'echo `npx tsc`',
      '$(npx tsc)'
    ])
      expect({ command, verdict: ask(guard, bash(command)) }).toEqual({
        command,
        verdict: { kind: 'none' }
      })
  })

  test('같은 세션·패턴은 두 번까지 거절하고 세 번째는 참고 문구만', () => {
    const guard = createHeavyGuard({ readScripts: noScripts })
    const event = bash('npx vue-tsc --noEmit')
    const at = (t: number): ReturnType<Guard['decide']> =>
      ask(guard, event, snap({ takenAt: t }), t)
    expect(at(NOW).kind).toBe('defer')
    expect(at(NOW + MIN).kind).toBe('defer')
    expect(at(NOW + 2 * MIN)).toEqual({
      kind: 'note',
      pattern: 'vue-tsc',
      note: 'pitwall 참고: 다른 무거운 작업(vite build)과 겹쳐 실행됐고 메모리 사용률이 85% 예요.'
    })
    expect(at(NOW + 3 * MIN).kind).toBe('note')
    // 다른 세션·다른 패턴은 따로 센다.
    expect(ask(guard, bash('npx vue-tsc --noEmit', { session_id: 's2' })).kind).toBe('defer')
    expect(ask(guard, bash('npx tsc -b')).kind).toBe('defer')
  })

  test('10분이 지나면 다시 센다', () => {
    const guard = createHeavyGuard({ readScripts: noScripts })
    const event = bash('npx vue-tsc --noEmit')
    const at = (t: number): string => ask(guard, event, snap({ takenAt: t }), t).kind
    expect(at(NOW)).toBe('defer')
    expect(at(NOW + MIN)).toBe('defer')
    expect(at(NOW + 9 * MIN)).toBe('note')
    // 첫 거절이 10분 창 밖으로 나가면 하나를 다시 쓸 수 있다.
    expect(at(NOW + 10 * MIN + 1)).toBe('defer')
    expect(at(NOW + 10 * MIN + 2)).toBe('note')
    expect(at(NOW + 30 * MIN)).toBe('defer')
    // 기본 창·횟수를 바꿀 수 있다.
    const short = createHeavyGuard({ readScripts: noScripts, windowMs: MIN, maxDefers: 1 })
    expect(ask(short, event).kind).toBe('defer')
    expect(ask(short, event, snap(), NOW + 1).kind).toBe('note')
    expect(ask(short, event, snap({ takenAt: NOW + MIN + 1 }), NOW + MIN + 1).kind).toBe('defer')
  })

  test('Bash·PowerShell 이 아니거나 command 가 문자열이 아니면 none', () => {
    const guard = createHeavyGuard({ readScripts: noScripts })
    const none = { kind: 'none' }
    expect(ask(guard, bash('npx tsc', { tool_name: 'Read' }))).toEqual(none)
    expect(ask(guard, bash('npx tsc', { tool_name: 'Task' }))).toEqual(none)
    expect(ask(guard, bash('npx tsc', { hook_event_name: 'PostToolUse' }))).toEqual(none)
    expect(ask(guard, bash(42))).toEqual(none)
    expect(ask(guard, bash(['npx', 'tsc']))).toEqual(none)
    expect(ask(guard, bash('npx tsc', { tool_input: null }))).toEqual(none)
    expect(ask(guard, bash('npx tsc', { tool_input: 'npx tsc' }))).toEqual(none)
    expect(ask(guard, bash('npx tsc', { session_id: undefined }))).toEqual(none)
    expect(ask(guard, {})).toEqual(none)
  })

  test('npm run typecheck 는 그 폴더 package.json 의 스크립트(vue-tsc --noEmit)로 알아본다', () => {
    const scripts: Record<string, Record<string, string>> = {
      [CWD]: { typecheck: 'vue-tsc --noEmit', test: 'tsc --noEmit && vitest run', lint: 'eslint .' }
    }
    const read = vi.fn((dir: string) => scripts[dir] ?? null)
    expect(commandSegments('npm run typecheck', CWD, read)).toEqual([
      'npm run typecheck',
      'vue-tsc --noEmit'
    ])
    const guard = createHeavyGuard({ readScripts: read })
    expect(ask(guard, bash('npm run typecheck'))).toMatchObject({
      kind: 'defer',
      pattern: 'vue-tsc'
    })
    expect(ask(guard, bash('npm.cmd run-script typecheck', { session_id: 's2' }))).toMatchObject({
      kind: 'defer',
      pattern: 'vue-tsc'
    })
    expect(ask(guard, bash('npm test -- --run'))).toMatchObject({ kind: 'defer', pattern: 'tsc' })
    expect(ask(guard, bash('npm run lint'))).toEqual({ kind: 'none' })
    expect(read).toHaveBeenCalledWith(CWD)
    // 작업 폴더를 모르면 스크립트를 찾지 않는다.
    read.mockClear()
    expect(commandSegments('npm run typecheck', null, read)).toEqual(['npm run typecheck'])
    expect(ask(guard, bash('npm run typecheck', { cwd: undefined, session_id: 's3' }))).toEqual({
      kind: 'none'
    })
    expect(read).not.toHaveBeenCalled()
  })

  test('cd web && pnpm build 는 web 폴더의 스크립트를 본다', () => {
    const scripts: Record<string, Record<string, string>> = {
      [CWD]: { dev: 'vite' },
      'C:\\work\\shop-web\\web': { build: 'vite build', typecheck: 'tsc' },
      'C:\\work\\api': { build: 'tsc -p .' },
      '/Users/dev/shop/web': { build: 'vite build' }
    }
    const read = vi.fn((dir: string) => scripts[dir] ?? null)
    expect(commandSegments('cd web && pnpm build', CWD, read)).toEqual([
      'cd web',
      'pnpm build',
      'vite build'
    ])
    expect(read).toHaveBeenLastCalledWith('C:\\work\\shop-web\\web')
    expect(commandSegments('cd "web" && yarn run typecheck', CWD, read)).toContain('tsc')
    expect(commandSegments('cd C:\\work\\api; bun build', CWD, read)).toContain('tsc -p .')
    expect(commandSegments('cd web && pnpm build', '/Users/dev/shop', read)).toContain('vite build')
    // cd 가 없으면 작업 폴더의 scripts — build 가 없으니 더하지 않는다.
    expect(commandSegments('pnpm build', CWD, read)).toEqual(['pnpm build'])

    const guard = createHeavyGuard({ readScripts: read })
    expect(ask(guard, bash('cd web && pnpm build'))).toMatchObject({
      kind: 'defer',
      pattern: 'vite build'
    })

    // 셸이 풀어 쓰는 글자가 든 폴더는 모르는 폴더 — 스크립트를 찾지 않는다(조각 자체는 그대로 본다).
    read.mockClear()
    for (const dir of ['$HOME/web', '`pwd`/web', '~/web', '%USERPROFILE%\\web', 'we*', 'w?b'])
      expect(commandSegments(`cd ${dir} && pnpm build && npx tsc`, CWD, read)).toEqual([
        `cd ${dir}`,
        'pnpm build',
        'npx tsc'
      ])
    // 처음이 아닌 cd 뒤로는 폴더를 모른다.
    expect(commandSegments('npm ci && cd web && pnpm build', CWD, read)).toEqual([
      'npm ci',
      'cd web',
      'pnpm build'
    ])
    // 폴더를 바꾸는 옵션(--prefix·-C·--filter 등)이 있으면 어느 scripts 인지 몰라 더하지 않는다.
    expect(commandSegments('pnpm -C web build', CWD, read)).toEqual(['pnpm -C web build'])
    expect(commandSegments('npm run build --workspace=web', CWD, read)).toEqual([
      'npm run build --workspace=web'
    ])
    expect(read).not.toHaveBeenCalled()
  })

  test('스크립트가 또 다른 스크립트를 부르면 한 단계까지만 본다', () => {
    const read = (): Record<string, string> => ({
      typecheck: 'npm run tc',
      tc: 'vue-tsc --noEmit'
    })
    expect(commandSegments('npm run typecheck', CWD, read)).toEqual([
      'npm run typecheck',
      'npm run tc'
    ])
    const guard = createHeavyGuard({ readScripts: read })
    expect(ask(guard, bash('npm run typecheck'))).toEqual({ kind: 'none' })
    expect(ask(guard, bash('npm run tc'))).toMatchObject({ kind: 'defer', pattern: 'vue-tsc' })
  })

  test('package.json 이 없거나 깨졌으면 스크립트 없이 판단한다', async () => {
    const root = await mkdtemp(join(tmpdir(), 'pitwall-guard-'))
    try {
      const dir = (name: string): string => join(root, name)
      for (const name of ['ok', 'broken', 'array', 'big', 'empty']) await mkdir(dir(name))
      await writeFile(
        join(dir('ok'), 'package.json'),
        '\uFEFF' +
          JSON.stringify({
            name: 'shop-web',
            scripts: { typecheck: 'vue-tsc --noEmit', weird: 42, nested: { a: 1 } },
            dependencies: { vue: '^3' }
          })
      )
      await writeFile(join(dir('broken'), 'package.json'), '{ "scripts": { "typecheck": ')
      await writeFile(join(dir('array'), 'package.json'), '{ "scripts": ["tsc"] }')
      await writeFile(
        join(dir('big'), 'package.json'),
        JSON.stringify({ scripts: { typecheck: 'tsc' }, pad: 'x'.repeat(1024 * 1024) })
      )

      expect(readPackageScripts(dir('ok'))).toEqual({ typecheck: 'vue-tsc --noEmit' })
      expect(readPackageScripts(dir('broken'))).toBeNull()
      expect(readPackageScripts(dir('array'))).toBeNull()
      expect(readPackageScripts(dir('big'))).toBeNull()
      expect(readPackageScripts(dir('empty'))).toBeNull()
      expect(readPackageScripts(dir('missing'))).toBeNull()
      // 상대 경로·네트워크 공유는 읽지 않는다.
      expect(readPackageScripts('ok')).toBeNull()
      expect(readPackageScripts('\\\\server\\share\\web')).toBeNull()
      // 이름이 Object 의 속성과 같아도 scripts 에 없으면 없는 것이다.
      expect(commandSegments('pnpm constructor', dir('ok'), readPackageScripts)).toEqual([
        'pnpm constructor'
      ])

      const guard = createHeavyGuard()
      expect(ask(guard, bash('npm run typecheck', { cwd: dir('ok') }))).toMatchObject({
        kind: 'defer',
        pattern: 'vue-tsc'
      })
      for (const name of ['broken', 'array', 'big', 'empty', 'missing']) {
        const event = bash('npm run typecheck', { cwd: dir(name), session_id: name })
        expect({ name, verdict: ask(guard, event) }).toEqual({ name, verdict: { kind: 'none' } })
        // 스크립트를 못 읽어도 명령 자체는 본다.
        expect(ask(guard, bash('npx tsc', { cwd: dir(name), session_id: name })).kind).toBe('defer')
      }
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  test('package.json 이 보통 파일이 아니면(링크·폴더) 열지 않는다', async () => {
    const root = await mkdtemp(join(tmpdir(), 'pitwall-guard-'))
    try {
      const real = join(root, 'real')
      await mkdir(real)
      await writeFile(join(real, 'package.json'), JSON.stringify({ scripts: { build: 'tsc' } }))
      expect(readPackageScripts(real)).toEqual({ build: 'tsc' })
      // package.json 이라는 이름의 폴더.
      const folder = join(root, 'folder')
      await mkdir(join(folder, 'package.json'), { recursive: true })
      expect(readPackageScripts(folder)).toBeNull()
      // 링크(가리키는 곳이 FIFO·장치일 수 있어 따라가지 않는다). Windows 에서 링크를 만들 권한이 없으면 건너뛴다.
      const linked = join(root, 'linked')
      await mkdir(linked)
      try {
        await symlink(join(real, 'package.json'), join(linked, 'package.json'), 'file')
      } catch {
        return
      }
      expect(readPackageScripts(linked)).toBeNull()
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  test('읽기 함수가 예외를 던져도 끼어들지 않는다(실패하면 열어 둔다)', () => {
    const guard = createHeavyGuard({
      readScripts: () => {
        throw new Error('EACCES')
      }
    })
    expect(ask(guard, bash('npm run typecheck'))).toEqual({ kind: 'none' })
  })
})

describe('훅 응답', () => {
  test('거절 응답은 permissionDecision deny, 참고 응답은 additionalContext', () => {
    const deny = guardResponse({
      kind: 'defer',
      pattern: 'tsc',
      reason: deferText('vite build', 85)
    })
    expect(JSON.parse(deny!)).toEqual({
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        permissionDecision: 'deny',
        permissionDecisionReason: deferText('vite build', 85)
      }
    })
    const note = guardResponse({ kind: 'note', pattern: 'tsc', note: '참고 문구' })
    expect(JSON.parse(note!)).toEqual({
      hookSpecificOutput: { hookEventName: 'PreToolUse', additionalContext: '참고 문구' }
    })
    expect(guardResponse({ kind: 'none' })).toBeNull()
    // 어느 셸(PowerShell 의 코드 페이지 변환 포함)을 지나도 글자가 깨지지 않게 ASCII 로만 쓴다.
    expect(deny).toMatch(/^[\x20-\x7e]+$/)
    expect(note).toMatch(/^[\x20-\x7e]+$/)
  })

  test('기록에는 작업 폴더의 이름만(전체 경로·모르는 값은 넣지 않는다)', () => {
    expect(cwdFolder({ cwd: 'C:\\work\\shop-web\\' })).toBe('shop-web')
    expect(cwdFolder({ cwd: '/Users/dev/shop-web' })).toBe('shop-web')
    expect(cwdFolder({ cwd: '' })).toBeNull()
    expect(cwdFolder({ cwd: 42 })).toBeNull()
    expect(cwdFolder({})).toBeNull()
  })
})

describe('질문 훅에 답하기', () => {
  test('스냅샷 나이 한도는 창이 닫혀 있을 때의 수집 주기 두 번 + 5초', () => {
    expect(guardMaxAgeMs(REFRESH_INTERVALS.normal)).toBe(65_000)
    expect(guardMaxAgeMs(REFRESH_INTERVALS.fast)).toBe(25_000)
    expect(guardMaxAgeMs(REFRESH_INTERVALS.saver)).toBe(245_000)
  })

  function answerer(o: {
    on: boolean
    snapshot?: DashboardSnapshot | null
    now?: number
    refresh?: Settings['refresh']
  }): {
    answer: (event: Record<string, unknown>) => string | null
    recorded: Omit<PitEvent, 'id'>[]
    decide: ReturnType<typeof vi.fn>
  } {
    const recorded: Omit<PitEvent, 'id'>[] = []
    const real = createHeavyGuard({ readScripts: noScripts })
    const decide = vi.fn((input: Parameters<typeof real.decide>[0]) => real.decide(input))
    const answer = createGuardAnswerer({
      guard: { decide },
      settings: () => ({
        heavyGuard: o.on,
        heavyPatterns: PATTERNS,
        refresh: o.refresh ?? 'normal'
      }),
      latest: () => (o.snapshot === undefined ? snap() : o.snapshot),
      now: () => o.now ?? NOW,
      record: (e) => recorded.push(e)
    })
    return { answer, recorded, decide }
  }

  test('설정이 꺼져 있으면 훅이 남아 있어도 판단하지도 기록하지도 않는다', () => {
    const { answer, recorded, decide } = answerer({ on: false })
    expect(answer(bash('npx vue-tsc --noEmit'))).toBeNull()
    expect(decide).not.toHaveBeenCalled()
    expect(recorded).toEqual([])
  })

  test('켜져 있으면 판단해 답하고, 미루게 할 때만 기록에 폴더 이름과 패턴을 남긴다', () => {
    const { answer, recorded, decide } = answerer({ on: true })
    const reply = answer(bash('npx vue-tsc --noEmit'))
    expect(JSON.parse(reply!)).toMatchObject({
      hookSpecificOutput: { permissionDecision: 'deny' }
    })
    expect(decide).toHaveBeenCalledWith(
      expect.objectContaining({ now: NOW, maxAgeMs: 65_000, patterns: PATTERNS })
    )
    expect(recorded).toEqual([{ t: NOW, kind: 'heavy-defer', where: 'shop-web', label: 'vue-tsc' }])
    // 참고 문구·끼어들지 않음은 기록하지 않는다. 작업 폴더를 모르면 where 를 넣지 않는다.
    answer(bash('npx vue-tsc --noEmit'))
    answer(bash('npx vue-tsc --noEmit'))
    expect(answer(bash('git status'))).toBeNull()
    expect(recorded).toHaveLength(2)
    answer(bash('npx tsc', { cwd: undefined }))
    expect(recorded.at(-1)).toEqual({ t: NOW, kind: 'heavy-defer', label: 'tsc' })
  })

  test('나이 한도는 지금 갱신 주기를 따른다', () => {
    const old = snap({ takenAt: NOW - 65_001 })
    expect(answerer({ on: true, snapshot: old }).answer(bash('npx tsc'))).toBeNull()
    expect(
      answerer({ on: true, snapshot: old, refresh: 'saver' }).answer(bash('npx tsc'))
    ).not.toBeNull()
  })
})

describe('설정 저장: 기다리게 하기 켜기·끄기', () => {
  const OFF: Settings = { ...DEFAULT_SETTINGS, heavyGuard: false }
  const ON: Settings = { ...DEFAULT_SETTINGS, heavyGuard: true }

  function run(
    before: Settings,
    next: Settings,
    o: { integration?: ClaudeHookState; result?: ClaudeHookActionResult } = {}
  ): { steps: string[]; outcome: ReturnType<typeof settleHeavyGuard> } {
    const steps: string[] = []
    const outcome = settleHeavyGuard({
      before,
      next,
      integration: async () => {
        steps.push('status')
        return o.integration ?? 'on'
      },
      save: async (s) => {
        steps.push(`save:${s.heavyGuard}`)
        return s
      },
      rewrite: async (on) => {
        steps.push(`rewrite:${on}`)
        return o.result ?? { status: 'done', message: 'ok' }
      }
    })
    return { steps, outcome }
  }

  test('값이 그대로면 연동 상태도 묻지 않고 저장만 한다', async () => {
    const { steps, outcome } = run(OFF, { ...OFF, ramWarnPercent: 70 })
    expect(await outcome).toEqual({ saved: { ...OFF, ramWarnPercent: 70 }, failure: null })
    expect(steps).toEqual(['save:false'])
  })

  test('연동이 꺼져 있으면 확인 창 없이 값만 저장한다', async () => {
    for (const integration of ['off', 'error'] as const) {
      const on = run(OFF, ON, { integration })
      expect(await on.outcome).toEqual({ saved: ON, failure: null })
      expect(on.steps).toEqual(['status', 'save:true'])
      const off = run(ON, OFF, { integration })
      expect(await off.outcome).toEqual({ saved: OFF, failure: null })
      expect(off.steps).toEqual(['status', 'save:false'])
    }
  })

  test('켜기: 먼저 질문 훅을 넣고(확인 창), 넣었으면 켠 값으로 저장한다', async () => {
    const { steps, outcome } = run(OFF, ON, { integration: 'partial' })
    expect(await outcome).toEqual({ saved: ON, failure: null })
    expect(steps).toEqual(['status', 'rewrite:true', 'save:true'])
  })

  test('켜기를 취소하면 끈 채로 저장한다(알릴 것 없음)', async () => {
    const { steps, outcome } = run(OFF, ON, { result: { status: 'cancelled' } })
    expect(await outcome).toEqual({ saved: OFF, failure: null })
    expect(steps).toEqual(['status', 'rewrite:true', 'save:false'])
  })

  test('켜기가 실패하면 끈 채로 저장하고 이유를 돌려준다', async () => {
    const { outcome } = run(OFF, ON, { result: { status: 'failed', message: '읽을 수 없어요' } })
    expect(await outcome).toEqual({ saved: OFF, failure: '읽을 수 없어요' })
  })

  test('끄기: 먼저 끈 값을 저장한 뒤 질문 훅을 뺄지 묻고, 취소·실패해도 끈 채로 둔다', async () => {
    const done = run(ON, OFF)
    expect(await done.outcome).toEqual({ saved: OFF, failure: null })
    expect(done.steps).toEqual(['status', 'save:false', 'rewrite:false'])
    const cancelled = run(ON, OFF, { result: { status: 'cancelled' } })
    expect(await cancelled.outcome).toEqual({ saved: OFF, failure: null })
    expect(cancelled.steps).toEqual(['status', 'save:false', 'rewrite:false'])
    const failed = run(ON, OFF, { result: { status: 'failed', message: '바뀌고 있어요' } })
    expect(await failed.outcome).toEqual({ saved: OFF, failure: '바뀌고 있어요' })
  })
})
