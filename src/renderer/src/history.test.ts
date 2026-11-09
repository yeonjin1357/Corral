import { agentKey, appendSnapshot, emptyHistory, selectionKey } from './history'
import { agentRow, leftoverRow, serverRow, snapshot } from './testing/fixtures'

test('서버별 하트비트: 연결 있으면 up, 없으면 idle, 최신이 맨 뒤', () => {
  let h = emptyHistory()
  h = appendSnapshot(h, snapshot({ takenAt: 1, servers: [serverRow({ clientCount: 1 })] }))
  h = appendSnapshot(h, snapshot({ takenAt: 2, servers: [serverRow({ clientCount: 0 })] }))
  expect(h.servers[selectionKey.server(serverRow())].beats).toEqual(['up', 'idle'])
  expect(h.servers[selectionKey.server(serverRow())].memory.map((p) => p.t)).toEqual([1, 2])
})

test('RAM 추이는 사용률(%)로 쌓는다', () => {
  let h = emptyHistory()
  h = appendSnapshot(h, snapshot({ takenAt: 1 }))
  expect(h.ram).toEqual([{ t: 1, value: 82.2 }])
})

test('같은 takenAt 스냅샷(getLatest 와 구독이 같은 것을 줄 때)은 한 번만 쌓는다', () => {
  let h = emptyHistory()
  h = appendSnapshot(h, snapshot({ takenAt: 5 }))
  h = appendSnapshot(h, snapshot({ takenAt: 5 }))
  expect(h.ram).toHaveLength(1)
})

test('지연(stale) 스냅샷은 옛 데이터의 반복이라 쌓지 않는다', () => {
  let h = emptyHistory()
  h = appendSnapshot(h, snapshot({ takenAt: 1 }))
  h = appendSnapshot(h, snapshot({ takenAt: 1, stale: true, error: 'timeout' }))
  h = appendSnapshot(h, snapshot({ takenAt: 9, stale: true, error: 'timeout' }))
  expect(h.ram).toHaveLength(1)
})

test('개수 제한: 하트비트 60개, 그래프 점 120개', () => {
  let h = emptyHistory()
  for (let i = 1; i <= 130; i++) h = appendSnapshot(h, snapshot({ takenAt: i }))
  const p = h.servers[selectionKey.server(serverRow())]
  expect(p.beats).toHaveLength(60)
  expect(p.memory).toHaveLength(120)
  expect(p.memory[0].t).toBe(11)
  expect(h.ram).toHaveLength(120)
})

test('사라진 서버의 기록은 지운다(다른 pid 가 열면 새 기록)', () => {
  let h = emptyHistory()
  h = appendSnapshot(h, snapshot({ takenAt: 1, servers: [serverRow({ pid: 1 })] }))
  h = appendSnapshot(h, snapshot({ takenAt: 2, servers: [serverRow({ pid: 2 })] }))
  expect(Object.keys(h.servers)).toEqual([selectionKey.server(serverRow({ pid: 2 }))])
  expect(h.servers[selectionKey.server(serverRow({ pid: 2 }))].beats).toHaveLength(1)
})

test('원래 기록 객체는 바꾸지 않는다(Vue 반응성이 새 객체로 바뀐 것을 알도록)', () => {
  const h = appendSnapshot(emptyHistory(), snapshot({ takenAt: 1 }))
  const before = JSON.stringify(h)
  appendSnapshot(h, snapshot({ takenAt: 2 }))
  expect(JSON.stringify(h)).toBe(before)
})

describe('에이전트 기록', () => {
  test('상태를 하트비트로: 작업 중 up, 권한 대기 pending, 오류 down, 쉬는 중·확인 중 idle', () => {
    let h = emptyHistory()
    const states = ['working', 'waiting', 'error', 'idle', 'unknown'] as const
    states.forEach((state, i) => {
      h = appendSnapshot(h, snapshot({ takenAt: i + 1, agents: [agentRow({ state })] }))
    })
    const a = h.agents[agentKey(agentRow())]
    expect(a.beats).toEqual(['up', 'pending', 'down', 'idle', 'idle'])
    expect(a.memory.map((p) => p.t)).toEqual([1, 2, 3, 4, 5])
  })

  test('같은 pid 라도 시작 시각이 다르면 다른 기록, 사라진 에이전트 기록은 지운다', () => {
    let h = emptyHistory()
    h = appendSnapshot(h, snapshot({ takenAt: 1, agents: [agentRow({ startedAt: 1 })] }))
    h = appendSnapshot(h, snapshot({ takenAt: 2, agents: [agentRow({ startedAt: 2 })] }))
    expect(Object.keys(h.agents)).toEqual([agentKey(agentRow({ startedAt: 2 }))])
  })
})

test('고른 항목 키는 종류를 앞에 붙여 서로 겹치지 않는다', () => {
  expect(selectionKey.server(serverRow())).toBe('server:4100:200')
  expect(selectionKey.agent(agentRow())).toBe('agent:5000:100')
  expect(selectionKey.leftover(leftoverRow())).toBe('leftover:7000:300')
})
