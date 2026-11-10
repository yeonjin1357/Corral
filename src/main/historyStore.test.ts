import { mkdtemp, readdir, readFile, rm, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import { createRamHistory, loadHistory, saveHistory, type HistoryFile } from './historyStore'

const MIN = 60_000

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
