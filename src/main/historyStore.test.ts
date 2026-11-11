import { mkdtemp, readdir, readFile, rm, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import {
  createGroupHistory,
  createRamHistory,
  loadHistory,
  saveHistory,
  type HistoryFile
} from './historyStore'
import type { GroupPoint, GroupUsage } from '../shared/types'

const MIN = 60_000
const GB = 1024 ** 3

/** 묶음 기록 한 점(개발 서버 n GB). */
const point = (t: number, n = 1): GroupPoint => ({
  t,
  devServer: n * GB,
  agent: 2 * GB,
  heavy: 0,
  otherApps: 10 * GB,
  system: 3 * GB
})

let dir: string
let path: string
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'pitwall-history-'))
  path = join(dir, 'history.json')
})
afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
})

function file(savedAt: number): HistoryFile {
  return {
    version: 2,
    savedAt,
    ram: [{ t: savedAt - MIN, value: 71.5 }],
    groups: [point(savedAt - MIN)],
    servers: { 'server:4100:200': [{ t: savedAt - MIN, bytes: 1024 }] },
    serverMemo: { 'server:4100:200': { state: 'idle', since: savedAt - 15 * MIN } },
    agentStates: { '5000:100': { state: 'working', since: savedAt - 3 * MIN } },
    agentSeen: { '5000:100': { firstSeen: savedAt - 30 * MIN, lastWorking: savedAt - 3 * MIN } },
    events: [{ id: 1, t: savedAt - MIN, kind: 'server-start', label: ':3000' }]
  }
}

test('10분 안에 다시 켜면 정리 판단 기억을 이어 쓴다', async () => {
  const saved = file(100 * MIN)
  await saveHistory(path, saved)
  const loaded = await loadHistory(path, 109 * MIN)
  expect(loaded).toEqual({
    ram: saved.ram,
    groups: saved.groups,
    servers: saved.servers,
    serverMemo: saved.serverMemo,
    agentStates: saved.agentStates,
    agentSeen: saved.agentSeen,
    events: saved.events
  })
})

test('10분이 넘으면 판단 기억은 버리고 RAM·서버 메모리 기록만', async () => {
  const saved = file(100 * MIN)
  await saveHistory(path, saved)
  const loaded = await loadHistory(path, 111 * MIN)
  expect(loaded).toEqual({
    ram: saved.ram,
    groups: saved.groups,
    servers: saved.servers,
    serverMemo: null,
    agentStates: null,
    agentSeen: null,
    events: saved.events
  })
})

test('기록(events)은 꺼져 있던 시간과 상관없이 돌려주고, 없거나 목록이 아니면 빈 목록', async () => {
  const saved = file(100 * MIN)
  await saveHistory(path, saved)
  // 사흘 뒤에 켜도 그대로 돌려준다(24시간이 지난 것은 기록이 불러올 때 버린다).
  expect((await loadHistory(path, 100 * MIN + 3 * 24 * 60 * MIN))?.events).toEqual(saved.events)

  const older = file(100 * MIN)
  delete older.events
  await writeFile(path, JSON.stringify(older))
  expect((await loadHistory(path, 101 * MIN))?.events).toEqual([])

  await writeFile(path, JSON.stringify({ ...file(100 * MIN), events: 'x' }))
  expect((await loadHistory(path, 101 * MIN))?.events).toEqual([])
})

test('에이전트를 처음 본 기록(agentSeen)이 없는 파일(예전 저장)도 읽고, 모양이 틀린 항목은 버린다', async () => {
  const older = file(100 * MIN)
  delete older.agentSeen
  await writeFile(path, JSON.stringify(older))
  expect((await loadHistory(path, 101 * MIN))?.agentSeen).toEqual({})

  await writeFile(
    path,
    JSON.stringify({
      ...file(100 * MIN),
      agentSeen: {
        'a:1': { firstSeen: 10 * MIN, lastWorking: null },
        'b:2': { firstSeen: 10 * MIN, lastWorking: 20 * MIN, extra: 'x' },
        'c:3': { firstSeen: 'x', lastWorking: null },
        'd:4': { firstSeen: 10 * MIN, lastWorking: 'x' },
        'e:5': { firstSeen: 10 * MIN },
        'f:6': null
      }
    })
  )
  expect((await loadHistory(path, 101 * MIN))?.agentSeen).toStrictEqual({
    'a:1': { firstSeen: 10 * MIN, lastWorking: null },
    'b:2': { firstSeen: 10 * MIN, lastWorking: 20 * MIN }
  })
})

test('저장 시각이 지금보다 뒤면(시계가 바뀜) 판단 기억을 버린다', async () => {
  await saveHistory(path, file(100 * MIN))
  expect((await loadHistory(path, 90 * MIN))?.serverMemo).toBeNull()
})

test('깨진 파일·다른 버전·없는 파일은 무시', async () => {
  expect(await loadHistory(path, 0)).toBeNull()
  await writeFile(path, '{ "version": 1, "savedAt": ')
  expect(await loadHistory(path, 0)).toBeNull()
  await writeFile(path, JSON.stringify({ ...file(0), version: 3 }))
  expect(await loadHistory(path, 0)).toBeNull()
  await writeFile(path, JSON.stringify({ ...file(0), savedAt: 'x' }))
  expect(await loadHistory(path, 0)).toBeNull()
})

test('version 1 파일은 버린다', async () => {
  // 예전 형식은 서버 기록이 작업 세트다. 커밋 기록을 이어 붙이면 가짜 메모리 증가가 된다.
  await writeFile(path, JSON.stringify({ ...file(100 * MIN), version: 1 }))
  expect(await loadHistory(path, 101 * MIN)).toBeNull()
})

test('serverMemo 의 shielded 를 보존한다', async () => {
  await writeFile(
    path,
    JSON.stringify({
      ...file(100 * MIN),
      serverMemo: {
        'server:1:1': { state: 'idle', since: 99 * MIN, shielded: true },
        'server:2:2': { state: 'tabs', since: 99 * MIN, shielded: false },
        'server:3:3': { state: 'idle', since: 99 * MIN, shielded: 'yes' }
      },
      agentStates: { '5000:100': { state: 'working', since: 99 * MIN, shielded: true } }
    })
  )
  const loaded = await loadHistory(path, 101 * MIN)
  expect(loaded?.serverMemo).toStrictEqual({
    'server:1:1': { state: 'idle', since: 99 * MIN, shielded: true },
    'server:2:2': { state: 'tabs', since: 99 * MIN, shielded: false },
    // 불리언이 아니면 그 값만 버린다.
    'server:3:3': { state: 'idle', since: 99 * MIN }
  })
  // 에이전트 상태 기억에는 없는 값이다.
  expect(loaded?.agentStates).toStrictEqual({ '5000:100': { state: 'working', since: 99 * MIN } })
})

test('항목 모양이 틀린 부분은 버리고 나머지는 쓴다', async () => {
  await writeFile(
    path,
    JSON.stringify({
      ...file(100 * MIN),
      ram: [{ t: 1, value: 50 }, { t: 'x' }, null],
      serverMemo: {
        'server:1:1': { state: 'idle', since: 99 * MIN },
        'server:2:2': { state: 'gone', since: 1 },
        'server:3:3': { state: 'tabs', since: 'x' }
      },
      agentStates: { 'a:1': { state: 'nope', since: 1 } }
    })
  )
  const loaded = await loadHistory(path, 101 * MIN)
  expect(loaded?.ram).toEqual([{ t: 1, value: 50 }])
  expect(loaded?.serverMemo).toEqual({ 'server:1:1': { state: 'idle', since: 99 * MIN } })
  expect(loaded?.agentStates).toEqual({})
})

test('저장은 임시 파일에 쓰고 바꿔 넣는다(임시 파일이 남지 않는다)', async () => {
  await saveHistory(path, file(1))
  expect(await readdir(dir)).toEqual(['history.json'])
  expect(JSON.parse(await readFile(path, 'utf8')).version).toBe(2)
})

test('RAM 기록은 30초 간격·2시간만', () => {
  const ram = createRamHistory()
  for (let t = 0; t <= 150 * MIN; t += 5000) ram.record(t, 50)
  const points = ram.points()
  expect(points[0].t).toBeGreaterThanOrEqual(30 * MIN)
  expect(points[points.length - 1].t).toBe(150 * MIN)
  expect(points.every((p, i) => i === 0 || p.t - points[i - 1].t >= 30_000)).toBe(true)
  expect(points.length).toBe(241)
})

test('RAM 기록 불러오기는 2시간 안의 것만, 시간 순으로', () => {
  const ram = createRamHistory()
  ram.import(
    [
      { t: 10 * MIN, value: 3 },
      { t: 200 * MIN, value: 2 },
      { t: 190 * MIN, value: 1 }
    ],
    200 * MIN
  )
  expect(ram.points()).toEqual([
    { t: 190 * MIN, value: 1 },
    { t: 200 * MIN, value: 2 }
  ])
})

test('묶음 기록은 판 2 파일의 선택 칸 groups 로 남고 다시 읽힌다', async () => {
  const saved = file(100 * MIN)
  saved.groups = [point(98 * MIN, 1), point(99 * MIN, 2)]
  await saveHistory(path, saved)
  const raw = JSON.parse(await readFile(path, 'utf8'))
  // 판을 올리지 않는다: 예전 버전도 이 파일을 읽고 모르는 칸(groups)만 버린다.
  expect(raw.version).toBe(2)
  expect(raw.groups).toEqual(saved.groups)
  expect((await loadHistory(path, 101 * MIN))?.groups).toEqual(saved.groups)
  // 판단 기억을 버리는 10분 뒤에도 묶음 기록은 RAM 기록처럼 돌려준다.
  expect((await loadHistory(path, 200 * MIN))?.groups).toEqual(saved.groups)

  // 모양이 틀린 점은 버리고, 모르는 칸은 남기지 않는다.
  await writeFile(
    path,
    JSON.stringify({
      ...file(100 * MIN),
      groups: [
        { ...point(1), extra: 'x' },
        { ...point(2), agent: 'x' },
        { t: 3, devServer: 1 },
        { ...point(4), heavy: -1 },
        null
      ]
    })
  )
  expect((await loadHistory(path, 101 * MIN))?.groups).toStrictEqual([point(1)])
})

test('groups 가 없는 예전 파일은 빈 묶음 기록, 다른 기록은 그대로', async () => {
  const older = file(100 * MIN)
  delete older.groups
  await writeFile(path, JSON.stringify(older))
  const loaded = await loadHistory(path, 101 * MIN)
  expect(loaded?.groups).toEqual([])
  expect(loaded?.ram).toEqual(older.ram)
  expect(loaded?.servers).toEqual(older.servers)
  expect(loaded?.serverMemo).toEqual(older.serverMemo)
  expect(loaded?.events).toEqual(older.events)

  await writeFile(path, JSON.stringify({ ...file(100 * MIN), groups: 'x' }))
  expect((await loadHistory(path, 101 * MIN))?.groups).toEqual([])
})

test('묶음 기록도 30초에 한 번, 2시간까지', () => {
  const usage = (devServer: number): GroupUsage[] => [
    { group: 'devServer', memoryBytes: devServer, commitBytes: null, processCount: 1 },
    { group: 'otherApps', memoryBytes: 10 * GB, commitBytes: null, processCount: 9 },
    { group: 'system', memoryBytes: 3 * GB, commitBytes: null, processCount: 0 }
  ]
  const groups = createGroupHistory()
  for (let t = 0; t <= 150 * MIN; t += 5000) groups.record(t, usage(GB))
  const points = groups.points()
  expect(points[0].t).toBeGreaterThanOrEqual(30 * MIN)
  expect(points[points.length - 1].t).toBe(150 * MIN)
  expect(points.every((p, i) => i === 0 || p.t - points[i - 1].t >= 30_000)).toBe(true)
  expect(points.length).toBe(241)
  // 묶음별 바이트(없는 묶음은 0).
  expect(points[0]).toEqual({
    t: points[0].t,
    devServer: GB,
    agent: 0,
    heavy: 0,
    otherApps: 10 * GB,
    system: 3 * GB
  })

  // 불러오기도 RAM 처럼 2시간 안의 것만, 시간 순으로.
  groups.import([point(10 * MIN), point(200 * MIN, 3), point(190 * MIN, 2)], 200 * MIN)
  expect(groups.points()).toEqual([point(190 * MIN, 2), point(200 * MIN, 3)])
})
