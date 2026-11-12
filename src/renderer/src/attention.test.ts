import { attentionItems, visibleAttention } from './attention'
import { selectionKey } from '../../shared/keys'
import { MB, agentRow, serverRow, snapshot } from './testing/fixtures'
import type { AgentRow, DashboardSnapshot, ServerRow } from '../../shared/types'

const NOW = 10_000_000

const waiter = (
  pid: number,
  stateSince: number | null,
  tool: 'claude' | 'codex' = 'claude'
): AgentRow => agentRow({ pid, tool, state: 'waiting', stateSince })

const candidate = (pid: number, port: number, idleSince: number | null, over = {}): ServerRow =>
  serverRow({ pid, ports: [port], judgement: 'candidate', idleSince, ...over })

function withMemory(s: DashboardSnapshot, level: 'normal' | 'warn' | 'danger'): DashboardSnapshot {
  return { ...s, memory: { ...s.memory, totalBytes: 16_000 * MB, usedPercent: 90, level } }
}

test('응답 대기 에이전트마다 한 줄, 오래 기다린 순, 시작 시각을 모르면 맨 뒤', () => {
  const s = snapshot({
    servers: [],
    agents: [
      waiter(1, null),
      waiter(2, NOW - 1000, 'codex'),
      waiter(3, NOW - 9000),
      agentRow({ pid: 4, state: 'working' })
    ]
  })
  const items = attentionItems(s, NOW)
  expect(items.map((i) => i.id)).toEqual(
    [3, 2, 1].map((pid) => `waiting:${selectionKey.agent(s.agents.find((a) => a.pid === pid)!)}`)
  )
  expect(items[1]).toMatchObject({ kind: 'waiting', name: 'Codex', where: 'wt-a', tone: 'warn' })
  expect(items[0].state).toBe(`${NOW - 9000}`)
})

test('스냅샷의 에이전트 순서가 바뀌어도 줄 순서는 같다', () => {
  const agents = [waiter(1, null), waiter(2, 500), waiter(3, 500), waiter(4, 100)]
  const a = attentionItems(snapshot({ servers: [], agents }), NOW).map((i) => i.id)
  const b = attentionItems(snapshot({ servers: [], agents: [...agents].reverse() }), NOW).map(
    (i) => i.id
  )
  expect(b).toEqual(a)
})

test('메모리 경고 + 후보가 있으면 정리 추천 한 줄, 그 안의 서버는 정리 후보 줄로 또 나오지 않는다', () => {
  const inRec = candidate(10, 5173, NOW - 60_000)
  // 작업 폴더를 모르면 추천에 넣지 않는다 -> 후보 줄로만.
  const outRec = candidate(11, 5174, NOW - 60_000, { worktree: null })
  const s = withMemory(snapshot({ servers: [inRec, outRec] }), 'danger')
  const items = attentionItems(s, NOW)
  expect(items.map((i) => i.kind)).toEqual(['recommend', 'candidate'])
  expect(items[0]).toMatchObject({
    tone: 'stopped',
    keys: [selectionKey.server(inRec)],
    state: `danger|${selectionKey.server(inRec)}`
  })
  expect(items[1].key).toBe(selectionKey.server(outRec))
  expect(attentionItems(withMemory(s, 'warn'), NOW)[0].tone).toBe('warn')
})

test('메모리가 정상이면 추천 줄은 없고 정리 후보 서버가 한 줄씩(이름 "Vite :5173", 메시지 "42분 동안 아무도 안 써요")', () => {
  const s = withMemory(
    snapshot({
      servers: [
        candidate(10, 5173, NOW - 42 * 60_000, { commandLine: 'node vite' }),
        candidate(11, 3000, null),
        candidate(12, 4000, NOW - 90 * 60_000),
        serverRow({ pid: 13, judgement: 'check' })
      ]
    }),
    'normal'
  )
  const items = attentionItems(s, NOW)
  expect(items.map((i) => i.kind)).toEqual(['candidate', 'candidate', 'candidate'])
  const vite = items.find((i) => i.name === 'Vite :5173')!
  expect(vite.message).toBe('42분 동안 아무도 안 써요')
  expect(vite.where).toBe('shop-web')
  // 오래된 것 먼저, 시작을 모르면 맨 뒤.
  expect(items.map((i) => i.name.split(' ')[1])).toEqual([':4000', ':5173', ':3000'])
})

test('무거운 작업 겹침은 한 줄', () => {
  const s = { ...snapshot({ servers: [] }), heavyOverlap: true }
  const items = attentionItems(s, NOW)
  expect(items).toHaveLength(1)
  expect(items[0]).toMatchObject({ id: 'overlap', kind: 'overlap', tone: 'warn' })
})

test('닫은 줄은 state 가 같은 동안 빠지고, state 가 바뀌면 다시 보인다', () => {
  const s = snapshot({ servers: [], agents: [waiter(1, 100)] })
  const [item] = attentionItems(s, NOW)
  const dismissed = new Map([[item.id, item.state]])
  expect(visibleAttention([item], dismissed)).toEqual([])
  const changed = attentionItems(snapshot({ servers: [], agents: [waiter(1, 200)] }), NOW)
  expect(visibleAttention(changed, dismissed)).toHaveLength(1)
})

test('추천을 닫아도 그 안의 서버는 후보 줄로 나오지 않는다', () => {
  const s = withMemory(snapshot({ servers: [candidate(10, 5173, 100)] }), 'warn')
  const items = attentionItems(s, NOW)
  const dismissed = new Map(items.filter((i) => i.kind === 'recommend').map((i) => [i.id, i.state]))
  expect(visibleAttention(items, dismissed)).toEqual([])
})
