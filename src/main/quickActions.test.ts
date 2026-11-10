import { createQuickActions, isQuickKind, knownPaths } from './quickActions'
import { blankSnapshot } from '../shared/snapshot'
import type {
  AgentRow,
  DashboardSnapshot,
  DiskRow,
  HeavyJobRow,
  LeftoverRow,
  Platform,
  ServerRow,
  WorkspaceInfo,
  WorktreeInfo
} from '../shared/types'

const SHOP = 'C:\\work\\shop-web'
/** 띄어쓰기·& 가 든 경로(셸 문자열로 만들면 명령이 갈라진다). */
const ODD = 'C:\\work\\shop web & co'
const MAC = '/Users/dev/shop web & co'

const wt = (root: string): WorktreeInfo => ({ root, branch: 'main', isLinkedWorktree: false })
const ws = (root: string): WorkspaceInfo => ({ root, name: 'ws', branch: 'main', outer: true })

function snap(platform: Platform = 'win32'): DashboardSnapshot {
  return {
    ...blankSnapshot(1),
    platform,
    servers: [
      { worktree: wt(SHOP), workspace: ws('C:\\work\\ws') } as ServerRow,
      // 판별 불가(중계 서버 등): 폴더를 모른다.
      { worktree: null, workspace: null } as ServerRow
    ],
    hiddenServers: [{ worktree: wt('C:\\work\\hidden'), workspace: null } as ServerRow],
    agents: [
      { worktree: wt(ODD), workspace: null } as AgentRow,
      { worktree: wt(MAC), workspace: null } as AgentRow
    ],
    leftovers: [{ worktree: wt('C:\\work\\left'), workspace: null } as LeftoverRow],
    heavyJobs: [{ worktree: wt('C:\\work\\heavy'), workspace: null } as HeavyJobRow],
    disk: {
      rows: [{ worktreeRoot: 'C:\\work\\old-feature' } as DiskRow],
      scannedAt: 1,
      scanning: false,
      error: null
    }
  }
}

interface SpawnCall {
  command: string
  args: string[]
  options: { cwd?: string; detached: true; stdio: 'ignore' }
}

/** 실제로 띄우지 않는 가짜 의존성. failing 에 든 명령은 띄우지 못한다(없는 프로그램·없는 폴더). */
function fakes(
  over: {
    platform?: Platform
    failing?: string[]
    openPathError?: string
    latest?: DashboardSnapshot | null
  } = {}
): {
  quick: ReturnType<typeof createQuickActions>
  spawned: SpawnCall[]
  unrefs: number[]
  clipboard: string[]
  opened: string[]
} {
  const spawned: SpawnCall[] = []
  const unrefs: number[] = []
  const clipboard: string[] = []
  const opened: string[] = []
  const latest = over.latest === undefined ? snap(over.platform) : over.latest
  const quick = createQuickActions({
    latest: () => latest,
    platform: over.platform ?? 'win32',
    openPath: async (p) => {
      opened.push(p)
      return over.openPathError ?? ''
    },
    writeClipboard: (t) => {
      clipboard.push(t)
    },
    spawn: (command, args, options) => {
      const index = spawned.push({ command, args, options }) - 1
      const fails = over.failing?.includes(command) ?? false
      return {
        // Node 처럼 띄우기 결과는 다음 차례에 알린다.
        on: (event, cb) => {
          if ((event === 'error') === fails) queueMicrotask(cb)
        },
        unref: () => {
          unrefs.push(index)
        }
      }
    }
  })
  return { quick, spawned, unrefs, clipboard, opened }
}

test('스냅샷에 없는 경로는 열지 않는다', async () => {
  const f = fakes()
  expect(await f.quick.run('folder', 'C:\\Windows\\System32')).toBe(false)
  expect(await f.quick.run('terminal', 'C:\\Windows\\System32')).toBe(false)
  expect(await f.quick.run('copy', 'C:\\Windows\\System32')).toBe(false)
  // 아는 폴더의 하위·상위 폴더도 아니다.
  expect(await f.quick.run('folder', `${SHOP}\\src`)).toBe(false)
  expect(await f.quick.run('folder', 'C:\\work')).toBe(false)
  expect(await f.quick.run('folder', `${SHOP}\\..\\..\\Windows`)).toBe(false)
  expect(await f.quick.run('folder', '')).toBe(false)
  expect([f.opened, f.spawned, f.clipboard]).toEqual([[], [], []])
  // 스냅샷이 아직 없으면 아무것도 열지 않는다.
  const none = fakes({ latest: null })
  expect(await none.quick.run('folder', SHOP)).toBe(false)
  expect(none.opened).toEqual([])
})

test('대소문자·끝 구분자가 달라도 같은 경로로 본다', async () => {
  const f = fakes()
  expect(await f.quick.run('folder', 'c:\\WORK\\Shop-Web\\')).toBe(true)
  expect(await f.quick.run('folder', 'C:\\work\\shop-web/')).toBe(true)
  // 여는 것은 화면이 준 표기가 아니라 스냅샷의 경로다.
  expect(f.opened).toEqual([SHOP, SHOP])
})

test('Windows 는 wt.exe -d 경로, 없으면 cmd 를 그 폴더에서', async () => {
  // 경로는 명령줄에 넣지 않고 작업 폴더(cwd)로만 넘긴다(wt 는 "-d ." 로 그 폴더에서 연다).
  const wtOnly = fakes()
  expect(await wtOnly.quick.run('terminal', ODD)).toBe(true)
  expect(wtOnly.spawned).toEqual([
    { command: 'wt.exe', args: ['-d', '.'], options: { cwd: ODD, detached: true, stdio: 'ignore' } }
  ])
  expect(wtOnly.unrefs).toEqual([0])

  const noWt = fakes({ failing: ['wt.exe'] })
  expect(await noWt.quick.run('terminal', ODD)).toBe(true)
  expect(noWt.spawned.map((c) => c.command)).toEqual(['wt.exe', 'cmd.exe'])
  // cmd 는 start 로 새 콘솔 창을 연다(인자는 고정, 경로는 cwd 로만).
  expect(noWt.spawned[1]).toEqual({
    command: 'cmd.exe',
    args: ['/c', 'start', 'cmd.exe'],
    options: { cwd: ODD, detached: true, stdio: 'ignore' }
  })
  for (const call of [...wtOnly.spawned, ...noWt.spawned]) {
    expect(call.args.join(' ')).not.toContain('&')
    expect(call.args.join(' ')).not.toContain('shop web')
  }

  // 폴더가 없어져 둘 다 띄우지 못하면 false(화면이 실패를 알린다).
  const gone = fakes({ failing: ['wt.exe', 'cmd.exe'] })
  expect(await gone.quick.run('terminal', ODD)).toBe(false)
})

test('macOS 는 open -a Terminal 경로', async () => {
  const f = fakes({ platform: 'darwin' })
  expect(await f.quick.run('terminal', `${MAC}/`)).toBe(true)
  // 경로는 띄어쓰기·& 가 있어도 인자 하나로 그대로 넘긴다(셸을 거치지 않는다).
  expect(f.spawned).toEqual([
    {
      command: '/usr/bin/open',
      args: ['-a', 'Terminal', MAC],
      options: { detached: true, stdio: 'ignore' }
    }
  ])
  expect(f.unrefs).toEqual([0])
  expect(
    await fakes({ platform: 'darwin', failing: ['/usr/bin/open'] }).quick.run('terminal', MAC)
  ).toBe(false)
})

test('복사는 스냅샷의 경로 그대로', async () => {
  const f = fakes()
  expect(await f.quick.run('copy', 'c:\\work\\SHOP-WEB\\\\')).toBe(true)
  expect(f.clipboard).toEqual([SHOP])
  expect([f.opened, f.spawned]).toEqual([[], []])
})

test('폴더를 열지 못하면(OS 가 오류를 알리면) false', async () => {
  const f = fakes({ openPathError: 'Failed to open path' })
  expect(await f.quick.run('folder', SHOP)).toBe(false)
})

test('아는 경로: 서버(숨긴 것 포함)·에이전트·남은 프로세스·무거운 작업의 워크트리, 작업 공간, 디스크 행', () => {
  expect(knownPaths(snap()).sort()).toEqual(
    [
      SHOP,
      'C:\\work\\ws',
      'C:\\work\\hidden',
      ODD,
      MAC,
      'C:\\work\\left',
      'C:\\work\\heavy',
      'C:\\work\\old-feature'
    ].sort()
  )
  expect(knownPaths(null)).toEqual([])
})

test('화면이 보낸 동작 이름은 셋 가운데 하나만 받는다', () => {
  expect(['copy', 'folder', 'terminal'].every(isQuickKind)).toBe(true)
  expect(isQuickKind('exec')).toBe(false)
  expect(isQuickKind(undefined)).toBe(false)
  expect(isQuickKind(['folder'])).toBe(false)
})
