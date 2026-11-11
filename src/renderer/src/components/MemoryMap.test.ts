// @vitest-environment happy-dom
import { mount, type VueWrapper } from '@vue/test-utils'
import { nextTick } from 'vue'
import MemoryMap from './MemoryMap.vue'
import { selectionKey } from '../../../shared/keys'
import type { DashboardSnapshot } from '../../../shared/types'
import { GB, MB, agentRow, heavyJob, serverRow, snapshot } from '../testing/fixtures'

// happy-dom 은 배치를 하지 않아 너비가 0 이다. 지도를 그리도록 너비를 준다.
const original = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'clientWidth')
beforeEach(() => {
  Object.defineProperty(HTMLElement.prototype, 'clientWidth', {
    configurable: true,
    get: () => 400
  })
})
afterEach(() => {
  if (original) Object.defineProperty(HTMLElement.prototype, 'clientWidth', original)
  document.body.innerHTML = ''
})

const web = serverRow({ pid: 1, memoryBytes: 2 * GB })
const hidden = serverRow({ pid: 3, memoryBytes: GB })
const agent = agentRow({ pid: 10, memoryBytes: 2 * GB })
/** 지도에서 아주 작은 칸(글자 없이 풍선말만). */
const tiny = heavyJob({ pid: 20, memoryBytes: 2 * MB })

const s = snapshot({
  servers: [web],
  hiddenServers: [hidden],
  agents: [agent],
  heavyJobs: [tiny],
  groups: [
    { group: 'devServer', memoryBytes: 3 * GB, commitBytes: null, processCount: 2 },
    { group: 'agent', memoryBytes: 2 * GB, commitBytes: null, processCount: 3 },
    { group: 'heavy', memoryBytes: 2 * MB, commitBytes: null, processCount: 1 },
    { group: 'otherApps', memoryBytes: 7 * GB, commitBytes: null, processCount: 50 },
    { group: 'system', memoryBytes: 2 * GB, commitBytes: null, processCount: 0 }
  ]
})

async function map(snap: DashboardSnapshot): Promise<VueWrapper> {
  const w = mount(MemoryMap, { attachTo: document.body, props: { snapshot: snap } })
  await nextTick()
  return w
}

test('칸을 누르면 그 줄의 키로 select', async () => {
  const w = await map(s)
  const buttons = w.findAll('button[data-map-tile]')
  // 누를 수 있는 칸(서버·에이전트·무거운 작업)만 버튼이고, 이름(aria-label)이 있다.
  expect(buttons.map((b) => b.attributes('data-map-tile')).sort()).toEqual(
    [selectionKey.server(web), selectionKey.agent(agent), selectionKey.heavy(tiny)].sort()
  )
  for (const b of buttons) expect(b.attributes('aria-label')).toMatch(/GB|MB/)

  await w.find(`button[data-map-tile="${selectionKey.server(web)}"]`).trigger('click')
  await w.find(`button[data-map-tile="${selectionKey.agent(agent)}"]`).trigger('click')
  expect(w.emitted('select')).toEqual([[selectionKey.server(web)], [selectionKey.agent(agent)]])

  // 숨긴 서버·다른 앱·시스템 칸은 누를 수 없고 초점도 받지 않는다(풍선말만).
  const still = w.findAll('[data-map-tile]:not(button)')
  expect(still.length).toBeGreaterThan(0)
  for (const tile of still) {
    expect(tile.attributes('tabindex')).toBeUndefined()
    expect(tile.attributes('title')).toBeTruthy()
  }
  await still[0].trigger('click')
  expect(w.emitted('select')).toHaveLength(2)

  // 작은 칸은 글자를 숨기고 풍선말로.
  const small = w.find(`[data-map-tile="${selectionKey.heavy(tiny)}"]`)
  expect(small.text()).toBe('')
  expect(small.attributes('title')).toContain('vue-tsc')
  // 넓은 칸에는 이름이 보인다.
  expect(w.find(`[data-map-tile="${selectionKey.server(web)}"]`).text()).toContain('shop-web')
  w.unmount()
})

test('에이전트 칸이 표의 메모리와 다르면(무거운 작업을 뺌) 풍선말·이름에 그렇게 적는다', async () => {
  const heavyParent = agentRow({ pid: 10, memoryBytes: 4 * GB, ownMemoryBytes: GB })
  const plain = agentRow({ pid: 11, tool: 'codex', memoryBytes: GB })
  const w = await map({ ...s, agents: [heavyParent, plain] })
  const tile = w.find(`button[data-map-tile="${selectionKey.agent(heavyParent)}"]`)
  expect(tile.attributes('title')).toContain('1.0 GB (무거운 작업 제외) · 전체 RAM 의')
  expect(tile.attributes('aria-label')).toBe(tile.attributes('title'))
  // 표의 값과 같은 칸은 그대로.
  const other = w.find(`button[data-map-tile="${selectionKey.agent(plain)}"]`)
  expect(other.attributes('title')).toContain('1.0 GB · 전체 RAM 의')
  expect(other.attributes('title')).not.toContain('무거운 작업 제외')
  w.unmount()
})

test('누를 수 있는 아주 작은 칸도 사방 2px 이상(초점 표시가 보이게)', async () => {
  const speck = heavyJob({ pid: 21, memoryBytes: 64 * 1024 })
  const w = await map({
    ...s,
    heavyJobs: [speck],
    groups: s.groups.map((g) => (g.group === 'heavy' ? { ...g, memoryBytes: 64 * 1024 } : g))
  })
  const tile = w.find(`button[data-map-tile="${selectionKey.heavy(speck)}"]`)
  const style = (tile.element as HTMLElement).style
  expect(parseFloat(style.width)).toBeGreaterThanOrEqual(2)
  expect(parseFloat(style.height)).toBeGreaterThanOrEqual(2)
  // 칸이 지도 밖으로 나가지 않는다.
  expect(parseFloat(style.left)).toBeGreaterThanOrEqual(0)
  expect(parseFloat(style.top)).toBeGreaterThanOrEqual(0)
  w.unmount()
})
