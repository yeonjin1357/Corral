// @vitest-environment happy-dom
import { mount } from '@vue/test-utils'
import ItemTable from './ItemTable.vue'
import { tableFor } from '../rows'
import { MB, portRow, snapshot } from '../testing/fixtures'
import type { DashboardSnapshot } from '../../../shared/types'

function ports(memories: number[]): DashboardSnapshot {
  return snapshot({
    ports: memories.map((mb, i) => portRow({ port: 3000 + i, pid: 100 + i, memoryBytes: mb * MB }))
  })
}

type TableProps = InstanceType<typeof ItemTable>['$props']

function props(s: DashboardSnapshot, sort: { id: string; dir: 'asc' | 'desc' }): TableProps {
  const table = tableFor('ports', s)
  return {
    table,
    rows: table.rows,
    selectedKey: null,
    searching: false,
    emptyText: '',
    busyKey: null,
    sort
  }
}

const order = (w: ReturnType<typeof mount>): string[] =>
  w.findAll('tbody tr[data-key]').map((tr) => tr.attributes('data-key')!)

test('사용자가 고른 정렬은 데이터가 새로 와도(새 표 객체) 그대로다', async () => {
  const w = mount(ItemTable, {
    props: props(ports([300, 100, 200]), { id: 'memory', dir: 'desc' })
  })
  expect(order(w)).toEqual(['port:3000:100', 'port:3002:102', 'port:3001:101'])
  // 다음 스냅샷: 표·행 객체가 모두 새로 만들어지고 기본 정렬(포트 순)도 다시 실린다.
  await w.setProps(props(ports([300, 100, 250]), { id: 'memory', dir: 'desc' }))
  expect(order(w)).toEqual(['port:3000:100', 'port:3002:102', 'port:3001:101'])
})

test('머리를 누르면 바뀐 정렬을 알린다(같은 칸이면 방향만 뒤집는다)', async () => {
  const w = mount(ItemTable, { props: props(ports([300, 100]), { id: 'memory', dir: 'desc' }) })
  const memoryHead = w.findAll('th').find((th) => th.text().includes('메모리'))!
  await memoryHead.find('button').trigger('click')
  expect(w.emitted('update:sort')?.[0]).toEqual([{ id: 'memory', dir: 'asc' }])
  const portHead = w.findAll('th').find((th) => th.text().includes('포트'))!
  await portHead.find('button').trigger('click')
  expect(w.emitted('update:sort')?.[1]).toEqual([{ id: 'port', dir: 'asc' }])
})
