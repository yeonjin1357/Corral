import { memoryMapGroups, type MapGroup } from './memoryMap'
import { selectionKey } from '../../shared/keys'
import type { AppUsage, GroupUsage, ProcessGroup } from '../../shared/types'
import { GB, MB, agentRow, heavyJob, serverRow, snapshot } from './testing/fixtures'

const WS = { root: 'C:\\work\\shop', name: 'shop', branch: 'main', outer: true }
const web = serverRow({
  pid: 1,
  memoryBytes: 1200 * MB,
  workspace: WS,
  worktree: { root: 'C:\\work\\shop\\web', branch: 'main', isLinkedWorktree: false }
})
const api = serverRow({
  pid: 2,
  memoryBytes: 800 * MB,
  workspace: null,
  worktree: { root: 'C:\\work\\api', branch: 'main', isLinkedWorktree: false }
})
const hidden = serverRow({ pid: 3, memoryBytes: 400 * MB })
const agent = agentRow({ pid: 10, memoryBytes: 300 * MB })
const job = heavyJob({ pid: 20, memoryBytes: GB })

function app(name: string, memoryBytes: number, owner: string | null = null): AppUsage {
  return { name, owner, memoryBytes, commitBytes: null, processCount: 1, exePath: null }
}
function groups(bytes: Partial<Record<ProcessGroup, number>>): GroupUsage[] {
  return (Object.keys(bytes) as ProcessGroup[]).map((group) => ({
    group,
    memoryBytes: bytes[group]!,
    commitBytes: null,
    processCount: 1
  }))
}
const group = (map: MapGroup[], key: ProcessGroup): MapGroup => map.find((g) => g.group === key)!
const sum = (g: MapGroup): number => g.tiles.reduce((n, t) => n + t.bytes, 0)

const base = snapshot({
  servers: [web, api],
  hiddenServers: [hidden],
  agents: [agent],
  heavyJobs: [job],
  apps: [app('chrome.exe', 5 * GB), app('node.exe', 2 * GB, 'Cursor.exe')],
  groups: groups({
    devServer: 2200 * MB,
    agent: 500 * MB,
    heavy: GB,
    otherApps: 7 * GB,
    system: 2 * GB
  })
})

test('2단계 합이 묶음보다 크면 줄여 맞추고 작으면 그 밖 칸', () => {
  const map = memoryMapGroups(base)
  // 개발 서버 줄 합(1200 + 800 + 숨김 400 = 2400 MB) > 묶음 2200 MB: 같은 비율로 줄인다.
  const dev = group(map, 'devServer')
  expect(dev.bytes).toBe(2200 * MB)
  expect(sum(dev)).toBeCloseTo(2200 * MB, 0)
  expect(dev.tiles.map((t) => t.bytes / (2200 * MB))).toEqual([
    expect.closeTo(1200 / 2400, 9),
    expect.closeTo(800 / 2400, 9),
    expect.closeTo(400 / 2400, 9)
  ])
  expect(dev.tiles.some((t) => t.label === '그 밖')).toBe(false)
  // 에이전트 줄 합(300 MB) < 묶음 500 MB: 남는 200 MB 는 그 밖 칸.
  const agents = group(map, 'agent')
  expect(agents.tiles.map((t) => [t.label, t.bytes, t.key])).toEqual([
    ['wt-a · Claude Code', 300 * MB, selectionKey.agent(agent)],
    ['그 밖', 200 * MB, null]
  ])
  // 시스템·공유는 한 칸. 모든 묶음에서 칸 합 = 묶음.
  expect(group(map, 'system').tiles).toHaveLength(1)
  for (const g of map) expect(sum(g)).toBeCloseTo(g.bytes, 0)
})

test('에이전트 칸은 무거운 작업을 뺀 자기 메모리(A 0.5 GB + 띄운 tsc 2 GB, B 0.5 GB)', () => {
  const a = agentRow({ pid: 10, memoryBytes: 2.5 * GB, ownMemoryBytes: 0.5 * GB })
  const b = agentRow({ pid: 11, tool: 'codex', memoryBytes: 0.5 * GB })
  const tsc = heavyJob({ pid: 12, memoryBytes: 2 * GB })
  const map = memoryMapGroups({
    ...base,
    agents: [a, b],
    heavyJobs: [tsc],
    groups: groups({
      devServer: 2200 * MB,
      agent: GB,
      heavy: 2 * GB,
      otherApps: 7 * GB,
      system: GB
    })
  })
  // 표의 메모리(2.5 GB·0.5 GB)로 묶음 1 GB 를 나누면 833 MB·167 MB 가 된다. 자기 메모리로 0.5 GB 씩.
  // 표의 값과 다른 칸만 풍선말에 "무거운 작업 제외"를 붙인다.
  expect(group(map, 'agent').tiles.map((t) => [t.key, t.bytes, t.excludesHeavy])).toEqual([
    [selectionKey.agent(a), 0.5 * GB, true],
    [selectionKey.agent(b), 0.5 * GB, false]
  ])
  expect(group(map, 'heavy').tiles.map((t) => t.bytes)).toEqual([2 * GB])
})

test('다른 앱은 큰 순 12개 + 기타 n개', () => {
  const apps = Array.from({ length: 15 }, (_, i) => app(`app${i}.exe`, (i + 1) * 100 * MB))
  const total = apps.reduce((n, a) => n + a.memoryBytes, 0)
  const map = memoryMapGroups({
    ...base,
    // 일부러 섞어 둔다.
    apps: [...apps.slice(5), ...apps.slice(0, 5)],
    groups: groups({ otherApps: total, system: GB })
  })
  const tiles = group(map, 'otherApps').tiles
  expect(tiles.map((t) => t.label)).toEqual([
    'app14',
    'app13',
    'app12',
    'app11',
    'app10',
    'app9',
    'app8',
    'app7',
    'app6',
    'app5',
    'app4',
    'app3',
    '기타 3개'
  ])
  // 기타는 남은 세 앱(100 + 200 + 300 MB)의 합.
  expect(tiles.at(-1)!.bytes).toBe(600 * MB)
  // 다른 앱 탭과 같은 이름(띄운 앱까지).
  const named = group(memoryMapGroups(base), 'otherApps').tiles.map((t) => t.label)
  expect(named).toEqual(['chrome', 'node (Cursor)'])
})

test('누를 수 있는 칸만 선택 키를 가진다', () => {
  const map = memoryMapGroups(base)
  const keyed = map.flatMap((g) => g.tiles.filter((t) => t.key != null))
  expect(keyed.map((t) => [t.label, t.key])).toEqual([
    // 개발 서버: 이름 · 작업 공간(작업 공간을 모르면 이름만).
    ['web · shop', selectionKey.server(web)],
    ['api', selectionKey.server(api)],
    ['wt-a · Claude Code', selectionKey.agent(agent)],
    ['vue-tsc', selectionKey.heavy(job)]
  ])
  // 숨긴 서버·다른 앱·그 밖·시스템은 누를 수 없다.
  expect(group(map, 'devServer').tiles[2]).toMatchObject({ key: null, label: 'shop-web' })
  expect(group(map, 'otherApps').tiles.every((t) => t.key === null)).toBe(true)
  expect(group(map, 'system').tiles).toEqual([
    expect.objectContaining({ key: null, label: '시스템·공유 메모리', bytes: 2 * GB })
  ])
  // 칸 id 는 지도 안에서 겹치지 않는다.
  const ids = map.flatMap((g) => g.tiles.map((t) => t.id))
  expect(new Set(ids).size).toBe(ids.length)
})

test('0 인 묶음은 지도에 없다', () => {
  const map = memoryMapGroups({
    ...base,
    heavyJobs: [],
    groups: groups({ devServer: 2200 * MB, agent: 0, heavy: 0, otherApps: 7 * GB, system: GB })
  })
  expect(map.map((g) => g.group)).toEqual(['devServer', 'otherApps', 'system'])
  // 전체 RAM 을 모르면(아직 수집 전) 지도가 없다.
  expect(memoryMapGroups({ ...base, memory: { ...base.memory, totalBytes: 0 } })).toEqual([])
})

test('같은 폴더의 에이전트·서버도 칸 이름으로 구분된다', () => {
  const wt = { root: 'C:\\work\\shop', branch: 'main', isLinkedWorktree: false }
  const claude = agentRow({ pid: 10, worktree: wt, tool: 'claude' })
  const codex = agentRow({ pid: 11, worktree: wt, tool: 'codex' })
  const claude2 = agentRow({ pid: 12, worktree: wt, tool: 'claude' })
  const front = serverRow({ pid: 1, ports: [5173], worktree: wt })
  const back = serverRow({ pid: 2, ports: [8081, 8082], worktree: wt })
  const map = memoryMapGroups({
    ...base,
    servers: [front, back],
    hiddenServers: [],
    agents: [claude, codex, claude2]
  })
  // 에이전트: 폴더 · 도구, 그래도 같으면 PID 까지.
  expect(group(map, 'agent').tiles.map((t) => t.label)).toEqual([
    'shop · Claude Code · PID 10',
    'shop · Codex',
    'shop · Claude Code · PID 12'
  ])
  // 개발 서버: 이름이 같으면 표의 포트 칸처럼 포트를 붙인다.
  expect(group(map, 'devServer').tiles.map((t) => t.label)).toEqual([
    'shop · :5173',
    'shop · :8081 · :8082'
  ])
})
