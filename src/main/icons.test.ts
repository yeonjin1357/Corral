import { createIconSource, iconPathsOf } from './icons'
import { blankSnapshot } from '../shared/snapshot'
import type { DashboardSnapshot } from '../shared/types'

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
const GATEWAY = 'C:\\work\\gateway\\gateway.exe'

function snap(): DashboardSnapshot {
  return {
    ...blankSnapshot(1),
    platform: 'win32',
    apps: [{ name: 'chrome.exe', memoryBytes: 1, processCount: 1, exePath: CHROME }],
    servers: [
      {
        ports: [8080],
        pid: 1,
        processName: 'gateway.exe',
        commandLine: `"${GATEWAY}" --port 8080`,
        worktree: null,
        workspace: null,
        unresolvable: false,
        memoryBytes: 1,
        descendantPids: [],
        processes: [],
        clientCount: 0,
        startedAt: null,
        judgement: null,
        idleSince: null,
        agentInWorktree: false,
        cpuPercent: null,
        memoryGrowth: null
      }
    ]
  }
}

test('숨긴 서버의 실행 파일도 아이콘을 준다(숨긴 서버 표에 보이므로)', () => {
  const s = snap()
  expect([...iconPathsOf({ ...s, servers: [], hiddenServers: s.servers })]).toContain(GATEWAY)
})

test('아이콘을 줄 수 있는 경로는 지금 스냅샷에 나온 실행 파일뿐(다른 앱·포트·남은 프로세스·무거운 작업)', () => {
  expect([...iconPathsOf(snap())].sort()).toEqual([CHROME, GATEWAY].sort())
  expect(iconPathsOf(null).size).toBe(0)
})

describe('아이콘 가져오기', () => {
  const png = 'data:image/png;base64,AAAA'
  test('스냅샷에 없는 경로는 OS 에 묻지 않고 null', async () => {
    const getFileIcon = vi.fn(async () => ({ isEmpty: () => false, toDataURL: () => png }))
    const icons = createIconSource({ latest: snap, getFileIcon })
    expect(await icons.get('C:\\Windows\\System32\\cmd.exe')).toBeNull()
    expect(await icons.get(42 as unknown as string)).toBeNull()
    expect(getFileIcon).not.toHaveBeenCalled()
  })

  test('있는 경로는 OS 아이콘을 PNG 데이터 주소로, 두 번째부터는 기억한 값', async () => {
    const getFileIcon = vi.fn(async () => ({ isEmpty: () => false, toDataURL: () => png }))
    const icons = createIconSource({ latest: snap, getFileIcon })
    expect(await icons.get(CHROME)).toBe(png)
    expect(await icons.get(CHROME)).toBe(png)
    expect(getFileIcon).toHaveBeenCalledTimes(1)
  })

  test('빈 아이콘이거나 실패하면 null(화면은 기본 아이콘)', async () => {
    const empty = createIconSource({
      latest: snap,
      getFileIcon: async () => ({ isEmpty: () => true, toDataURL: () => png })
    })
    expect(await empty.get(CHROME)).toBeNull()
    const failing = createIconSource({
      latest: snap,
      getFileIcon: async () => {
        throw new Error('no file')
      }
    })
    expect(await failing.get(GATEWAY)).toBeNull()
  })
})
